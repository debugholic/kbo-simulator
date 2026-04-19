/**
 * battingEngine.js — 타격 알고리즘 순수 함수 모음
 *
 * GAME_MECHANICS §4 기반.
 * 이 파일은 순수 함수(상태 없음)만 포함합니다.
 *
 * Yerkes-Dodson(부정 요인 팩터) 법칙이 아래 모든 단계에 적용됩니다:
 *   - 투구 판단 위치 오차 (긴장 → 오차 증가)
 *   - 스윙 레벨 (긴장 → 양극단 시 스윙 레벨 저하)
 *   - 헛스윙 확률 (긴장 → 헛스윙 증가)
 *   - 타구 퀄리티 (긴장 → 퀄리티 감소)
 *   - 타구 벡터 분산 (긴장 → 타구 방향/각도 불안정)
 */

import {
  clamp, gaussRandom, norm, rand,
  ZONE_X, ZONE_Y,
  getYerkesMistakeMod, getYerkesFactor, getYerkesErrorMod,
  FASTBALL_TYPES, BREAKING_TYPES,
} from './simUtils';
import { getWallDistance } from './stadiums';

// ── 인접 구종 (§4-5 오판 계층) ───────────────────────────────────

const ADJACENT_TYPES = {
  '4seam':    ['2seam', 'cutter'],
  '2seam':    ['4seam', 'sinker'],
  'sinker':   ['2seam', 'changeup'],
  'cutter':   ['slider', '4seam'],
  'slider':   ['cutter', 'curve'],
  'curve':    ['slider', 'changeup'],
  'changeup': ['fork', '2seam'],
  'fork':     ['changeup', 'sinker'],
  'knuckle':  ['curve'],
};

// ── §4-4 타격 계획 생성 ───────────────────────────────────────────

// 카운트별 패스트볼 기대 확률 (투수 관점: 스트라이크 필요 시 FB 증가)
const COUNT_FB_PROB = {
  '0-0': 0.58, '0-1': 0.52, '0-2': 0.38,
  '1-0': 0.63, '1-1': 0.55, '1-2': 0.40,
  '2-0': 0.68, '2-1': 0.58, '2-2': 0.48,
  '3-0': 0.85, '3-1': 0.70, '3-2': 0.52,
};

/**
 * AtBatContext 기반 타자 초기 예측 편향 계산 (§8-2).
 *
 * FB 비율, 직전 타석 결과, 앞 타자 신호를 종합해 이번 타석의
 * 첫 투구 전 초기 fbProb 보정값과 경계 구종을 반환한다.
 *
 * @param {string[]} knownPitchTypes — 투수 레퍼토리
 * @param {Object}   atBatContext    — { prevAtBatsVsBatter, lineupSignal }
 * @returns {{ fbBias: number, guardPitchType: string|null }}
 *   fbBias: fbProb에 더할 보정값 (-0.3 ~ +0.3)
 *   guardPitchType: 특히 경계할 구종 (null 가능)
 */
function computeInitialBias(knownPitchTypes, atBatContext) {
  if (!atBatContext || !knownPitchTypes?.length) return { fbBias: 0, guardPitchType: null };

  const { prevAtBatsVsBatter = [], lineupSignal = {} } = atBatContext;
  const fbTypes   = knownPitchTypes.filter(t => FASTBALL_TYPES.has(t));
  const fbRatio   = fbTypes.length / knownPitchTypes.length;

  // FB 비율 편향: FB 60% → +0.16, FB 40% → -0.16
  let fbBias = (fbRatio - 0.5) * 1.6 * 0.2;   // 스케일 0.2 → max ±0.16

  // 직전 타석 수정
  const prevAB = prevAtBatsVsBatter[prevAtBatsVsBatter.length - 1];
  let guardPitchType = null;
  if (prevAB?.endingPitchType) {
    if (prevAB.result === 'strikeout') {
      // 삼진 당한 구종 경계 → 그 구종 계열 반대로 예측 편향 강화
      guardPitchType = prevAB.endingPitchType;
      fbBias += FASTBALL_TYPES.has(prevAB.endingPitchType) ? -0.20 : +0.20;
    } else if (prevAB.result === 'hit' || prevAB.result === 'home_run') {
      // 안타/홈런 구종 자신감 → 그 구종 다시 기대
      guardPitchType = prevAB.endingPitchType;
      fbBias += FASTBALL_TYPES.has(prevAB.endingPitchType) ? +0.15 : -0.15;
    }
  }

  // 앞 타자 신호: 같은 구종에 당했으면 추가 경계
  if (lineupSignal.prevEndingPitch && lineupSignal.prevResult === 'strikeout') {
    const isLinupFB = FASTBALL_TYPES.has(lineupSignal.prevEndingPitch);
    fbBias += isLinupFB ? -0.10 : +0.10;
    if (!guardPitchType) guardPitchType = lineupSignal.prevEndingPitch;
  }

  return { fbBias: clamp(fbBias, -0.30, 0.30), guardPitchType };
}

/**
 * 이전 투구 피드백으로 선입견 강도 계산 (최근 4구 기준).
 * - 예측이 맞았거나(predictedCorrect) 착각으로 예측 구종처럼 느꼈을 때(wasBiasConfirmed) → 선입견 강화
 * - 예측이 완전히 빗나갔을 때 → 선입견 약화
 * @param {Array} pitchHistory — [{ actualPitchType, predictedPitchType, predictedCorrect, wasBiasConfirmed }]
 * @returns {number} -1 (선입견 없음/불신) ~ +1 (선입견 강함)
 */
function computeBiasStrength(pitchHistory) {
  const relevant = pitchHistory.filter(p => p.predictedPitchType !== null).slice(-4);
  if (!relevant.length) return 0;
  // 예측 적중 + 착각(bias_confirmed) 모두 선입견 강화에 기여
  const reinforced = relevant.filter(p => p.predictedCorrect || p.wasBiasConfirmed).length;
  return clamp((reinforced / relevant.length) * 2 - 1, -1, 1);
}

/**
 * 카운트 + 이전 투구 히스토리 기반 구종 예측.
 * 실제 투구 구종을 사용하지 않음 — 타자는 공이 오기 전에 알 수 없음.
 * knownPitchTypes: 상대 투수의 알려진 구종 목록 (레퍼토리) 내에서만 예측.
 *
 * @param {string[]} knownPitchTypes — 투수 레퍼토리 (e.g. ['4seam','slider','changeup'])
 */
function predictPitchType(count, pitchHistory, eyeNorm, tensionFactor, knownPitchTypes, initialFbBias = 0) {
  const willPredict = Math.random() < (eyeNorm * 0.45 + 0.10) * tensionFactor;
  if (!willPredict) return null;

  // 알려진 구종이 없으면 예측 포기
  if (!knownPitchTypes?.length) return null;

  const fbTypes = knownPitchTypes.filter(t => FASTBALL_TYPES.has(t));
  const osTypes = knownPitchTypes.filter(t => !FASTBALL_TYPES.has(t));

  // 패스트볼이 하나도 없거나 변화구가 하나도 없으면 알려진 전체에서 무작위 선택
  if (!fbTypes.length || !osTypes.length) {
    return knownPitchTypes[Math.floor(Math.random() * knownPitchTypes.length)];
  }

  const countKey = `${count.balls}-${count.strikes}`;
  let fbProb = COUNT_FB_PROB[countKey] ?? 0.55;

  // §8-2 초기 편향 적용 (첫 구 이전에만)
  fbProb = clamp(fbProb + initialFbBias, 0.15, 0.90);

  // 직전 구종 시퀀스 보정 (연속 FB → 변화구 예상 증가)
  if (pitchHistory.length > 0) {
    const lastType = pitchHistory[pitchHistory.length - 1].actualPitchType;
    if (FASTBALL_TYPES.has(lastType)) fbProb = clamp(fbProb - 0.12, 0.20, 0.90);
    else                              fbProb = clamp(fbProb + 0.08, 0.20, 0.90);
  }

  const pool = Math.random() < fbProb ? fbTypes : osTypes;

  // 이전에 많이 본 구종일수록 예측 가중치 증가 (구장에서 실제 경험 반영)
  const weights = pool.map(t => pitchHistory.filter(p => p.actualPitchType === t).length + 0.5);
  const total   = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

/**
 * @param {Object}   count           — { balls, strikes }
 * @param {Array}    pitchHistory    — 이번 타석 이전 투구 기록
 * @param {Object}   batterState     — { eye, power, tension }
 * @param {string[]} knownPitchTypes — 상대 투수의 알려진 구종 (레퍼토리)
 * @param {Object}   [atBatContext]  — { prevAtBatsVsBatter, lineupSignal } (§8)
 * @returns {Object} plan
 */
export function generateBattingPlan(count, pitchHistory, batterState, knownPitchTypes = [], atBatContext = null) {
  const { balls, strikes } = count;
  const { eye, power, discipline, tension } = batterState;
  const eyeNorm        = norm(eye);
  const powerNorm      = norm(power);
  const disciplineNorm = norm(discipline ?? 50);
  const tensionFactor  = getYerkesFactor(tension);

  // ── 피드백 기반 바이어스 강도 ──
  const biasStrength = computeBiasStrength(pitchHistory);

  // ── §8-2 타석 초기 예측 편향 (atBatContext) ──
  // 이번 타석 첫 투구 전 단계에서만 유효 (pitchHistory가 비어 있을 때)
  const { fbBias: initialFbBias, guardPitchType } =
    pitchHistory.length === 0
      ? computeInitialBias(knownPitchTypes, atBatContext)
      : { fbBias: 0, guardPitchType: null };

  // ── 예측 구종 (카운트 + 히스토리 기반, 실제 구종 미사용) ──
  const predictedPitchType = predictPitchType(
    count, pitchHistory, eyeNorm, tensionFactor, knownPitchTypes, initialFbBias
  );

  // ── 예측 존 ──
  let predictedZone = null;
  const zonePredictProb = (eyeNorm * 0.25 + 0.10) * tensionFactor;
  if (Math.random() < zonePredictProb) {
    const zones = ['inside', 'outside', 'high', 'low', 'center'];
    predictedZone = zones[Math.floor(Math.random() * zones.length)];
  }

  // ── 작전 ──
  // discipline 높을수록 볼카운트 유리할 때 기다리는 경향 강함
  let tactic = 'full_swing';
  if (balls === 3 && strikes < 2 && Math.random() < 0.20 + disciplineNorm * 0.30) tactic = 'take';
  if (strikes === 2) tactic = 'contact';

  // 주자 상황 기반 tactic 보정 (batterState에 situation 포함 시)
  const { bases = null, outs = -1 } = batterState.situation ?? {};
  if (bases) {
    // 3루 주자 + 외야 플라이 노림
    if (bases[2] && outs < 2 && tactic === 'full_swing' && Math.random() < 0.25) {
      tactic = 'sacrifice_fly';
    }
    // 바깥쪽 공 노림 (반대 방향 타구 의도)
    if (tactic === 'full_swing' && Math.random() < 0.10) {
      tactic = 'opposite_field';
    }
  }

  // ── 목표 타구 ──
  let targetBallResult = null;
  if (tactic === 'contact') {
    const r = Math.random();
    if      (r < 0.3) targetBallResult = 'grounder_any';
    else if (r < 0.6) targetBallResult = 'line_drive_center';
  } else if (tactic === 'sacrifice_fly') {
    targetBallResult = 'deep_fly_any';
  } else if (tactic === 'opposite_field') {
    targetBallResult = Math.random() < 0.5 ? 'line_drive_right' : 'grounder_right';
  } else if (tactic === 'full_swing') {
    const r = Math.random();
    if      (powerNorm > 0.6 && r < 0.2)  targetBallResult = 'home_run';
    else if (r < 0.35)                     targetBallResult = 'line_drive_center';
    else if (r < 0.50)                     targetBallResult = 'deep_fly_any';
  }

  // ── 목표 스윙 레벨 ──
  let targetSwingLevel;
  if      (tactic === 'take')           targetSwingLevel = 0;
  else if (tactic === 'contact')        targetSwingLevel = 50 + Math.random() * 20;
  else if (tactic === 'sacrifice_fly')  targetSwingLevel = 55 + Math.random() * 20;
  else if (tactic === 'opposite_field') targetSwingLevel = 50 + Math.random() * 20;
  else                                  targetSwingLevel = 75 + Math.random() * 25;

  if (targetBallResult) {
    if      (targetBallResult === 'home_run')                 targetSwingLevel = clamp(targetSwingLevel + 10, 85, 100);
    else if (targetBallResult.startsWith('deep_fly'))         targetSwingLevel = clamp(targetSwingLevel, 65, 85);
    else if (targetBallResult.startsWith('line_drive'))       targetSwingLevel = clamp(targetSwingLevel, 55, 75);
    else if (targetBallResult.startsWith('grounder'))         targetSwingLevel = clamp(targetSwingLevel, 45, 65);
    else if (targetBallResult.startsWith('bloop'))            targetSwingLevel = clamp(targetSwingLevel, 25, 50);
  }

  return {
    predictedPitchType,
    predictedZone,
    biasStrength,          // 피드백에서 누적된 예측 신뢰도 (-1~+1)
    guardPitchType,        // §8-2 특별 경계 구종 (null 가능)
    tactic,
    targetBallResult,
    targetSwingLevel: Math.round(targetSwingLevel),
  };
}

// ── §4-5 투구 판단 ────────────────────────────────────────────────
//
// 흐름: 시각적 구종 인식 → 예측과 비교 → judgmentType/swingMod 결정
// swingMod 크기는 plan.biasStrength (이전 피드백 누적)에 의해 조정됨
//
// Yerkes-Dodson: 긴장할수록 위치 판단 오차 증가, 구종 판단 정확도 저하

/**
 * @param {Object} pitch           — { pitchType, pitchQuality, location }
 * @param {Object} plan            — { predictedPitchType, predictedZone, biasStrength }
 * @param {Object} batterState     — { eye, tension }
 * @param {string[]} knownPitchTypes — 투수의 알려진 구종 목록 (없으면 제한 없음)
 * @returns {Object} judgment
 */
export function judgePitch(pitch, plan, batterState, knownPitchTypes = []) {
  const { eye, tension } = batterState;
  const eyeNorm      = norm(eye);
  const pitchQuality = pitch.pitchQuality ?? 55;
  const loc          = pitch.location;
  const pitchType    = pitch.pitchType;
  const biasStrength = plan.biasStrength ?? 0;
  const hasKnown     = knownPitchTypes.length > 0;

  // ▶ Yerkes-Dodson: 긴장할수록 구종 판단 정확도 하락
  const tensionFactor    = getYerkesFactor(tension);
  const judgmentAccuracy = (eyeNorm * 0.6 - (pitchQuality / 100) * 0.4) * tensionFactor;

  // ── ① 시각적 구종 인식 ──
  // eye vs pitchQuality → 올바르게 읽을 확률 (예측과 무관한 순수 시각 인식)
  const readProb = clamp(eyeNorm * 0.65 - (pitchQuality / 100) * 0.35, 0.10, 0.85) * tensionFactor;
  let judgedPitchType;
  if (Math.random() < readProb) {
    judgedPitchType = pitchType;                                // 올바르게 읽음
  } else if (plan.predictedPitchType && Math.random() < clamp(0.45 + biasStrength * 0.35, 0.20, 0.80)) {
    // 선입견이 강할수록(biasStrength↑) 예측 구종으로 오인할 확률 상승 (0.20 ~ 0.80)
    judgedPitchType = plan.predictedPitchType;
  } else {
    // 오인: 레퍼토리 내 인접 구종으로만 제한 (레퍼토리 외 구종은 완전 제외)
    const adj = ADJACENT_TYPES[pitchType] ?? [];
    if (hasKnown) {
      const inRep = adj.filter(t => knownPitchTypes.includes(t));
      if (inRep.length > 0) {
        judgedPitchType = inRep[Math.floor(Math.random() * inRep.length)];
      } else {
        judgedPitchType = pitchType; // 인접 구종도 레퍼토리에 없으면 실제 구종으로
      }
    } else {
      judgedPitchType = adj.length > 0 ? adj[Math.floor(Math.random() * adj.length)] : pitchType;
    }
  }

  // ── ② 판단 유형: 시각 지각 vs 계획 예측 비교 ──
  // bias_confirmed/interfered/confused는 "내가 예상한 공으로 보이는가?"에서 결정됨
  // swingMod 크기는 biasStrength로 조정 (최근 예측이 맞았을수록 강화/약화 폭 증가)
  let judgmentType = 'neutral';
  let swingMod     = 1.0;

  if (plan.predictedPitchType) {
    if (judgedPitchType === plan.predictedPitchType) {
      if (judgedPitchType !== pitchType) {
        // 실제와 다른 공을 예측대로 잘못 읽음 → 진짜 선입견 강화 (착각)
        judgmentType = 'bias_confirmed';
        swingMod     = 1.0 + 0.10 * (1.0 + biasStrength * 0.5);
      } else {
        // 실제 구종을 올바르게 읽었고 예측도 맞음 → 정확 판단
        judgmentType = 'accurate_neutral';
        swingMod     = 1.03;
      }
    } else {
      const predictedIsFB = FASTBALL_TYPES.has(plan.predictedPitchType);
      const judgedIsFB    = FASTBALL_TYPES.has(judgedPitchType);
      if (predictedIsFB !== judgedIsFB) {
        judgmentType = 'category_confused';
        swingMod     = 1.0 - 0.20 * (1.0 + biasStrength * 0.3); // calcSwingLevel에서 추가 억제
      } else {
        judgmentType = 'bias_interfered';
        swingMod     = 1.0 - 0.08 * (1.0 + biasStrength * 0.3); // calcSwingLevel에서 추가 억제
      }
    }
  } else {
    // 예측구종 없음: 시각적으로 올바르게 읽었을 때만 accurate_neutral
    if (judgedPitchType === pitchType && Math.random() < judgmentAccuracy + 0.4) {
      judgmentType = 'accurate_neutral'; swingMod = 1.03;
    } else {
      judgmentType = 'neutral'; swingMod = 1.0;
    }
  }

  // ── 위치 판단 오차 ──
  let locationBias = 0;
  if (plan.predictedZone) {
    const actualZone = classifyZone(loc);
    locationBias = (actualZone === plan.predictedZone) ? -0.05 : 0.12;
  }
  if (judgmentType === 'category_confused') locationBias += 0.20;
  else if (judgmentType === 'bias_interfered') locationBias += 0.08;

  // ▶ Yerkes-Dodson: 긴장할수록 위치 판단 오차 추가
  const mistakeMod   = getYerkesMistakeMod(tension);
  let locErrorBase = (1 - eyeNorm) * 0.40 + (pitchQuality / 100) * 0.15 + mistakeMod * 0.15;

  // 구종 판단 성공 → 위치 오차 감소, 실패 → 오차 증가
  if (judgedPitchType === pitchType) {
    locErrorBase *= 0.65;
  } else {
    locErrorBase *= 1.40;
  }

  const judgedLocation = {
    x: loc.x + gaussRandom(0, locErrorBase + locationBias),
    y: loc.y + gaussRandom(0, locErrorBase + locationBias),
  };

  return {
    judgmentType,
    swingMod:          Math.round(swingMod * 100) / 100,
    judgedPitchType,
    actualPitchType:   pitchType,
    predictedCorrect:  plan.predictedPitchType === pitchType,
    wasBiasConfirmed:  judgmentType === 'bias_confirmed',
    judgedLocation,
    locationBias:      Math.round(locationBias * 100) / 100,
  };
}

// ── 존 오버랩 (strikeZoneOverlap) ────────────────────────────────

export function calcOverlap(loc) {
  const { x, y } = loc;
  const xDist    = Math.max(0, Math.abs(x) - ZONE_X);
  const yDist    = Math.max(0, Math.abs(y) - ZONE_Y);
  return clamp(1 - xDist / 0.5, 0, 1) * clamp(1 - yDist / 0.5, 0, 1);
}

// ── planMod ───────────────────────────────────────────────────────

export function getPlanMod(targetBallResult) {
  if (!targetBallResult) return 0;
  if (targetBallResult === 'take')                        return 0.50;
  if (targetBallResult === 'home_run')                    return -0.10;
  if (targetBallResult.startsWith('deep_fly'))            return -0.05;
  if (targetBallResult.startsWith('line_drive'))          return 0.00;
  if (targetBallResult.startsWith('grounder'))            return 0.00;
  if (targetBallResult.startsWith('bloop'))               return -0.08;
  if (targetBallResult === 'sharp_bunt' || targetBallResult === 'soft_bunt') return -0.10;
  return 0;
}

// ── 존 분류 ──────────────────────────────────────────────────────

export function classifyZone(loc) {
  if (loc.x < -ZONE_X * 0.5) return 'inside';
  if (loc.x >  ZONE_X * 0.5) return 'outside';
  if (loc.y >  ZONE_Y * 0.5) return 'high';
  if (loc.y < -ZONE_Y * 0.5) return 'low';
  return 'center';
}

// ── §4-6 스윙 레벨 생성 ──────────────────────────────────────────
//
// Yerkes-Dodson: 20 미만/65 초과 시 스윙 레벨 저하

/**
 * @param {Object} plan           — { targetSwingLevel, targetBallResult, tactic }
 * @param {Object} judgment       — { swingMod }
 * @param {number} overlap        — 0-1
 * @param {number} swingThreshold — 0-1
 * @param {Object} batterState    — { condition, tension }
 * @returns {number} swingLevel (0-100)
 */
export function calcSwingLevel(plan, judgment, overlap, swingThreshold, batterState) {
  const { condition, tension } = batterState;

  let rawSwingLevel = plan.targetSwingLevel;

  // 1. 오버랩 신뢰도 보정 — 계수 축소해서 극단값 방지
  rawSwingLevel += (overlap - swingThreshold) * 22;

  // 2. 투구 판단 결과 보정
  rawSwingLevel *= judgment.swingMod;

  // 3. 구종/위치 판단 혼란 시 추가 억제
  if (judgment.judgmentType === 'category_confused') {
    rawSwingLevel *= 0.55;
  } else if (judgment.judgmentType === 'bias_interfered') {
    rawSwingLevel *= 0.75;
  } else if (judgment.judgmentType === 'bias_confirmed') {
    // 착각으로 예측 구종처럼 보였지만 실제론 다른 공
    // 선입견으로 강하게 스윙하려 하지만 위치가 다르면 억제
    if (judgment.locationBias > 0.08) rawSwingLevel *= 0.80;
  }

  // 4. ▶ Yerkes-Dodson
  if (tension < 20)        rawSwingLevel *= 0.90;
  else if (tension > 65)   rawSwingLevel *= (1 - (tension - 65) / 200);

  // 5. 컨디션 보정
  rawSwingLevel *= (0.80 + condition / 100 * 0.20);

  // 6. 분산 — 편차 키워서 중간값도 자주 나오게
  return clamp(rawSwingLevel + gaussRandom(0, 8), 0, 100);
}

// ── §4-7 헛스윙 판정 ─────────────────────────────────────────────
//
// Yerkes-Dodson: 긴장할수록 헛스윙 확률 증가

/**
 * @param {Object} judgment    — { judgedLocation }
 * @param {Object} actualLoc   — { x, y }
 * @param {number} swingLevel
 * @param {number} contact     — 20-80 컨택 능력치
 * @param {number} pitchQuality
 * @param {Object} batterState — { tension }
 * @returns {{ isWhiff: boolean, whiffProb: number, locationError: number }}
 */
export function calcWhiff(judgment, actualLoc, swingLevel, contact, pitchQuality, batterState) {
  const { tension } = batterState;
  const mistakeMod  = getYerkesMistakeMod(tension);   // ▶ Yerkes
  const contactNorm = norm(contact);

  const locationError = calcLocationError(judgment.judgedLocation, actualLoc);
  const swingAggressiveness = swingLevel > 75 ? 1.15 : 1.0;

  // baseWhiff: pitchQuality 높을수록 기본 헛스윙 확률 상승 (구위 자체의 효과)
  const baseWhiff = 0.06 + (pitchQuality / 100) * 0.18;
  const whiffBase = baseWhiff + locationError * 0.55 * (1 - contactNorm * 0.55);

  // ▶ Yerkes-Dodson: 긴장할수록 헛스윙 확률 추가 증가
  const whiffProb = clamp(
    whiffBase * swingAggressiveness * (1 + mistakeMod * 0.5),
    0, 0.85
  );

  return {
    isWhiff: Math.random() < whiffProb,
    whiffProb,
    locationError,
  };
}

// ── §4-7 타구 퀄리티 산출 ────────────────────────────────────────
//
// Yerkes-Dodson: tensionFactor 곱연산 (이미 위쪽에서 conditionMod와 함께 적용)

/**
 * @param {number} swingLevel
 * @param {string} swingType
 * @param {number} locationError
 * @param {number} pitchQuality
 * @param {number} contact        — 20-80
 * @param {Object} batterState    — { condition, tension }
 * @returns {number} quality (0-100)
 */
export function calcContactQuality(swingLevel, swingType, locationError, pitchQuality, contact, batterState) {
  const { condition, tension } = batterState;
  const contactNorm = norm(contact);

  const locationBonus = Math.max(0, 1 - locationError) * 20;
  const pitchPenalty  = pitchQuality * 0.18; // 기존 0.3 → 0.18 (과도한 억제 완화)

  let baseQuality = contactNorm * 55
                  + swingLevel  * 0.25
                  + locationBonus
                  - pitchPenalty;

  if      (swingType === 'check_swing') baseQuality *= 0.35;
  else if (swingType === 'late_swing')  baseQuality *= 0.65;

  // ▶ Yerkes-Dodson: conditionMod × tensionFactor 곱연산
  const conditionMod  = condition / 100;
  const tensionFactor = getYerkesFactor(tension);
  baseQuality *= conditionMod * tensionFactor;

  return {
    quality:      clamp(baseQuality + gaussRandom(0, 5), 0, 100),
    conditionMod: Math.round(conditionMod   * 100) / 100,
    tensionFactor: Math.round(tensionFactor * 100) / 100,
  };
}

// ── §4-8 타구 벡터 생성 ──────────────────────────────────────────
//
// 개선 사항:
//   - baseExitVelo 상향: 110~175 km/h (이전: 90~140)
//   - swingBoost 상향: 최대 ±22.5 (이전: ±15)
//   - 홈런 기준: exitVelo > 130 km/h + 거리 > 85m
//   - Yerkes-Dodson: 긴장할수록 타구 방향/각도 분산 증가

/**
 * @param {number} quality
 * @param {number} swingLevel
 * @param {Object} pitch        — { location, pitchQuality }
 * @param {number} power        — 20-80
 * @param {Object} batterState  — { tension }
 * @param {string} [stadiumKey]  — 구장 키 (default: 'jamsil')
 * @returns {{ type, exitVelo, launchAngle, direction, estDist, wallDist, contactPoint }}
 */
export function calcBattingVector(quality, swingLevel, pitch, power, batterState, stadiumKey = 'jamsil') {
  const { tension } = batterState;
  const qualityNorm = quality / 100;
  const powerNorm   = norm(power);
  const mistakeMod  = getYerkesMistakeMod(tension);  // ▶ Yerkes: 분산 계수

  const loc = pitch.location;

  // 컨택 포인트 (Yerkes-Dodson: 긴장할수록 편차 증가)
  const spreadMod = 1 + mistakeMod * 0.6;
  const cx = -(loc.x / ZONE_X) * 0.70 + (1 - qualityNorm) * gaussRandom(0, 0.24 * spreadMod);
  // cy 평균 0: 공 중앙 타격 기준. 양수=땅볼, 음수=뜬공/홈런
  const cy =  gaussRandom(0, 0.40)  + (1 - qualityNorm) * gaussRandom(0, 0.25 * spreadMod);

  // ── exitVelo ──
  // power=50 기준 평균 타구속도 ~155km/h, power=80이면 ~185km/h
  const baseExitVelo = 135 + powerNorm * 50;    // 135 ~ 185 km/h
  const swingBoost   = (swingLevel - 50) * 0.40;
  const qualityScale = 0.78 + qualityNorm * 0.22;
  const exitVelo     = clamp(
    (baseExitVelo + swingBoost) * qualityScale + gaussRandom(0, 4),
    40, 210
  );

  // ── launchAngle ──
  const launchAngle = clamp(
    -cy * 45 + (1 - qualityNorm) * gaussRandom(0, 14 * spreadMod),
    -10, 90
  );

  // ── direction ──
  // cx*30: 당겨치기/밀어치기 기본 방향, gaussRandom으로 파울 비율 조절
  const dirSpread = (1 - qualityNorm) * 72 * spreadMod + 20;
  const direction  = 90 - cx * 30 + gaussRandom(0, dirSpread);

  // ── 타구 유형 분류 (서브타입 포함) ──
  let type;
  if      (quality < 10 || direction < -8 || direction > 188)  type = 'foul_back';
  else if (direction < 42 || direction > 138)                   type = 'foul';
  else if (launchAngle < 10) {
    if      (exitVelo < 110) type = 'weak_grounder';
    else if (exitVelo > 140) type = 'hard_grounder';
    else                     type = 'grounder';
  } else if (launchAngle < 25) {
    if      (exitVelo < 110) type = 'weak_line_drive';
    else if (exitVelo > 160) type = 'barrel_line_drive';
    else                     type = 'line_drive';
  } else if (launchAngle < 50)  type = 'fly_ball';
  else                          type = 'popup';

  // foul_back 추가 판정: 늦은 스윙 or 낮은 quality → 뒤로 빠질 확률
  if (type !== 'foul_back' && type !== 'foul') {
    const foulBackProb = (quality < 25 ? 0.15 : 0) + (launchAngle > 70 ? 0.20 : 0);
    if (foulBackProb > 0 && Math.random() < foulBackProb) type = 'foul_back';
  }

  // ── 거리 계산 및 장타 타구 판정 ──
  // fly_ball / line_drive 계열 → 구장 담장 거리 기반으로 deep_fly / home_run 승격
  let estDist = null;
  let wallDist = null;
  const isAirball = type === 'fly_ball'
    || type === 'line_drive' || type === 'weak_line_drive' || type === 'barrel_line_drive';
  if (isAirball && launchAngle > 10 && direction > 30 && direction < 150) {
    const v = exitVelo / 3.6;
    const rad = launchAngle * Math.PI / 180;
    estDist = Math.round(v * v * Math.sin(2 * rad) / 9.8 * 0.60);

    wallDist = getWallDistance(stadiumKey, direction);

    if (estDist >= wallDist) {
      type = 'home_run';
    } else if (estDist >= wallDist - 18) {
      type = 'deep_fly';
    }
  }

  return {
    type,
    exitVelo:     Math.round(exitVelo),
    launchAngle:  Math.round(launchAngle),
    direction:    Math.round(direction),
    estDist,
    wallDist,
    // §4-8 스핀: cx/cy 기반 sidespin/topspin/backspin
    spin: {
      side:  Math.round(cx * 1000) / 1000,   // cx > 0 당겨치기 훅, cx < 0 밀어치기 슬라이스
      top:   cy > 0 ? Math.round(cy * 100) / 100 : 0,   // 탑스핀 (땅볼 경향)
      back:  cy < 0 ? Math.round(-cy * 100) / 100 : 0,  // 백스핀 (뜬공/홈런 경향)
    },
    contactPoint: { cx: Math.round(cx * 100) / 100, cy: Math.round(cy * 100) / 100 },
  };
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

function calcLocationError(judgedLoc, actualLoc) {
  const dx = judgedLoc.x - actualLoc.x;
  const dy = judgedLoc.y - actualLoc.y;
  const judgmentError = Math.sqrt(dx * dx + dy * dy);
  // 존 안 공은 positionError 0 — 존 밖으로 나갈수록만 패널티
  const outX = Math.max(0, Math.abs(actualLoc.x) - ZONE_X) / ZONE_X;
  const outY = Math.max(0, Math.abs(actualLoc.y) - ZONE_Y) / ZONE_Y;
  const positionError = Math.sqrt(outX ** 2 + outY ** 2) / 1.5;
  return positionError + judgmentError * 0.5;
}
