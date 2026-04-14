/**
 * BattingSimulator — 타격 시뮬레이션 상태 관리
 *
 * 알고리즘 순수 함수: battingEngine.js
 * 공통 유틸/상수:     simUtils.js
 */

import {
  clamp, gaussRandom, norm,
  getYerkesMistakeMod,
  BATTED_BALL_LABELS,
} from './simUtils';

import {
  generateBattingPlan,
  judgePitch,
  calcOverlap,
  getPlanMod,
  calcSwingLevel,
  calcWhiff,
  calcContactQuality,
  calcBattingVector,
} from './battingEngine';

export { BATTED_BALL_LABELS };

export class BattingSimulator {
  constructor(profile, stadiumKey = 'jamsil') {
    this.contact_l  = profile.contact_l ?? 50;
    this.contact_r  = profile.contact_r ?? 50;
    this.power      = profile.power     ?? 50;
    this.eye        = profile.eye       ?? 50;
    this.speed      = profile.speed     ?? 50;
    this.bunt       = profile.bunt      ?? 50;
    this.stadiumKey = stadiumKey;

    this._initGameState(profile.fatigue ?? 0);
    this.atBatHistory = [];
  }

  _initGameState(fatigue = 0) {
    this.fatigue     = fatigue;
    this.condition   = clamp(100 - fatigue * 0.6 + gaussRandom(0, 5), 0, 100);
    this.physique    = clamp(100 - fatigue * 0.4 + gaussRandom(0, 4), 0, 100);
    // 부정 요인 팩터 (내부 변수명 tension 유지)
    this.tension     = clamp(30 + gaussRandom(0, 5), 0, 100);
    this.isExhausted = false;
  }

  _getStateSnapshot() {
    return {
      condition:   Math.round(this.condition),
      physique:    Math.round(this.physique),
      negFactor:   Math.round(this.tension),    // UI 표시용: 부정 요인 팩터
      isExhausted: this.isExhausted,
      mistakeMod:  Math.round(getYerkesMistakeMod(this.tension) * 100) / 100,
    };
  }

  // ── §2-5 역전 ────────────────────────────────────────────────

  _triggerReversal() {
    if (this.tension < 20) {
      this.tension = clamp(this.tension + gaussRandom(45, 10), 55, 90);
    } else if (this.tension <= 65) {
      this.tension = clamp(this.tension + gaussRandom(10, 6), 0, 100);
    } else {
      this.tension = clamp(this.tension + gaussRandom(5, 8), this.tension - 5, 100);
    }
  }

  // ── 메인 API ─────────────────────────────────────────────────

  /**
   * @param {Object} pitch       — PitchSimulator.simulate() 결과
   * @param {Object} count       — { balls, strikes }
   * @param {string} pitcherHand — 'L' | 'R'
   */
  /**
   * @param {Object}   pitch           — PitchSimulator.simulate() 결과
   * @param {Object}   count           — { balls, strikes }
   * @param {string}   pitcherHand     — 'L' | 'R'
   * @param {string[]} knownPitchTypes — 상대 투수의 알려진 구종 목록 (레퍼토리)
   *                                     PitchSimulator.pitchTypes.map(p => p.type) 로 전달
   */
  simulate(pitch, count = { balls: 0, strikes: 0 }, pitcherHand = 'R', knownPitchTypes = []) {
    if (!pitch.isNormal || !pitch.location) {
      return { action: 'none', description: '비정상 투구' };
    }

    const loc          = pitch.location;
    const pitchType    = pitch.pitchType;
    const pitchQuality = pitch.pitchQuality ?? 55;

    const batterState = {
      eye:       this.eye,
      power:     this.power,
      condition: this.condition,
      physique:  this.physique,
      tension:   this.tension,
      isExhausted: this.isExhausted,
    };

    // ── ② 타격 계획 ──────────────────────────────────────────
    // 이번 타석에서 이전에 본 투구 기록 (실제 구종 + 예측 정확도)
    // generateBattingPlan은 실제 pitchType을 받지 않음 — 히스토리 기반으로만 예측
    const pitchHistory = this.atBatHistory
      .filter(r => r.judgment?.actualPitchType)
      .map(r => ({
        actualPitchType:    r.judgment.actualPitchType,
        predictedPitchType: r.plan?.predictedPitchType ?? null,
        predictedCorrect:   r.judgment?.predictedCorrect ?? false,
      }));

    const plan = generateBattingPlan(count, pitchHistory, batterState, knownPitchTypes);

    // ── ③ 투구 판단 ──────────────────────────────────────────
    const judgment = judgePitch(pitch, plan, batterState, knownPitchTypes);

    // ── ④ 스윙 여부 결정 ─────────────────────────────────────
    const overlap = calcOverlap(judgment.judgedLocation);

    // 감독 테이크 사인
    if (plan.tactic === 'take') {
      return {
        action: 'take', plan, judgment,
        overlap: Math.round(overlap * 100) / 100, threshold: 1.0,
        description: '테이크 사인 (감독 지시)',
        gameState: this._getStateSnapshot(),
      };
    }

    const eyeNorm = norm(this.eye);
    let swingThreshold;
    if (plan.targetBallResult === 'take') {
      swingThreshold = 0.85 + Math.random() * 0.10;
    } else {
      swingThreshold = clamp(
        0.25 + eyeNorm * 0.45 + getPlanMod(plan.targetBallResult),
        0.10, 0.95
      );
    }

    const willSwing = overlap >= swingThreshold;
    if (!willSwing) {
      return {
        action: 'take', plan, judgment,
        overlap:   Math.round(overlap * 100) / 100,
        threshold: Math.round(swingThreshold * 100) / 100,
        gameState: this._getStateSnapshot(),
      };
    }

    // ── 스윙 레벨 ────────────────────────────────────────────
    const swingLevel = calcSwingLevel(plan, judgment, overlap, swingThreshold, batterState);

    // 스윙 유형 분류
    let swingType;
    if      (swingLevel <= 0)  swingType = 'no_swing';
    else if (swingLevel <= 20) swingType = 'check_swing';
    else if (swingLevel <= 45) swingType = 'late_swing';
    else if (swingLevel <= 75) swingType = 'normal_swing';
    else                       swingType = 'full_swing';

    // 체크 스윙 → 노스윙 확률
    if (swingType === 'check_swing' && Math.random() < 0.4) {
      return {
        action: 'take', swingType: 'check_swing_held',
        swingLevel: Math.round(swingLevel), plan, judgment,
        overlap:   Math.round(overlap * 100) / 100,
        threshold: Math.round(swingThreshold * 100) / 100,
        description: '체크 스윙 (배트 멈춤)',
        gameState: this._getStateSnapshot(),
      };
    }

    // ── ⑤ 헛스윙 판정 ────────────────────────────────────────
    const contact = pitcherHand === 'L' ? this.contact_l : this.contact_r;
    const { isWhiff, whiffProb, locationError } =
      calcWhiff(judgment, loc, swingLevel, contact, pitchQuality, batterState);

    if (isWhiff) {
      return {
        action: 'swing', result: 'whiff',
        swingType, swingLevel: Math.round(swingLevel), plan, judgment,
        overlap:       Math.round(overlap * 100) / 100,
        threshold:     Math.round(swingThreshold * 100) / 100,
        locationError: Math.round(locationError * 100) / 100,
        whiffProb:     Math.round(whiffProb * 100) / 100,
        gameState:     this._getStateSnapshot(),
      };
    }

    // ── ⑥ 타구 퀄리티 산출 ───────────────────────────────────
    const { quality, conditionMod, tensionFactor } =
      calcContactQuality(swingLevel, swingType, locationError, pitchQuality, contact, batterState);

    // ── ⑦ 타구 벡터 생성 ─────────────────────────────────────
    const battingVec = calcBattingVector(quality, swingLevel, pitch, this.power, batterState, this.stadiumKey);

    return {
      action: 'swing', result: 'contact',
      ...battingVec,
      quality:       Math.round(quality),
      swingType,
      swingLevel:    Math.round(swingLevel),
      plan, judgment,
      overlap:       Math.round(overlap * 100) / 100,
      threshold:     Math.round(swingThreshold * 100) / 100,
      whiffProb:     Math.round(whiffProb * 100) / 100,
      locationError: Math.round(locationError * 100) / 100,
      conditionMod,
      tensionFactor,
      gameState:     this._getStateSnapshot(),
    };
  }

  // ── §2-7 볼데드 피드백 ────────────────────────────────────────

  applyBallDeadFeedback(battingResult) {
    this.condition   = clamp(this.condition - 0.5 - this.fatigue * 0.008, 0, 100);
    this.physique    = clamp(this.physique  - 0.1, 0, 100);
    this.isExhausted = this.physique < 25;

    if (!battingResult) return;

    const { action, result, type } = battingResult;

    if (action === 'swing' && result === 'contact') {
      if      (type === 'home_run')  { this.tension = clamp(this.tension - 15, 0, 100); this.condition = clamp(this.condition + 5.0, 0, 100); }
      else if (type === 'line_drive' || type === 'grounder') { this.tension = clamp(this.tension - 5, 0, 100); this.condition = clamp(this.condition + 1.0, 0, 100); }
      else if (type === 'popup' || type === 'fly_ball')      { this.tension = clamp(this.tension + 3, 0, 100); }
    } else if (action === 'swing' && result === 'whiff') {
      this.tension   = clamp(this.tension + 8, 0, 100);
      this.condition = clamp(this.condition - 1.0, 0, 100);
      // 연속 헛스윙 → 부정 요인 역전 가능
      if (this.tension > 65) this._triggerReversal();
    }

    this.atBatHistory.push(battingResult);
  }
}

// ── 디폴트 프로필 ─────────────────────────────────────────────────

export const DEFAULT_BATTER_PROFILE = {
  contact_l: 50, contact_r: 50,
  power: 50, eye: 50, speed: 50, bunt: 50,
};

export const DEFAULT_PITCHER_PROFILE = {
  stuff: 50, command: 50, control: 50, stamina: 50,
  pitchTypes: {
    '4seam':    { velo: 140, pct: 30 },
    'slider':   { velo: 128, pct: 25 },
    'changeup': { velo: 130, pct: 25 },
    'curve':    { velo: 120, pct: 20 },
  },
  attributes: {
    competitiveness: 50, resilience: 50, focus: 50,
  },
};
