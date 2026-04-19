/**
 * pitchEngine.js — 투구 알고리즘 순수 함수 모음
 *
 * GAME_MECHANICS §3 기반.
 * 이 파일은 순수 함수(상태 없음)만 포함합니다.
 * 모든 상태는 PitchSimulator 클래스가 관리하고 인자로 전달합니다.
 *
 * Yerkes-Dodson 법칙은 아래 모든 단계에 적용됩니다:
 *   - 투구 퀄리티 (tensionFactor 곱연산)
 *   - Control 반경 (긴장 → 범위 증가)
 *   - Command 인력 (긴장 → 인력 감소)
 *   - 실수 확률 (긴장 → 실수 빈도 증가)
 *   - 구속 (긴장 → 구속 미세 감소)
 */

import {
  clamp, rand, lerp, gaussRandom, norm, weightedPick,
  ZONE_X, ZONE_Y, BALL_R,
  getYerkesMistakeMod, getYerkesFactor, getYerkesErrorMod,
  FASTBALL_TYPES, BREAKING_TYPES, PITCH_TYPE_LABELS,
  ARM_SIDE_PITCHES, GLOVE_SIDE_PITCHES,
} from './simUtils';

// ── 카운트별 전략 테이블 ──────────────────────────────────────────

const COUNT_FB_BIAS = {
  '0-0': 0.05, '0-1': -0.05, '0-2': -0.15,
  '1-0': 0.10, '1-1': 0.00,  '1-2': -0.10,
  '2-0': 0.20, '2-1': 0.10,  '2-2': 0.00,
  '3-0': 0.35, '3-1': 0.20,  '3-2': 0.10,
};

// waste = 1 - zoneProb - edgeProb
// 목표 ball rate ~38-40% (현재 32.3%)
// → waste 비율을 전 카운트 8~10%p 상향, 투수 유리 카운트(0-2, 1-2)는 더 공격적으로 올림
const COUNT_LOCATION_STRATEGY = {
  '0-0': { zoneProb: 0.47, edgeProb: 0.32 }, // waste 0.21 (↑0.10)
  '0-1': { zoneProb: 0.40, edgeProb: 0.32 }, // waste 0.28 (↑0.10)
  '0-2': { zoneProb: 0.13, edgeProb: 0.34 }, // waste 0.53 (↑0.09) — 유인구 적극
  '1-0': { zoneProb: 0.52, edgeProb: 0.29 }, // waste 0.19 (↑0.10)
  '1-1': { zoneProb: 0.43, edgeProb: 0.32 }, // waste 0.25 (↑0.10)
  '1-2': { zoneProb: 0.23, edgeProb: 0.38 }, // waste 0.39 (↑0.11)
  '2-0': { zoneProb: 0.63, edgeProb: 0.22 }, // waste 0.15 (↑0.09) — 스트라이크 필요
  '2-1': { zoneProb: 0.48, edgeProb: 0.30 }, // waste 0.22 (↑0.10)
  '2-2': { zoneProb: 0.38, edgeProb: 0.37 }, // waste 0.25 (↑0.10)
  '3-0': { zoneProb: 0.76, edgeProb: 0.15 }, // waste 0.09 (↑0.05) — 볼넷 위기, 스트라이크 급함
  '3-1': { zoneProb: 0.60, edgeProb: 0.25 }, // waste 0.15 (↑0.09)
  '3-2': { zoneProb: 0.48, edgeProb: 0.31 }, // waste 0.21 (↑0.10)
};

// ── 존 가장자리 최근접점 ──────────────────────────────────────────

/**
 * 존 경계(edge) 위의 가장 가까운 점을 반환합니다.
 *
 * - 존 외부 → 경계로 클램프 (기존 nearestZonePoint와 동일)
 * - 존 내부 → 가장 가까운 경계선 방향 (코너·엣지 지향 커맨드)
 */
export function nearestZoneEdgePoint(x, y) {
  const isInsideX = Math.abs(x) <= ZONE_X;
  const isInsideY = Math.abs(y) <= ZONE_Y;

  if (!isInsideX || !isInsideY) {
    return { x: clamp(x, -ZONE_X, ZONE_X), y: clamp(y, -ZONE_Y, ZONE_Y) };
  }

  // 존 내부: 네 경계선까지의 거리 중 최솟값 방향으로
  const dLeft   = x + ZONE_X;
  const dRight  = ZONE_X - x;
  const dBottom = y + ZONE_Y;
  const dTop    = ZONE_Y - y;
  const minD = Math.min(dLeft, dRight, dBottom, dTop);

  if (minD === dLeft)   return { x: -ZONE_X, y };
  if (minD === dRight)  return { x:  ZONE_X, y };
  if (minD === dBottom) return { x, y: -ZONE_Y };
  return { x, y:  ZONE_Y };
}

// ── §3-4 구종 선택 ────────────────────────────────────────────────

/**
 * @param {Array}               pitchTypes         — [{ type, velo, pct }, ...]
 * @param {Object}              pitchTypeCondition — { '4seam': 70, ... }
 * @param {string}              countKey           — '0-0' ~ '3-2'
 * @param {Object|null}         feedback
 * @param {Object|null}         atBatContext       — { prevAtBatsVsBatter, lineupSignal } (§8-3)
 * @param {'same'|'opposite'|null} handMatchup     — 손잡이 매치업
 * @returns {{ pitchType: Object, reasoning: string[] }}
 */
export function selectPitchType(pitchTypes, pitchTypeCondition, countKey, feedback, atBatContext = null, handMatchup = null) {
  if (!pitchTypes.length) {
    return { pitchType: { type: '4seam', velo: 145, pct: 100 }, reasoning: [] };
  }

  const fbBias   = COUNT_FB_BIAS[countKey] ?? 0;
  const reasoning = [];

  // ── §8-3 배터리 히스토리 가중치 보정 ──
  // 직전 타석 결과를 기반으로 포수가 구종 선택을 조정한다.
  const historyWeights = {};
  const prevABs = atBatContext?.prevAtBatsVsBatter ?? [];
  if (prevABs.length > 0) {
    const lastAB = prevABs[prevABs.length - 1];
    if (lastAB?.endingPitchType) {
      if (lastAB.result === 'strikeout') {
        // 삼진 결정구 → 타자가 경계할 것 → 회피 (단, 2타석 연속 삼진이면 반대로 재사용)
        const sameKO = prevABs.length >= 2 &&
          prevABs[prevABs.length - 2]?.result === 'strikeout' &&
          prevABs[prevABs.length - 2]?.endingPitchType === lastAB.endingPitchType;
        historyWeights[lastAB.endingPitchType] = sameKO ? 1.30 : 0.75;
        if (sameKO) reasoning.push(`2타석 연속 ${PITCH_TYPE_LABELS[lastAB.endingPitchType]}에 삼진 → 재사용.`);
        else        reasoning.push(`직전 타석 ${PITCH_TYPE_LABELS[lastAB.endingPitchType]}으로 삼진 → 타자 경계 예상, 회피.`);
      } else if (lastAB.result === 'hit' || lastAB.result === 'home_run') {
        // 안타/홈런 → 그 구종 가중치 감소
        historyWeights[lastAB.endingPitchType] = lastAB.result === 'home_run' ? 0.60 : 0.80;
        reasoning.push(`직전 타석 ${PITCH_TYPE_LABELS[lastAB.endingPitchType]} ${lastAB.result === 'home_run' ? '홈런' : '안타'} → 구종 회피.`);
      } else if (lastAB.result === 'walk') {
        // 볼넷 → 스트라이크 선취 강화 (구종 가중치는 유지, zoneProb은 pitchEngine selectTarget에서 처리)
        reasoning.push(`직전 타석 볼넷 → 스트라이크 선취 집중.`);
      }
    }
  }

  // ── 손잡이 매치업 가중치 ──
  // same(동일손): 글러브사이드(슬라이더·커브) 선호, 암사이드(체인지업·싱커·투심·포크) 회피
  // opposite(반대손): 암사이드 적극 사용, 글러브사이드 감소
  const handWeights = {};
  if (handMatchup === 'same') {
    for (const t of ARM_SIDE_PITCHES)   handWeights[t] = 0.40;  // 체인지업·싱커 등 대폭 감소
    for (const t of GLOVE_SIDE_PITCHES) handWeights[t] = 1.40;  // 슬라이더·커브 선호
    handWeights['cutter'] = 1.15;                               // 커터 소폭 유리
    if (!reasoning.some(r => r.includes('동일손'))) {
      reasoning.push('동일손 매치업 — 글러브사이드(슬라이더·커브) 선호, 암사이드 구종 회피.');
    }
  } else if (handMatchup === 'opposite') {
    for (const t of ARM_SIDE_PITCHES)   handWeights[t] = 1.55;  // 역스플릿 구종 적극 사용
    for (const t of GLOVE_SIDE_PITCHES) handWeights[t] = 0.70;  // 슬라이더·커브 감소
    handWeights['cutter'] = 1.05;
    if (!reasoning.some(r => r.includes('반대손'))) {
      reasoning.push('반대손 매치업 — 암사이드(체인지업·싱커·투심·포크) 적극 활용.');
    }
  }

  const items = pitchTypes.map(pt => {
    let weight = pt.pct;
    const isFB = FASTBALL_TYPES.has(pt.type);
    weight *= (1 + (isFB ? fbBias : -fbBias * 0.5));

    // 구종 컨디션 선호
    const ptCond = pitchTypeCondition[pt.type] ?? 70;
    weight *= (ptCond / 70);

    // 손잡이 매치업 보정
    if (handWeights[pt.type] != null) weight *= handWeights[pt.type];

    // 배터리 히스토리 보정
    if (historyWeights[pt.type] != null) weight *= historyWeights[pt.type];

    if (feedback) {
      if (feedback.lastPitchType === pt.type) weight *= 0.7;
      if (feedback.lastResult === 'swinging_strike' && feedback.lastPitchType === pt.type)
        weight *= 1.5;
      if (feedback.lastResult === 'in_play_hard' && feedback.lastPitchType === pt.type)
        weight *= 0.4;
    }
    return { ...pt, weight: Math.max(weight, 0.1) };
  });

  const picked  = weightedPick(items);
  const ptCond  = Math.round(pitchTypeCondition[picked.type] ?? 70);

  if (fbBias >= 0.20)  reasoning.push(`${countKey} — 볼카운트 불리. 패스트볼 비중 높임.`);
  else if (fbBias <= -0.12) reasoning.push(`${countKey} — 투수 유리. 변화구 비중 높임.`);

  if (ptCond >= 80)    reasoning.push(`${PITCH_TYPE_LABELS[picked.type]} 컨디션 ${ptCond} — 오늘 잘 먹히는 구종.`);
  else if (ptCond <= 55) reasoning.push(`${PITCH_TYPE_LABELS[picked.type]} 컨디션 ${ptCond} — 오늘 불안한 구종.`);

  if (feedback) {
    const lastLabel = PITCH_TYPE_LABELS[feedback.lastPitchType] || feedback.lastPitchType;
    if (feedback.lastResult === 'swinging_strike' && feedback.lastPitchType === picked.type)
      reasoning.push(`직전 ${lastLabel}에 헛스윙 → 같은 구종 반복.`);
    else if (feedback.lastPitchType && feedback.lastPitchType !== picked.type)
      reasoning.push(`${lastLabel} → ${PITCH_TYPE_LABELS[picked.type]} 구종 변경.`);
  }

  return { pitchType: picked, reasoning };
}

// ── §3-4 목표 위치 선택 ──────────────────────────────────────────

/**
 * @returns {{ target: {x,y}, reasoning: string[], locationZone: string }}
 */
export function selectTarget(countKey, pitchType, feedback) {
  const strategy = COUNT_LOCATION_STRATEGY[countKey] || { zoneProb: 0.55, edgeProb: 0.30 };
  const roll      = Math.random();
  const reasoning = [];

  let x, y, locationZone;

  if (roll < strategy.zoneProb) {
    x = gaussRandom(0, 0.45);
    y = gaussRandom(0, 0.55);
    x = clamp(x, -ZONE_X * 0.85, ZONE_X * 0.85);
    y = clamp(y, -ZONE_Y * 0.85, ZONE_Y * 0.85);
    locationZone = 'zone';
  } else if (roll < strategy.zoneProb + strategy.edgeProb) {
    const side = Math.random();
    if (side < 0.25) {
      x = rand(-ZONE_X * 1.2, -ZONE_X * 0.7); y = gaussRandom(0, 0.6); locationZone = 'inside';
    } else if (side < 0.5) {
      x = rand(ZONE_X * 0.7, ZONE_X * 1.2);   y = gaussRandom(0, 0.6); locationZone = 'outside';
    } else if (side < 0.75) {
      x = gaussRandom(0, 0.5); y = rand(ZONE_Y * 0.7, ZONE_Y * 1.15);  locationZone = 'high';
    } else {
      x = gaussRandom(0, 0.5); y = rand(-ZONE_Y * 1.15, -ZONE_Y * 0.7); locationZone = 'low';
    }
  } else {
    // 유인구 — 구종 계열별 방향성 적용
    const wasteRoll = Math.random();
    const isFB = FASTBALL_TYPES.has(pitchType?.type || pitchType);
    if (isFB) {
      // 직구 계열: 바깥쪽(45%) / 높은 쪽 헛스윙 유도(35%) / 낮은 바깥(20%)
      if (wasteRoll < 0.45) {
        x = rand(ZONE_X * 1.2, ZONE_X * 2.0); y = gaussRandom(0, 0.5);
      } else if (wasteRoll < 0.80) {
        x = gaussRandom(0, 0.4); y = rand(ZONE_Y * 1.2, ZONE_Y * 2.0);
      } else {
        x = rand(ZONE_X * 0.8, ZONE_X * 1.8); y = rand(-ZONE_Y * 1.8, -ZONE_Y * 1.0);
      }
    } else {
      // 변화구/체인지업: 낮은 바깥쪽(50%) / 바깥쪽(30%) / 낮은 쪽(20%)
      if (wasteRoll < 0.50) {
        x = rand(ZONE_X * 0.3, ZONE_X * 1.8); y = rand(-ZONE_Y * 2.0, -ZONE_Y * 1.2);
      } else if (wasteRoll < 0.80) {
        x = rand(ZONE_X * 1.0, ZONE_X * 2.0); y = gaussRandom(-0.3, 0.5);
      } else {
        x = gaussRandom(0, 0.5); y = rand(-ZONE_Y * 2.0, -ZONE_Y * 1.3);
      }
    }
    locationZone = 'waste';
  }

  const locationDesc = {
    zone:    '존 안 직접 승부.', inside:  '안쪽 코너 공략.',
    outside: '바깥쪽 코너 공략.', high: '높은 코스 노림.',
    low:     '낮은 코스 — 땅볼/헛스윙 유도.', waste: '웨이스트 피치 — 유인구.',
  };
  reasoning.push(locationDesc[locationZone] || '');

  if (BREAKING_TYPES.has(pitchType?.type || pitchType)) y -= 0.25;
  if (feedback?.lastLocation) { x -= feedback.lastLocation.x * 0.15; y -= feedback.lastLocation.y * 0.1; }

  return {
    target: { x: clamp(x, -2.5, 2.5), y: clamp(y, -ZONE_Y * 2, ZONE_Y * 2) },
    reasoning,
    locationZone,
  };
}

// ── §3-4 투구 의도 생성 ───────────────────────────────────────────

export function generateIntent(countKey, pitchTypeName, locationZone, situation) {
  const [balls, strikes] = countKey.split('-').map(Number);
  let expectedResult = 'called_strike';
  let targetCount    = countKey;

  if (strikes === 2) {
    expectedResult = BREAKING_TYPES.has(pitchTypeName) ? 'swinging_strike' : 'called_strike';
    targetCount    = '삼진';
  } else if (balls >= 3) {
    expectedResult = 'called_strike'; targetCount = '볼넷 회피';
  } else if (locationZone === 'waste') {
    expectedResult = 'swinging_strike'; targetCount = `${balls}-${strikes + 1}`;
  } else if (locationZone === 'low') {
    expectedResult = 'groundball';
  }

  return { expectedResult, targetCount };
}

// ── §3-7 투구 퀄리티 생성 ─────────────────────────────────────────
//
// Yerkes-Dodson 적용:
//   tensionFactor = getYerkesFactor(tension) — 전체 퀄리티 스케일
//   mistakeMod    = getYerkesMistakeMod(tension) — 실수 확률에 가중

/**
 * @param {Object} pitcherState — { stuff, command, control, stamina,
 *                                   condition, physique, tension,
 *                                   isExhausted, pitchTypeCondition }
 * @param {string} pitchType
 * @param {Object} attrs        — { focus, resilience }
 * @returns {Object} qualityData
 */
export function generatePitchQuality(pitcherState, pitchType, attrs) {
  const { stuff, condition, physique, tension, isExhausted, pitchTypeCondition } = pitcherState;

  const stuffNorm      = norm(stuff);
  const ptCond         = (pitchTypeCondition[pitchType] ?? 70) / 100;
  const conditionMod   = condition / 100;
  const focusNorm      = norm(attrs.focus ?? 50);
  const resilienceNorm = norm(attrs.resilience ?? 50);
  const attributesMod  = focusNorm * 0.5 + resilienceNorm * 0.5;

  const base = stuffNorm * 0.35
             + ptCond    * 0.30
             + conditionMod * 0.20
             + attributesMod * 0.15;

  // ▶ Yerkes-Dodson: 체력 × 긴장도 효율 팩터
  // physique 낮아질수록 퀄리티 저하 가속 (비선형)
  // physique=100 → 1.0, physique=50 → ~0.82, physique=20 → ~0.55 (지침 진입)
  // physique < 20 → 지침 상태로 고정 0.45
  const physiqueMod = physique < 20
    ? 0.45
    : 1.0 - Math.pow((100 - physique) / 100, 1.8) * 0.55;
  const tensionFactor = getYerkesFactor(tension);   // 1.0 ~ 0.75
  const multiplier   = physiqueMod * tensionFactor;

  const mean = base * 100 * multiplier;

  // ▶ Yerkes-Dodson: 실수 확률에 긴장도 반영
  const mistakeMod  = getYerkesMistakeMod(tension);
  const mistakeProb = mistakeMod + (1 - focusNorm) * 0.05;
  const isMistake   = Math.random() < mistakeProb;

  let stddev = 8;
  if (isExhausted) stddev = 14;
  if (isMistake)   stddev = 22;

  let quality;
  if (isMistake) {
    quality = clamp(gaussRandom(15, 8), 0, 35);
  } else {
    quality = gaussRandom(mean, stddev);
  }

  return {
    pitchQuality: clamp(Math.round(quality), 0, 100),
    isMistake,
    physiqueMod:  Math.round(physiqueMod * 100) / 100,
    tensionFactor: Math.round(tensionFactor * 100) / 100,
    conditionMod: Math.round(conditionMod * 100) / 100,
    ptCondition:  Math.round(pitchTypeCondition[pitchType] ?? 70),
    mistakeMod:   Math.round(mistakeMod * 100) / 100,
  };
}

// ── §3-8 투구 실행 ────────────────────────────────────────────────
//
// Yerkes-Dodson 적용:
//   controlRadius  : 긴장할수록 증가 (제구 범위 넓어짐)
//   pullStrength   : 긴장할수록 감소 (커맨드 인력 약해짐)
//   velocity       : 긴장할수록 미세 감소

/**
 * @param {Object} plan         — { pitchType, targetVelo, target }
 * @param {Object} qualityData  — { pitchQuality }
 * @param {Object} pitcherState — { command, control, condition, tension,
 *                                   isExhausted, pitchCount }
 * @param {number} stamina      — 20-80 (구속 피로 계산용)
 * @returns {Object} execution result
 */
export function executePitch(plan, qualityData, pitcherState, stamina) {
  const { pitchType, targetVelo, target } = plan;
  const { pitchQuality } = qualityData;
  const {
    command, control, condition, tension,
    isExhausted, pitchCount,
  } = pitcherState;

  const commandNorm    = norm(command);
  const controlNorm    = norm(control);
  const conditionMod   = condition / 100;
  const mistakeMod     = getYerkesMistakeMod(tension);    // 0 ~ 0.25
  const tensionFactor  = getYerkesFactor(tension);        // 1.0 ~ 0.75
  const errorMod       = getYerkesErrorMod(tension);      // 0 ~ 0.10

  // ── 구속 (§3-8) ──
  // targetVelo = 평균 구속. 자연 편차 ±3.5km/h
  // 피로/긴장으로 평균 구속 자체가 최대 -5km/h 하락
  const fatigueDrop = Math.max(0, (pitchCount - 70) / 30) * (1 - norm(stamina) * 0.6) * 1.5;
  const tensionDrop = Math.max(0, (tension - 65) / 35) * 1.5;
  const avgVelo     = targetVelo - Math.min(5, fatigueDrop + tensionDrop); // 평균 구속 하락 최대 -5
  const velocity    = Math.round((avgVelo + gaussRandom(0, 3.5)) * 10) / 10;

  // ── Control → 도달 범위 (§3-8) ──
  // Yerkes-Dodson: 긴장할수록 controlRadius 증가 (errorMod 추가)
  const controlEffective = controlNorm * conditionMod * (isExhausted ? 0.7 : 1.0);
  const controlRadius    = (1.2 - controlEffective * 0.9) * (1 + mistakeMod);
  // control 80 정상 → 0.30, stddev ≈ 0.18
  // control 50 정상 → 0.75, stddev ≈ 0.44
  // control 20 정상 → 1.20, stddev ≈ 0.71

  const rawLocation = {
    x: gaussRandom(target.x, controlRadius * 0.59 + errorMod),
    y: gaussRandom(target.y, controlRadius * 0.59 + errorMod),
  };

  // ── Command → 존 가장자리 인력 (§3-8) ──
  // Yerkes-Dodson: 긴장할수록 pullStrength 감소 (커맨드 약해짐)
  const commandEffective = commandNorm * conditionMod;
  const pullStrength     = commandEffective * 0.45 * (1 - mistakeMod * 0.8);

  const edgePoint = nearestZoneEdgePoint(rawLocation.x, rawLocation.y);
  const finalLocation = {
    x: clamp(rawLocation.x + (edgePoint.x - rawLocation.x) * pullStrength, -3.0, 3.0),
    y: clamp(rawLocation.y + (edgePoint.y - rawLocation.y) * pullStrength, -ZONE_Y * 2.2, ZONE_Y * 2.2),
  };

  const result = classifyPitch(finalLocation);

  const baseReturn = {
    pitchType, velocity, target, location: finalLocation,
    controlRadius:  Math.round(controlRadius * 100) / 100,
    pullStrength:   Math.round(pullStrength  * 100) / 100,
    mistakeMod:     Math.round(mistakeMod    * 100) / 100,
  };

  // 폭투 체크
  if (Math.abs(finalLocation.y) > ZONE_Y * 1.8 || Math.abs(finalLocation.x) > 2.2) {
    return { type: 'wild_pitch', result: 'wild_pitch', description: '폭투 (제구 실패)', ...baseReturn };
  }

  // HBP 체크
  if (finalLocation.x < -1.6 && Math.abs(finalLocation.y) < 1.0 && Math.random() < 0.6) {
    return { type: 'hit_by_pitch', result: 'hit_by_pitch', description: '몸에 맞는 공 (제구 실패)', ...baseReturn };
  }

  return { type: 'normal', result, ...baseReturn };
}

// ── 투구 판정 ─────────────────────────────────────────────────────

export function classifyPitch(location) {
  const { x, y } = location;
  // ABS (자동 볼-스트라이크 판정) — 오차 없이 존 경계 + 공 반경으로 정확 판정
  const inZone = Math.abs(x) <= (ZONE_X + BALL_R)
              && Math.abs(y) <= (ZONE_Y + BALL_R);
  return inZone ? 'called_strike' : 'ball';
}

// ── 비정상 투구 체크 ──────────────────────────────────────────────
//
// Yerkes-Dodson: 긴장할수록 비정상 투구 확률 증가

/**
 * @param {number} pitchCount
 * @param {Object} pitcherState — { tension, isExhausted, physique }
 * @param {Object} attrs        — { focus, competitiveness, resilience }
 * @param {Object} situation    — { outs, runners }
 * @returns {Object|null}
 */
export function checkAbnormal(pitchCount, pitcherState, attrs, situation) {
  const { tension, isExhausted, physique } = pitcherState;
  const mistakeMod = getYerkesMistakeMod(tension);

  let abnormalProb = 0.008;
  abnormalProb += (1 - norm(attrs.focus ?? 50)) * 0.012;
  abnormalProb += mistakeMod * 0.020;    // ▶ Yerkes: 긴장 → 비정상 증가
  if (isExhausted) abnormalProb += 0.02;

  const fatigue = Math.max(0, (pitchCount - 60) / 40);
  abnormalProb += fatigue * (1 - norm(attrs.stamina ?? 50)) * 0.015;

  const hasRunners = situation.runners
    && (situation.runners.first || situation.runners.second || situation.runners.third);
  if (hasRunners) abnormalProb += 0.003;

  const scoringPos = situation.runners?.second || situation.runners?.third;
  if (scoringPos && (situation.outs ?? 0) < 2)
    abnormalProb += (1 - norm(attrs.competitiveness ?? 50)) * 0.008;

  if (Math.random() >= abnormalProb) return null;

  const controlNorm = norm(attrs.control ?? 50);
  const roll = Math.random();

  if (hasRunners && roll < 0.15) {
    const balkTypes = ['투구 동작 중 중단', '세트 포지션 위반', '1루 견제 실패'];
    return { type: 'balk', description: balkTypes[Math.floor(Math.random() * balkTypes.length)] };
  }
  if (roll < 0.55 + (1 - controlNorm) * 0.2) {
    return {
      type: 'wild_pitch', description: '폭투',
      location: { x: gaussRandom(0, 1.5), y: rand(-ZONE_Y * 2.0, -ZONE_Y * 1.3) },
    };
  }
  return {
    type: 'hit_by_pitch', description: '몸에 맞는 공',
    location: { x: rand(-1.8, -1.3), y: rand(-ZONE_Y * 0.4, ZONE_Y * 0.6) },
  };
}

// ── 피드백 생성 ───────────────────────────────────────────────────

export function generateFeedback(pitchResult) {
  return {
    lastPitchType: pitchResult.pitchType,
    lastLocation:  pitchResult.location,
    lastTarget:    pitchResult.target,
    lastVelocity:  pitchResult.velocity,
    lastResult:    pitchResult.result,
  };
}
