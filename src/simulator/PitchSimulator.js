/**
 * PitchSimulator — 투구 시뮬레이션 상태 관리
 *
 * 알고리즘 순수 함수: pitchEngine.js
 * 공통 유틸/상수:     simUtils.js
 *
 * 좌표계:
 *   x: -1.0(안쪽) ~ +1.0(바깥쪽)  |  y: -1.35(낮은) ~ +1.35(높은)
 *   1 단위 = 홈플레이트 반폭 (8.5인치 ≈ 21.6cm)
 */

import {
  clamp, gaussRandom, norm,
  ZONE_X, ZONE_Y, BALL_R,
  getYerkesMistakeMod,
  PITCH_TYPE_LABELS,
} from './simUtils';

import {
  selectPitchType, selectTarget, generateIntent,
  generatePitchQuality, executePitch,
  checkAbnormal, generateFeedback,
} from './pitchEngine';

export class PitchSimulator {
  /**
   * @param {Object} pitcher
   * @param {number} pitcher.stuff     — 20-80
   * @param {number} pitcher.command   — 20-80 커맨드 (존 인력)
   * @param {number} pitcher.control   — 20-80 컨트롤 (도달 범위)
   * @param {number} pitcher.stamina   — 20-80
   * @param {Object} pitcher.pitchTypes — { '4seam': { velo, pct }, ... }
   * @param {Object} [pitcher.attributes]
   */
  constructor(pitcher) {
    this.pitcher = pitcher;
    this.stuff   = pitcher.stuff   ?? 50;
    this.command = pitcher.command ?? 50;
    this.control = pitcher.control ?? 50;
    this.stamina = pitcher.stamina ?? 50;

    this.pitchTypes = Object.entries(pitcher.pitchTypes || {})
      .filter(([, v]) => v.pct > 0)
      .map(([type, data]) => ({ type, velo: data.velo, pct: data.pct }));

    const attr = pitcher.attributes || {};
    this.attr = {
      competitiveness: attr.competitiveness ?? 50,
      resilience:      attr.resilience      ?? 50,
      focus:           attr.focus           ?? 50,
      adaptability:    attr.adaptability    ?? 50,
      work_ethic:      attr.work_ethic      ?? 50,
      durability:      attr.durability      ?? 50,
      leadership:      attr.leadership      ?? 50,
    };

    this._initGameState();
  }

  _initGameState() {
    this.pitchCount = 0;
    this.gameLog    = [];

    const fatigue = this.pitcher.fatigue ?? 0;
    this.fatigue     = fatigue;
    this.condition   = clamp(100 - fatigue * 0.6 + gaussRandom(0, 5), 0, 100);
    this.physique    = clamp(100 - fatigue * 0.4 + gaussRandom(0, 4), 0, 100);
    this.tension     = clamp(45 + gaussRandom(0, 6), 30, 65);
    this.isExhausted = false;

    // 구종별 컨디션 (§3-1)
    this.pitchTypeCondition = {};
    for (const pt of this.pitchTypes) {
      this.pitchTypeCondition[pt.type] = clamp(gaussRandom(this.condition, 12), 40, 100);
    }
  }

  // ── 내부 상태 스냅샷 ──────────────────────────────────────────

  _getStateSnapshot(pitchType) {
    return {
      condition:          Math.round(this.condition),
      physique:           Math.round(this.physique),
      negFactor:          Math.round(this.tension),      // UI 표시용: 부정 요인 팩터
      isExhausted:        this.isExhausted,
      pitchTypeCondition: Math.round(this.pitchTypeCondition[pitchType] ?? 0),
      mistakeMod:         Math.round(getYerkesMistakeMod(this.tension) * 100) / 100,
    };
  }

  // ── 상황 기반 tension 갱신 ────────────────────────────────────
  // 매 투구마다 호출. 누적이 아니라 목표값으로 서서히 수렴.
  _applySituationTension(situation, count) {
    const { outs = 0, bases = [false, false, false], isClose = false, isLate = false } = situation;

    let targetTension = 45;

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

    // 투수: 볼카운트 불리할수록 압박
    if (count.balls === 3)   targetTension += 14; // 볼넷 위기
    if (count.balls === 2)   targetTension += 6;
    if (count.strikes === 2) targetTension -= 6;  // 투스트라이크 — 유리

    targetTension = clamp(targetTension, 20, 90);

    // 압박 증가: 빠르게(25%), 회복: 더 빠르게(35%)
    const diff = targetTension - this.tension;
    const rate = diff > 0 ? 0.25 : 0.35;
    this.tension = clamp(this.tension + diff * rate + gaussRandom(0, 2), 0, 100);
  }

  // ── §2-5 긴장도 역전 ─────────────────────────────────────────

  _triggerTensionReversal() {    if (this.tension < 20) {
      this.tension = clamp(this.tension + gaussRandom(45, 10), 55, 90);
    } else if (this.tension <= 65) {
      this.tension = clamp(this.tension + gaussRandom(10, 6), 0, 100);
    } else {
      this.tension = clamp(this.tension + gaussRandom(5, 8), this.tension - 5, 100);
    }
  }

  // ── §2-7 볼데드 피드백 (내부) ────────────────────────────────
  //
  // 체력 소모 개선: 기본 0.3/구 + 스태미너 보정 최대 0.6 → 투구당 0.3~0.9 소모
  // (이전: 스태미너 의존 0.0~0.4, 너무 적었음)

  _applyBallDeadFeedback(pitchResult, battingResult = null) {
    const pitchType   = pitchResult.pitchType;
    const staminaNorm = norm(this.stamina);

    // ── 컨디션 미량 감소 ──
    this.condition = clamp(this.condition - 0.15 - this.fatigue * 0.002, 0, 100);

    // ── 구종 컨디션 갱신 (§2-7) ──
    if (pitchType && this.pitchTypeCondition[pitchType] != null) {
      const ptc       = this.pitchTypeCondition;
      const result    = pitchResult.result;
      const loc       = pitchResult.location;
      const target    = pitchResult.target;
      const planZone  = pitchResult.plan?.locationZone;

      // 제구 달성 여부: 목표 위치와 실제 위치의 거리
      let commandBonus = 0;
      if (loc && target) {
        const dist = Math.sqrt((loc.x - target.x) ** 2 + (loc.y - target.y) ** 2);
        if      (dist < 0.3) commandBonus =  1.5;  // 의도한 코스에 정확히 꽂힘
        else if (dist < 0.6) commandBonus =  0.5;  // 대체로 의도한 코스
        else if (dist > 1.2) commandBonus = -1.0;  // 목표에서 크게 벗어남
      }

      if (battingResult) {
        if (battingResult.result === 'whiff') {
          // 헛스윙 유도 — 가장 긍정적
          ptc[pitchType] = clamp(ptc[pitchType] + 3.0 + commandBonus, 40, 100);
        } else if (battingResult.action === 'take' && result === 'called_strike') {
          // 루킹 스트라이크
          ptc[pitchType] = clamp(ptc[pitchType] + 1.0 + commandBonus, 40, 100);
        } else if (battingResult.result === 'contact') {
          const t = battingResult.type;
          if (t === 'foul' || t === 'foul_back') {
            // 파울 유도 — 소폭 긍정
            ptc[pitchType] = clamp(ptc[pitchType] + 1.5 + commandBonus, 40, 100);
          } else if (t === 'home_run') {
            ptc[pitchType] = clamp(ptc[pitchType] - 6.0, 40, 100);
            this.tension   = clamp(this.tension + 15, 0, 100);
            this.condition = clamp(this.condition - 2.0, 0, 100);
          } else if (t === 'line_drive') {
            ptc[pitchType] = clamp(ptc[pitchType] - 4.0, 40, 100);
          } else if (t === 'deep_fly') {
            ptc[pitchType] = clamp(ptc[pitchType] - 2.5, 40, 100);
          } else if (t === 'fly_ball') {
            ptc[pitchType] = clamp(ptc[pitchType] - 1.5, 40, 100);
          } else if (t === 'grounder') {
            // 땅볼은 중립~소폭 감소 (제구 달성 여부로 결정)
            ptc[pitchType] = clamp(ptc[pitchType] - 0.5 + commandBonus, 40, 100);
          } else if (t === 'popup') {
            // 팝업은 긍정
            ptc[pitchType] = clamp(ptc[pitchType] + 1.0 + commandBonus, 40, 100);
          }
        }
      } else {
        // 타격 결과 없음 (비정상 투구 등)
        if (result === 'ball') {
          // 의도한 유인구(waste)면 볼이어도 감소 없음
          if (planZone !== 'waste') {
            ptc[pitchType] = clamp(ptc[pitchType] - 1.5 + commandBonus, 40, 100);
          }
        }
      }
    }

    // ── 투구 결과에 따른 부정 요인 팩터 갱신 ──
    if (pitchResult.qualityDetail?.isMistake) {
      this._triggerTensionReversal();
    } else if (battingResult?.result === 'whiff') {
      // 삼진 유도 성공 → 긴장 소폭 감소
      this.tension = clamp(this.tension - 3, 0, 100);
    } else if (battingResult?.type === 'home_run') {
      // 홈런 허용 → 긴장 급등 (위에서 이미 처리)
    } else {
      // 일반 투구 → 긴장 미량 감소 (안정화)
      this.tension = clamp(this.tension - 0.5, 0, 100);
    }
  }

  // ── ② 투구 계획 생성 ─────────────────────────────────────────

  planPitch(count, situation = {}, feedback = null) {
    const countKey = `${count.balls}-${count.strikes}`;

    const { pitchType, reasoning: typeReasoning } =
      selectPitchType(this.pitchTypes, this.pitchTypeCondition, countKey, feedback);

    const { target, reasoning: locationReasoning, locationZone } =
      selectTarget(countKey, pitchType, feedback);

    const intent = generateIntent(countKey, pitchType.type, locationZone, situation);

    return {
      pitchType:   pitchType.type,
      targetVelo:  pitchType.velo,
      target,
      intent,
      reasoning:   [...typeReasoning, ...locationReasoning],
    };
  }

  // ── 비정상 투구 체크 ─────────────────────────────────────────

  checkAbnormal(count, situation = {}) {
    const pitcherState = {
      tension:     this.tension,
      isExhausted: this.isExhausted,
      physique:    this.physique,
    };
    const attrs = {
      ...this.attr,
      control: this.control,
      stamina: this.stamina,
    };
    return checkAbnormal(this.pitchCount, pitcherState, attrs, situation);
  }

  // ── 메인 API ─────────────────────────────────────────────────

  simulate(count, situation = {}, feedback = null) {
    this.pitchCount++;

    // ── 매 투구마다 체력 소모 ──
    const staminaNorm = norm(this.stamina);
    let physDrain = 0.3 + (1 - staminaNorm) * 0.6;
    if (this.pitchCount > 100) physDrain *= 2.0;
    else if (this.pitchCount > 80) physDrain *= 1.5;
    else if (this.pitchCount > 60) physDrain *= 1.15;
    this.physique    = clamp(this.physique - physDrain, 0, 100);
    this.isExhausted = this.physique < 25;

    // 상황 기반 tension 갱신 (매 투구마다)
    this._applySituationTension(situation, count);

    const plan = this.planPitch(count, situation, feedback);

    // 비정상 투구 체크
    const abnormal = this.checkAbnormal(count, situation);
    if (abnormal) {
      const result = {
        pitchNumber: this.pitchCount,
        isNormal:    false,
        ...abnormal,
        plan,
        feedback:    null,
        gameState:   this._getStateSnapshot(plan.pitchType),
      };
      this.gameLog.push(result);
      return result;
    }

    // 투구 퀄리티 생성
    const pitcherState = {
      stuff:              this.stuff,
      command:            this.command,
      control:            this.control,
      condition:          this.condition,
      physique:           this.physique,
      tension:            this.tension,
      isExhausted:        this.isExhausted,
      pitchTypeCondition: this.pitchTypeCondition,
      pitchCount:         this.pitchCount,
    };
    const qualityData = generatePitchQuality(pitcherState, plan.pitchType, this.attr);

    // 퀄리티 실수 발생 시 부정 요인 급등
    if (qualityData.isMistake) this._triggerTensionReversal();

    // 투구 실행
    const execution = executePitch(plan, qualityData, pitcherState, this.stamina);

    // 비정상 결과 (제구 실패)
    if (execution.type === 'wild_pitch' || execution.type === 'hit_by_pitch') {
      const result = {
        pitchNumber:  this.pitchCount,
        isNormal:     false,
        ...execution,
        plan,
        pitchQuality: qualityData.pitchQuality,
        qualityDetail: qualityData,
        feedback:     generateFeedback(execution),
        gameState:    this._getStateSnapshot(plan.pitchType),
      };
      this._applyBallDeadFeedback(result);
      this.gameLog.push(result);
      return result;
    }

    // 정상 투구
    const result = {
      pitchNumber:  this.pitchCount,
      isNormal:     true,
      ...execution,
      plan,
      pitchQuality: qualityData.pitchQuality,
      qualityDetail: qualityData,
      feedback:     generateFeedback(execution),
      gameState:    this._getStateSnapshot(plan.pitchType),
    };
    this.gameLog.push(result);
    return result;
  }

  /** 타격 결과를 받아 볼데드 피드백 적용 (외부 호출용) */
  applyBattingFeedback(pitchResult, battingResult) {
    this._applyBallDeadFeedback(pitchResult, battingResult);
  }

  /** 이닝 종료 시 tension 회복 */
  onInningEnd() {
    // 이닝 사이 휴식 — tension을 최적 구간(45) 방향으로 회복
    const recovery = (45 - this.tension) * 0.4 + gaussRandom(0, 3);
    this.tension = clamp(this.tension + recovery, 20, 80);
  }

  reset() {
    this._initGameState();
  }
}

// ── 헬퍼: 선수 데이터 → PitchSimulator 입력 변환 ──────────────────

export function toPitcherProfile(playerData) {
  const eval_      = playerData.eval || {};
  const pitchStats = playerData.pitchStats || {};
  const attributes = playerData.attributes || {};

  const PITCH_KEYS = ['4seam', '2seam', 'cutter', 'curve', 'slider', 'changeup', 'sinker', 'fork', 'knuckle'];
  const pitchTypes = {};
  for (const key of PITCH_KEYS) {
    const velo = pitchStats[`velo_${key}`];
    const pct  = pitchStats[`pct_${key}`];
    if (velo && pct && pct > 0) pitchTypes[key] = { velo: Number(velo), pct: Number(pct) };
  }

  return {
    stuff:   eval_.stuff   ?? 50,
    command: eval_.command ?? 50,
    control: eval_.control ?? 50,
    stamina: eval_.stamina ?? 50,
    pitchTypes,
    attributes,
  };
}

// ── 존 경계 export ────────────────────────────────────────────────
export { ZONE_X, ZONE_Y, BALL_R };

// ── 구종 한글 표시명 export ───────────────────────────────────────
export { PITCH_TYPE_LABELS };
