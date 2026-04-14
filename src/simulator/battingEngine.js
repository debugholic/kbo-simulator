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
 * 이전 투구 피드백으로 예측 신뢰도 강도 계산 (최근 3구 기준).
 * @param {Array} pitchHistory — [{ actualPitchType, predictedPitchType, predictedCorrect }]
 * @returns {number} -1 (불신뢰) ~ +1 (신뢰)
 */
function computeBiasStrength(pitchHistory) {
  const relevant = pitchHistory.filter(p => p.predictedPitchType !== null).slice(-3);
  if (!relevant.length) return 0;
  const correct = relevant.filter(p => p.predictedCorrect).length;
  return clamp((correct / relevant.length) * 2 - 1, -1, 1);
}

/**
 * 카운트 + 이전 투구 히스토리 기반 구종 예측.
 * 실제 투구 구종을 사용하지 않음 — 타자는 공이 오기 전에 알 수 없음.
 * knownPitchTypes: 상대 투수의 알려진 구종 목록 (레퍼토리) 내에서만 예측.
 *
 * @param {string[]} knownPitchTypes — 투수 레퍼토리 (e.g. ['4seam','slider','changeup'])
 */
function predictPitchType(count, pitchHistory, eyeNorm, tensionFactor, knownPitchTypes) {
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
 * @param {Object}   count          — { balls, strikes }
 * @param {Array}    pitchHistory   — 이번 타석 이전 투구 기록
 *                                    [{ actualPitchType, predictedPitchType, predictedCorrect }]
 * @param {Object}   batterState    — { eye, power, tension }
 * @param {string[]} knownPitchTypes — 상대 투수의 알려진 구종 (레퍼토리)
 * @returns {Object} plan
 */
export function generateBattingPlan(count, pitchHistory, batterState, knownPitchTypes = []) {
  const { balls, strikes } = count;
  const { eye, power, tension } = batterState;
  const eyeNorm   = norm(eye);
  const powerNorm = norm(power);
  const tensionFactor = getYerkesFactor(tension);

  // ── 피드백 기반 바이어스 강도 ──
  // 최근 예측이 맞았을수록 +, 틀렸을수록 — → 다음 판단의 swingMod 크기에 반영
  const biasStrength = computeBiasStrength(pitchHistory);

  // ── 예측 구종 (카운트 + 히스토리 기반, 실제 구종 미사용) ──
  // 반드시 투수의 알려진 레퍼토리 내에서만 예측
  const predictedPitchType = predictPitchType(count, pitchHistory, eyeNorm, tensionFactor, knownPitchTypes);

  // ── 예측 존 ──
  let predictedZone = null;
  const zonePredictProb = (eyeNorm * 0.25 + 0.10) * tensionFactor;
  if (Math.random() < zonePredictProb) {
    const zones = ['inside', 'outside', 'high', 'low', 'center'];
    predictedZone = zones[Math.floor(Math.random() * zones.length)];
  }

  // ── 작전 ──
  let tactic = 'full_swing';
  if (balls === 3 && strikes < 2 && Math.random() < 0.3) tactic = 'take';
  if (strikes === 2) tactic = 'contact';

  // ── 목표 타구 ──
  let targetBallResult = null;
  if (tactic === 'contact') {
    const r = Math.random();
    if      (r < 0.3) targetBallResult = 'grounder_any';
    else if (r < 0.6) targetBallResult = 'line_drive_center';
  } else if (tactic === 'full_swing') {
    const r = Math.random();
    if      (powerNorm > 0.6 && r < 0.2)  targetBallResult = 'home_run';
    else if (r < 0.35)                     targetBallResult = 'line_drive_center';
    else if (r < 0.50)                     targetBallResult = 'deep_fly_any';
  }

  // ── 목표 스윙 레벨 ──
  let targetSwingLevel;
  if      (tactic === 'take')    targetSwingLevel = 0;
  else if (tactic === 'contact') targetSwingLevel = 50 + Math.random() * 20;
  else                           targetSwingLevel = 75 + Math.random() * 25;

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
  } else if (plan.predictedPitchType && Math.random() < 0.55) {
    judgedPitchType = plan.predictedPitchType;                  // 예측한 구종으로 오인
  } else {
    // 인접 구종 중 알려진 레퍼토리에 있는 것을 우선 선택
    // 레퍼토리에 없는 구종은 매우 낮은 확률(3%)로만 인식
    const adj = ADJACENT_TYPES[pitchType] ?? [];
    let candidates;
    if (hasKnown) {
      const inRepertoire    = adj.filter(t => knownPitchTypes.includes(t));
      const notInRepertoire = adj.filter(t => !knownPitchTypes.includes(t));
      // 레퍼토리 외 구종 인식 확률: 약 3% (설마 저 구종을 장착했나? 수준)
      const OUTSIDE_WEIGHT = 0.03;
      const totalWeight = inRepertoire.length + notInRepertoire.length * OUTSIDE_WEIGHT;
      if (totalWeight <= 0) {
        candidates = [pitchType];
      } else {
        const r = Math.random() * totalWeight;
        let acc = 0;
        candidates = null;
        for (const t of inRepertoire) {
          acc += 1;
          if (r < acc) { candidates = [t]; break; }
        }
        if (!candidates) {
          for (const t of notInRepertoire) {
            acc += OUTSIDE_WEIGHT;
            if (r < acc) { candidates = [t]; break; }
          }
        }
        if (!candidates) candidates = inRepertoire.length ? inRepertoire : [pitchType];
      }
      judgedPitchType = candidates[0];
    } else {
      judgedPitchType = adj?.length ? adj[Math.floor(Math.random() * adj.length)] : pitchType;
    }
  }

  // ── ② 판단 유형: 시각 지각 vs 계획 예측 비교 ──
  // bias_confirmed/interfered/confused는 "내가 예상한 공으로 보이는가?"에서 결정됨
  // swingMod 크기는 biasStrength로 조정 (최근 예측이 맞았을수록 강화/약화 폭 증가)
  let judgmentType = 'neutral';
  let swingMod     = 1.0;

  if (plan.predictedPitchType) {
    if (judgedPitchType === plan.predictedPitchType) {
      // 시각적으로 예측한 구종으로 인식 → 선입견 강화
      // biasStrength > 0: 최근 예측이 맞았음 → 더 강하게 강화
      // biasStrength < 0: 최근 예측이 틀렸음 → 강화 폭 감소
      judgmentType = 'bias_confirmed';
      swingMod     = 1.0 + 0.10 * (1.0 + biasStrength * 0.5);
    } else {
      const predictedIsFB = FASTBALL_TYPES.has(plan.predictedPitchType);
      const judgedIsFB    = FASTBALL_TYPES.has(judgedPitchType);
      if (predictedIsFB !== judgedIsFB) {
        judgmentType = 'category_confused';
        swingMod     = 1.0 - 0.35 * (1.0 + biasStrength * 0.3);
      } else {
        judgmentType = 'bias_interfered';
        swingMod     = 1.0 - 0.15 * (1.0 + biasStrength * 0.3);
      }
    }
  } else {
    if (Math.random() < judgmentAccuracy + 0.4) {
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
  const locErrorBase = (1 - eyeNorm) * 0.3 + (pitchQuality / 100) * 0.15 + mistakeMod * 0.15;

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

  // 1. 오버랩 신뢰도 보정
  rawSwingLevel += (overlap - swingThreshold) * 40;

  // 2. 투구 판단 결과 보정
  rawSwingLevel *= judgment.swingMod;

  // 3. ▶ Yerkes-Dodson: 20 미만/65 초과 시 스윙 레벨 저하
  if (tension < 20)        rawSwingLevel *= 0.90;
  else if (tension > 65)   rawSwingLevel *= (1 - (tension - 65) / 200);

  // 4. 컨디션 보정
  rawSwingLevel *= (0.80 + condition / 100 * 0.20);

  return clamp(rawSwingLevel + gaussRandom(0, 3), 0, 100);
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
  const whiffBase = locationError * 0.6 * (1 - contactNorm * 0.6);

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
  const pitchPenalty  = pitchQuality * 0.3;

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
  const spreadMod = 1 + mistakeMod * 0.6;  // 1.0 ~ 1.15
  // loc.x 영향 강화(0.35→0.70): 몸쪽=당겨치기, 바깥=밀어치기
  const cx = -(loc.x / ZONE_X) * 0.70 + (1 - qualityNorm) * gaussRandom(0, 0.24 * spreadMod);
  const cy =  gaussRandom(-0.1, 0.35)  + (1 - qualityNorm) * gaussRandom(0, 0.25 * spreadMod);

  // ── exitVelo ──
  const baseExitVelo = 110 + powerNorm * 65;    // 110 ~ 175 km/h
  const swingBoost   = (swingLevel - 50) * 0.45; // -22.5 ~ +22.5
  const qualityScale = 0.55 + qualityNorm * 0.45;
  const exitVelo     = clamp(
    (baseExitVelo + swingBoost) * qualityScale + gaussRandom(0, 3),
    30, 200
  );

  // ── launchAngle ──
  const launchAngle = clamp(
    -cy * 45 + (1 - qualityNorm) * gaussRandom(0, 14 * spreadMod),
    -10, 90
  );

  // ── direction ──
  // cx coefficient 45, 방향 분산 크게 → 파울 자주 발생
  const dirSpread = (1 - qualityNorm) * 38 * spreadMod + 4;
  const direction  = 90 - cx * 45 + gaussRandom(0, dirSpread);

  // ── 타구 유형 분류 ──
  // 파울라인: fieldPos(0, ...) = 3루선, fieldPos(180, ...) = 1루선
  // direction 0~180 = 페어 구역, 그 외 = 파울
  let type;
  if      (quality < 10 || direction < -10 || direction > 190) type = 'foul_back';
  else if (direction < 0 || direction > 180)                    type = 'foul';
  else if (launchAngle < 10)                                    type = 'grounder';
  else if (launchAngle < 25)                                    type = 'line_drive';
  else if (launchAngle < 50)                                    type = 'fly_ball';
  else                                                          type = 'popup';

  // ── 거리 계산 및 장타 타구 판정 ──
  // fly_ball / line_drive → 구장 담장 거리 기반으로 타구 세분화
  let estDist = null;
  let wallDist = null;
  if ((type === 'fly_ball' || type === 'line_drive') &&
      launchAngle > 10 && direction > 15 && direction < 165) {
    const v = exitVelo / 3.6;
    const rad = launchAngle * Math.PI / 180;
    // 0.60: 공기 저항 보정 계수 (진공 이론치의 약 60%)
    estDist = Math.round(v * v * Math.sin(2 * rad) / 9.8 * 0.60);

    wallDist = getWallDistance(stadiumKey, direction);

    if (estDist >= wallDist) {
      // 담장 너머 → 홈런
      type = 'home_run';
    } else if (estDist >= wallDist - 18) {
      // 담장 18m 이내 → 깊은 외야 (담장 직격 / 희생플라이 등)
      type = 'deep_fly';
    }
    // estDist < wallDist - 18: 일반 fly_ball 유지
  }

  return {
    type,
    exitVelo:     Math.round(exitVelo),
    launchAngle:  Math.round(launchAngle),
    direction:    Math.round(direction),
    estDist,
    wallDist,
    contactPoint: { cx: Math.round(cx * 100) / 100, cy: Math.round(cy * 100) / 100 },
  };
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

function calcLocationError(judgedLoc, actualLoc) {
  const dx = judgedLoc.x - actualLoc.x;
  const dy = judgedLoc.y - actualLoc.y;
  const judgmentError  = Math.sqrt(dx * dx + dy * dy);
  const positionError  = Math.sqrt((actualLoc.x / ZONE_X) ** 2 + (actualLoc.y / ZONE_Y) ** 2) / 1.5;
  return positionError + judgmentError * 0.5;
}
