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
    this.contact_l   = profile.contact_l  ?? 50;
    this.contact_r   = profile.contact_r  ?? 50;
    this.power       = profile.power      ?? 50;
    this.eye         = profile.eye        ?? 50;
    this.discipline  = profile.discipline ?? 50; // 배트 참는 능력 — swingThreshold 결정
    this.speed       = profile.speed      ?? 50;
    this.bunt        = profile.bunt       ?? 50;
    this.stadiumKey  = stadiumKey;

    this._initGameState(profile.fatigue ?? 0);
    this.atBatHistory = [];
  }

  _initGameState(fatigue = 0) {
    this.fatigue     = fatigue;
    this.condition   = clamp(100 - fatigue * 0.6 + gaussRandom(0, 5), 0, 100);
    this.physique    = clamp(100 - fatigue * 0.4 + gaussRandom(0, 4), 0, 100);
    // 기본 긴장도: 45 (일반 타석도 어느 정도 압박은 있음)
    this.tension     = clamp(45 + gaussRandom(0, 6), 30, 65);
    this.isExhausted = false;
  }

  // ── 상황 기반 tension 갱신 ────────────────────────────────────
  // 매 투구마다 호출. 누적이 아니라 상황에 맞는 목표값으로 서서히 수렴.
  _applySituationTension(situation, count) {
    const { outs = 0, bases = [false, false, false], isClose = false, isLate = false } = situation;

    // 상황별 목표 tension 계산
    let targetTension = 45; // 기본

    const runnerCount = bases.filter(Boolean).length;
    if (runnerCount === 3)                  targetTension += 22;
    else if (runnerCount === 2)             targetTension += 13;
    else if (runnerCount === 1 && bases[2]) targetTension += 16;
    else if (runnerCount === 1 && bases[1]) targetTension += 10;
    else if (runnerCount === 1)             targetTension += 5;

    if (outs === 2)      targetTension += 7;
    else if (outs === 0) targetTension -= 5;

    if (isClose) targetTension += 8;
    if (isLate)  targetTension += 5;

    if (count.balls === 3)   targetTension += 12;
    if (count.strikes === 2) targetTension -= 5;

    targetTension = clamp(targetTension, 20, 90);

    // 압박 증가: 빠르게(25%), 회복: 더 빠르게(35%) — 상황 개선 시 빠른 안정화
    const diff = targetTension - this.tension;
    const rate = diff > 0 ? 0.25 : 0.35;
    this.tension = clamp(this.tension + diff * rate + gaussRandom(0, 2), 0, 100);
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
   * @param {Object}   situation       — { outs, bases, isClose, isLate }
   */
  simulate(pitch, count = { balls: 0, strikes: 0 }, pitcherHand = 'R', knownPitchTypes = [], situation = {}, atBatContext = null) {
    if (!pitch.isNormal || !pitch.location) {
      return { action: 'none', description: '비정상 투구' };
    }

    // ── 상황 기반 tension 갱신 ──────────────────────────────
    this._applySituationTension(situation, count);

    const loc          = pitch.location;
    const pitchType    = pitch.pitchType;
    const pitchQuality = pitch.pitchQuality ?? 55;

    const batterState = {
      eye:        this.eye,
      discipline: this.discipline,
      power:      this.power,
      condition:  this.condition,
      physique:   this.physique,
      tension:    this.tension,
      isExhausted: this.isExhausted,
      situation,  // 주자/아웃 상황 — tactic 결정에 활용
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
        wasBiasConfirmed:   r.judgment?.wasBiasConfirmed ?? false,
      }));

    const plan = generateBattingPlan(count, pitchHistory, batterState, knownPitchTypes, atBatContext);

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

    const eyeNorm        = norm(this.eye);
    const disciplineNorm = norm(this.discipline);
    let swingThreshold;
    if (plan.targetBallResult === 'take') {
      // 자율 기다림: discipline 높을수록 더 확실한 스트라이크만 스윙
      swingThreshold = clamp(0.70 + disciplineNorm * 0.25, 0.70, 0.95);
    } else {
      // discipline=20 → 0.22, discipline=50 → 0.46, discipline=80 → 0.71
      // 2스트라이크: 긴박 → 존 확장 (웬만한 볼도 쫓음)
      const twoStrikeMod = count.strikes === 2 ? -0.08 : 0;
      swingThreshold = clamp(
        0.22 + disciplineNorm * 0.44 + eyeNorm * 0.05 + getPlanMod(plan.targetBallResult) + twoStrikeMod,
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

  applyBallDeadFeedback(battingResult, atBatContext = {}) {
    this.condition   = clamp(this.condition - 0.5 - this.fatigue * 0.008, 0, 100);
    this.physique    = clamp(this.physique  - 0.1, 0, 100);
    this.isExhausted = this.physique < 25;

    if (!battingResult) return;

    const { action, result, type } = battingResult;
    const { isRisp = false } = atBatContext; // 득점권 여부

    if (action === 'swing' && result === 'contact') {
      if (type === 'home_run') {
        this.tension   = clamp(this.tension - 15, 0, 100);
        this.condition = clamp(this.condition + 5.0, 0, 100);
      } else if (type === 'barrel_line_drive') {
        this.tension   = clamp(this.tension - 8, 0, 100);
        this.condition = clamp(this.condition + 2.0, 0, 100);
      } else if (type === 'line_drive' || type === 'weak_line_drive') {
        this.tension   = clamp(this.tension - 5, 0, 100);
        this.condition = clamp(this.condition + 1.0, 0, 100);
      } else if (type === 'hard_grounder' || type === 'grounder') {
        this.tension   = clamp(this.tension - 3, 0, 100);
        this.condition = clamp(this.condition + 0.5, 0, 100);
      } else if (type === 'weak_grounder' || type === 'fly_ball' || type === 'deep_fly') {
        // 인플레이는 됐지만 기대 이하 — 변화 없음
      } else if (type === 'popup') {
        this.tension = clamp(this.tension + 3, 0, 100);
      }
    } else if (action === 'swing' && result === 'whiff') {
      this.tension   = clamp(this.tension + 8, 0, 100);
      this.condition = clamp(this.condition - 1.0, 0, 100);
      if (this.tension > 65) this._triggerReversal();
    } else if (action === 'take') {
      // 볼넷 선출 방향 (볼 판정)
      const pitchResult = battingResult.plan?.tactic;
      if (result === 'ball') {
        this.tension   = clamp(this.tension - 2, 0, 100);
        this.condition = clamp(this.condition + 0.3, 0, 100);
      }
    }

    this.atBatHistory.push(battingResult);
  }

  // ── 타석 종료 피드백 (삼진/볼넷/인플레이 결과) ──────────────────
  applyAtBatResult(resultType, context = {}) {
    const { isRisp = false } = context;
    switch (resultType) {
      case 'strikeout':
        this.condition = clamp(this.condition - 1.5, 0, 100);
        this.tension   = clamp(this.tension + 10, 0, 100);
        if (isRisp) {
          this.condition = clamp(this.condition - 3.0, 0, 100);
          this.tension   = clamp(this.tension + 18, 0, 100);
        }
        break;
      case 'walk':
        this.condition = clamp(this.condition - 0.5 + 0.5, 0, 100); // 소모 상쇄
        this.tension   = clamp(this.tension - 3, 0, 100);
        break;
      case 'hit':
        this.condition = clamp(this.condition + 1.0, 0, 100);
        this.tension   = clamp(this.tension - 5, 0, 100);
        break;
      case 'home_run':
        this.condition = clamp(this.condition + 5.0, 0, 100);
        this.tension   = clamp(this.tension - 12, 0, 100);
        break;
      case 'rbi_hit':
        this.condition = clamp(this.condition + 3.0, 0, 100);
        this.tension   = clamp(this.tension - 8, 0, 100);
        break;
      default: break;
    }
  }

  // ── 이닝 종료 physique 감소 ──────────────────────────────────────
  onInningEnd() {
    this.physique  = clamp(this.physique - (1.0 + this.fatigue * 0.015), 0, 100);
    this.isExhausted = this.physique < 25;
    // tension 회복
    const recovery = (45 - this.tension) * 0.4 + gaussRandom(0, 3);
    this.tension = clamp(this.tension + recovery, 20, 80);
    // 타석 히스토리 초기화 (새 이닝)
    this.atBatHistory = [];
  }
}

// ── 디폴트 프로필 ─────────────────────────────────────────────────

export const DEFAULT_BATTER_PROFILE = {
  contact_l: 50, contact_r: 50,
  power: 50, eye: 50, discipline: 50, speed: 50, bunt: 50,
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
