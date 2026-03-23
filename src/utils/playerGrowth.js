/**
 * playerGrowth.js
 * 선수 성장 시스템
 *
 * 두 가지 커브를 곱해서 현재 실제 능력치를 결정한다:
 *
 *   실제 능력치 = 기준 능력치 × 성장계수(나이) × 적응계수(리그 경험)
 *
 * ┌─────────────────────────────────────────────┐
 * │ 1. 포텐셜 성장 커브  — 나이/커리어 아크 기반  │
 * │    - 선수마다 전성기 나이, 성장속도, 하락속도  │
 * │    - 20-80 스케일 능력치에 곱해지는 배율      │
 * │                                             │
 * │ 2. 적응 커브  — 리그/환경 적응 기반           │
 * │    - 이적/리그 이동 시 발동                  │
 * │    - 시즌 내 진행도(0~1)로 계산              │
 * └─────────────────────────────────────────────┘
 */

/* ─────────────────────────────────────────────
   1. 포텐셜 성장 커브
   ───────────────────────────────────────────── */

/**
 * 성장 타입 정의
 *
 * peakAgeOffset: 포지션 평균 전성기 나이에서 ±N세
 * ceilingMult:   기준 능력치 대비 전성기 피크 배율 (1.0 = 성장 없음, 1.2 = 20% 성장)
 * growthShape:   성장 곡선 형태 ('linear' | 'sigmoid')
 * declineRate:   전성기 이후 나이당 하락 비율
 */
export const GROWTH_TYPES = {
  // 반짝형: 극단적으로 짧은 전성기, 급락 — 원히트 원더
  FLASH: {
    id: 'flash', label: '반짝형',
    peakAgeOffset: -3, ceilingMult: 1.09,
    growthShape: 'linear', declineRate: 0.065,
    peakWindow: 1,
    prob: 0.02,  // 7% → 2%
  },
  // 조기소진형: 일찍 피크, 빠른 하락 — 고졸 에이스 패턴
  BURNOUT: {
    id: 'burnout', label: '조기소진형',
    peakAgeOffset: -2, ceilingMult: 1.06,
    growthShape: 'linear', declineRate: 0.042,
    peakWindow: 2,
    prob: 0.05,  // 10% → 5%
  },
  // 조기 전성기: 조금 일찍 피크, 보통 하락
  EARLY_PEAK: {
    id: 'early_peak', label: '조기 전성기',
    peakAgeOffset: -1, ceilingMult: 1.08,
    growthShape: 'sigmoid', declineRate: 0.030,
    peakWindow: 2,
    prob: 0.13,
  },
  // 표준 성장: 가장 일반적인 커리어 아크
  STANDARD: {
    id: 'standard', label: '표준 성장',
    peakAgeOffset: 0, ceilingMult: 1.10,
    growthShape: 'sigmoid', declineRate: 0.022,
    peakWindow: 3,
    prob: 0.46,  // 28% → 46% (BURNOUT 감소분 흡수)
  },
  // 꾸준형: 완만하게 성장, 긴 고원, 느린 하락 — 롱런 선수
  STEADY: {
    id: 'steady', label: '꾸준형',
    peakAgeOffset: +1, ceilingMult: 1.08,
    growthShape: 'sigmoid', declineRate: 0.016,
    peakWindow: 3,
    prob: 0.18,  // 16% → 18%
  },
  // 만개형: 느리게 성장, 늦게 피크, 완만한 하락
  LATE_BLOOM: {
    id: 'late_bloom', label: '만개형',
    peakAgeOffset: +3, ceilingMult: 1.18,
    growthShape: 'sigmoid', declineRate: 0.018,
    peakWindow: 4,
    prob: 0.11,  // 13% → 11%
  },
  // 철인형: 40대 초반까지 고원 유지 → 급격히 하락
  IRON: {
    id: 'iron', label: '철인형',
    peakAgeOffset: +2, ceilingMult: 1.07,
    growthShape: 'linear', declineRate: 0.070,
    peakWindow: 14,
    prob: 0.04,  // 7% → 4%
  },
  // 레전드형: 극히 희귀, 늦은 피크, 높은 천장, 오랜 고원
  LEGEND: {
    id: 'legend', label: '레전드형',
    peakAgeOffset: +4, ceilingMult: 1.22,
    growthShape: 'sigmoid', declineRate: 0.012,
    peakWindow: 5,
    prob: 0.01,  // 6% → 1%
  },
};

// 포지션별 평균 전성기 나이
const POSITION_PEAK_AGE = {
  SP: 28, RP: 27, CP: 27,
  C: 28, '1B': 28, '2B': 27, '3B': 28, SS: 27,
  OF: 27, LF: 27, CF: 26, RF: 27,
  default: 28,
};

/**
 * 선수의 포텐셜 성장 프로파일 생성 (숨겨진 값)
 *
 * @param {number} currentAge - 현재 나이
 * @param {string} position   - 포지션
 * @param {string} [forcedType] - 강제 지정 타입 (테스트용)
 * @returns {Object} growthProfile
 */
export function generateGrowthProfile(currentAge, position = 'default', forcedType = null) {
  const type = forcedType
    ? GROWTH_TYPES[forcedType]
    : pickWeighted(Object.values(GROWTH_TYPES));

  const basePeakAge = POSITION_PEAK_AGE[position] || POSITION_PEAK_AGE.default;
  // 전성기 나이: 타입 오프셋 + 개인 편차 ±1 (±3은 타입 특성과 겹쳐 극단값 발생)
  const peakAge = basePeakAge + type.peakAgeOffset + randInt(-1, 1);

  // 현재 성장 단계 파악
  const phase = currentAge < peakAge ? 'growth'
    : currentAge === peakAge ? 'peak'
    : 'decline';

  return {
    type,
    peakAge,
    peakWindow: type.peakWindow + randInt(-1, 1), // 전성기 지속 기간 (개인 편차 ±1년)
    ceilingMult: type.ceilingMult,
    declineRate: type.declineRate + rand(-0.003, 0.003), // 개인 편차
    phase,
  };
}

/**
 * 특정 나이에서의 성장 계수 계산 (0.5 ~ 1.2 범위)
 *
 * 전성기 이전: 나이에 따라 기준치 → 피크(ceilingMult)로 상승
 * 전성기 이후: 피크 → 나이당 declineRate씩 감소
 *
 * @param {number} age      - 현재 나이
 * @param {Object} profile  - generateGrowthProfile() 결과
 * @returns {number} growthFactor (1.0 기준)
 */
export function calcGrowthFactor(age, profile) {
  const { peakAge, ceilingMult, declineRate, type, peakWindow = 0 } = profile;
  const declineStart = peakAge + peakWindow; // 하락 시작 나이 (전성기 고원 끝)

  // 전성기 고원: peakAge ~ declineStart 동안 최고 계수 유지
  if (age >= peakAge && age <= declineStart) {
    return ceilingMult;
  }

  // 하락기: declineStart 이후부터 나이당 declineRate씩 감소
  // 7년 경과 후 가속 (실제 선수 은퇴 패턴)
  if (age > declineStart) {
    const yearsAfterPeak = age - declineStart;
    let factor = ceilingMult;
    for (let y = 1; y <= yearsAfterPeak; y++) {
      const currentAge = declineStart + y;
      const accel = Math.max(1.0, 1.0 + (y - 7) * 0.12);    // 7년 경과 후 가속
      // 40세부터 신체 하락 가속, 44세부터 더욱 가파름
      // 40→×1.20  41→×1.40  42→×1.60  43→×1.80
      // 44→×2.20  45→×2.60  46→×3.00 ...
      const ageAccel = currentAge >= 44 ? 1.0 + (currentAge - 39) * 0.40
                     : currentAge >= 40 ? 1.0 + (currentAge - 39) * 0.20
                     : 1.0;
      const yr = Math.min(0.28, declineRate * accel * ageAccel);
      factor *= (1 - yr);
    }
    return Math.max(0.05, factor); // 능력치 clamp(20~80)이 실제 하한 — floor를 낮춰 flatline 방지
  }

  // 성장기
  const yearsTopeak = peakAge - age;
  const totalGrowthYears = peakAge - 18; // 18세 기준

  if (type.growthShape === 'sigmoid') {
    // S커브: 초반 느리게 성장 → 중반 급성장 → 전성기 수렴
    const t = 1 - yearsTopeak / totalGrowthYears;
    const sigmoid = 1 / (1 + Math.exp(-8 * (t - 0.5)));
    return 0.60 + sigmoid * (ceilingMult - 0.60);
  } else {
    // 선형: 일정 속도로 성장
    const t = Math.max(0, 1 - yearsTopeak / totalGrowthYears);
    return 0.65 + t * (ceilingMult - 0.65);
  }
}

/**
 * 나이 범위에 걸친 성장 커브 배열 반환 (시각화용)
 * @returns {Array<{age, factor}>}
 */
export function getGrowthCurve(profile, fromAge = 18, toAge = 40) {
  return Array.from({ length: toAge - fromAge + 1 }, (_, i) => {
    const age = fromAge + i;
    return { age, factor: calcGrowthFactor(age, profile) };
  });
}

/* ─────────────────────────────────────────────
   2. 적응 커브
   ───────────────────────────────────────────── */

/**
 * 적응 타입 정의
 *
 * ipThreshold: 완전 적응에 필요한 이닝 수 (리그 보정 전)
 *   SP 기준 1시즌 ≈ 150IP, RP 기준 1시즌 ≈ 65IP
 *   → NORMAL(240IP) = SP 1.6시즌 ≈ RP 3.7시즌
 * ceiling: 최대 적응 계수 (1.0 = 완전 적응)
 * floor:   최소 적응 계수 (이닝 0일 때)
 * speed:   sigmoid 기울기 (높을수록 특정 구간에서 급격히 상승)
 */
export const ADAPTATION_TYPES = {
  EARLY: {
    id: 'early', label: '조기 적응형',
    ipThreshold: 150, speed: 8.0, ceiling: 1.00, floor: 0.90,
    prob: 0.25,
    desc: '첫 시즌부터 거의 풀 퍼포먼스. 1~1.5시즌 완성',
  },
  NORMAL: {
    id: 'normal', label: '일반 적응형',
    ipThreshold: 240, speed: 5.0, ceiling: 1.00, floor: 0.72,
    prob: 0.45,
    desc: '1.5~2시즌에 걸쳐 안정. SP 기준 약 2년',
  },
  SLOW: {
    id: 'slow', label: '느린 적응형',
    ipThreshold: 360, speed: 3.5, ceiling: 1.00, floor: 0.55,
    prob: 0.20,
    desc: '2~3시즌에 걸쳐 천천히 올라옴',
  },
  BUST: {
    id: 'bust', label: '부적응형',
    ipThreshold: 500, speed: 2.0, ceiling: 0.72, floor: 0.48,
    prob: 0.10,
    desc: '리그 스타일 불일치. 최대 적응도 72%',
  },
};

/**
 * 적응 프로파일 생성 (숨겨진 값)
 *
 * @param {string} sourceLeague - 출신 리그 ('MLB'|'AAA'|'NPB'|'KBO')
 * @param {string} [forcedType] - 강제 지정 타입 (테스트용)
 */
export function generateAdaptationProfile(sourceLeague = 'KBO', forcedType = null) {
  // KBO 경험자: 적응 부담 없음
  if (sourceLeague === 'KBO') {
    return {
      type: { id: 'native', label: 'KBO 경험자' },
      sourceLeague,
      ipThreshold: 0, speed: 99, ceiling: 1.00, floor: 1.00,
    };
  }

  // KBO 신인: 같은 문화권이지만 1군 레벨 적응 필요
  // ipThreshold가 짧음 — SP 기준 1시즌(150IP) 내외로 완성
  if (sourceLeague === 'KBO_ROOKIE') {
    const rookieTypes = {
      FAST:   { id: 'rookie_fast',   label: '빠른 적응', ipThreshold: 100, speed: 8.0, ceiling: 1.00, floor: 0.82, prob: 0.30 },
      NORMAL: { id: 'rookie_normal', label: '보통 적응', ipThreshold: 150, speed: 5.5, ceiling: 1.00, floor: 0.70, prob: 0.50 },
      SLOW:   { id: 'rookie_slow',   label: '느린 적응', ipThreshold: 220, speed: 3.5, ceiling: 1.00, floor: 0.58, prob: 0.20 },
    };
    const type = forcedType ? rookieTypes[forcedType] : pickWeighted(Object.values(rookieTypes));
    return { type, sourceLeague, ipThreshold: type.ipThreshold, speed: type.speed, ceiling: type.ceiling, floor: type.floor };
  }

  const type = forcedType
    ? ADAPTATION_TYPES[forcedType]
    : pickWeighted(Object.values(ADAPTATION_TYPES));

  // 출신 리그별 ipThreshold 보정
  // MLB: 문화·스타일 차이 커서 더 많은 이닝 필요 (×1.4)
  // NPB: KBO와 가까워서 빠름 (×0.80)
  // AAA: 마이너리그 특성 (×1.1)
  const leagueModifier = {
    MLB: { thresholdMult: 1.40, floorAdj: +0.02 },
    AAA: { thresholdMult: 1.10, floorAdj:  0.00 },
    NPB: { thresholdMult: 0.80, floorAdj: +0.05 },
  }[sourceLeague] || { thresholdMult: 1.0, floorAdj: 0 };

  return {
    type,
    sourceLeague,
    ipThreshold: Math.round(type.ipThreshold * leagueModifier.thresholdMult),
    speed:   type.speed,
    ceiling: type.ceiling,
    floor:   Math.min(1.0, type.floor + leagueModifier.floorAdj),
  };
}

/**
 * 누적 이닝(cumulativeIP) 기반 적응 계수 계산
 *
 * 이닝을 소화할수록 리그에 적응 → ceiling에 수렴
 * ipThreshold = 완전 적응에 필요한 총 이닝
 *
 * @param {number} cumulativeIP  - 해당 리그에서 소화한 누적 이닝
 * @param {Object} profile       - generateAdaptationProfile() 결과
 * @returns {number} adaptationFactor (floor ~ ceiling)
 */
export function calcAdaptationFactor(cumulativeIP, profile) {
  const { speed, ceiling, floor, ipThreshold } = profile;

  // threshold=0이면 즉시 완전 적응
  if (!ipThreshold || ipThreshold <= 0) return ceiling;

  // t: 0(이닝 0) → 1(threshold 도달, 완전 적응)
  const t = Math.min(1, cumulativeIP / ipThreshold);

  // threshold 완전 도달 시 정확히 ceiling 반환 (sigmoid 근사 오차 제거)
  if (t >= 1) return ceiling;

  // sigmoid: t=0.5 지점에서 급격히 상승
  const sigmoid = 1 / (1 + Math.exp(-speed * (t - 0.5)));
  const factor = floor + sigmoid * (ceiling - floor);

  return Math.min(ceiling, Math.max(floor * 0.90, factor));
}

/**
 * 적응 커브 배열 반환 (시각화용)
 *
 * @param {Object} profile        - generateAdaptationProfile() 결과
 * @param {number} avgIPPerSeason - 시즌당 평균 이닝 (SP≈150, RP≈65)
 * @param {number} seasons        - 표시할 시즌 수
 * @returns {Array<{progress, ip, factor}>}
 *   progress: 시즌 단위 (0.0~seasons) — 차트 x축용
 *   ip: 누적 이닝
 */
export function getAdaptationCurve(profile, avgIPPerSeason = 100, seasons = 3) {
  const points = [];
  const steps = seasons * 12;
  for (let i = 0; i <= steps; i++) {
    const progress = i / 12;                     // 시즌 단위
    const ip = progress * avgIPPerSeason;         // 누적 이닝
    points.push({
      progress,
      ip,
      factor: calcAdaptationFactor(ip, profile),
    });
  }
  return points;
}

/* ─────────────────────────────────────────────
   3. 특성(Attributes) 기반 성장 보정
   ───────────────────────────────────────────── */

/**
 * 선수 특성이 성장 시스템에 미치는 영향 계산
 *
 * attributes 테이블 컬럼:
 *   work_ethic   → 전성기 연장, 하락 완화
 *   resilience   → 슬럼프/부상 회복 속도
 *   focus        → 시즌 성적 분산 감소 (일관성)
 *   durability   → 부상 확률 감소
 *   adaptability → 적응 커브 속도 증가
 *   competitiveness → 중요 상황 퍼포먼스 (추후)
 *   leadership   → 팀 효과 (추후)
 *
 * @param {Object} attributes - DB attributes 객체 (20-80 스케일)
 * @returns {Object} modifiers
 */
export function calcAttributeModifiers(attributes = {}) {
  const attr = key => Number(attributes?.[key] ?? 50);

  // 50이 기준(0 효과), 범위 20-80
  const norm = key => (attr(key) - 50) / 30; // -1.0 ~ +1.0

  return {
    // 전성기 연장 년수: work_ethic 80 → +3년, 20 → -3년
    peakExtensionYears: Math.round(norm('work_ethic') * 3),

    // 하락 속도 보정: work_ethic 높을수록 완만
    // 0.7(완만) ~ 1.3(가파름)
    declineRateMultiplier: 1.0 - norm('work_ethic') * 0.3,

    // 성장 속도 보정: work_ethic + competitiveness 평균
    // 0.85 ~ 1.15
    growthRateMultiplier: 1.0 + (norm('work_ethic') * 0.5 + norm('competitiveness') * 0.5) * 0.15,

    // 부상 확률: durability 80 → 3%, 50 → 10%, 20 → 20%
    injuryProb: Math.max(0.02, 0.10 - norm('durability') * 0.07),

    // 부상 후 회복 속도: resilience 기반 (0.3 ~ 1.0)
    injuryRecoveryRate: 0.65 + norm('resilience') * 0.35,

    // 슬럼프 회복 속도: resilience 기반
    slumpRecoveryRate: 0.5 + norm('resilience') * 0.5,

    // 시즌 성적 분산: focus 높을수록 일관 (플루크/슬럼프 폭 감소)
    // 1.0(기준) → 0.6(집중력 높음) ~ 1.4(집중력 낮음)
    seasonVarianceScale: 1.0 - norm('focus') * 0.4,

    // 적응 속도 배율: adaptability 기반
    adaptationSpeedMultiplier: 0.7 + (norm('adaptability') + 1) * 0.3, // 0.7 ~ 1.3
  };
}

/* ─────────────────────────────────────────────
   4. 부상 시스템
   ───────────────────────────────────────────── */

export const INJURY_TYPES = {
  MINOR:    { id: 'minor',    label: '경상',   ipReductionRate: 0.25, abilityPenalty: 0.05, recoverySeasons: 0.5 },
  MODERATE: { id: 'moderate', label: '중상',   ipReductionRate: 0.55, abilityPenalty: 0.15, recoverySeasons: 1.0 },
  SEVERE:   { id: 'severe',   label: '중증',   ipReductionRate: 0.85, abilityPenalty: 0.30, recoverySeasons: 2.0 },
  CAREER:   { id: 'career',   label: '커리어',  ipReductionRate: 1.00, abilityPenalty: 0.45, recoverySeasons: 99  },
};

/**
 * 시즌 시작 시 부상 여부 및 강도 결정
 *
 * @param {Object} attributes - 선수 특성
 * @param {Object|null} lastInjury - 직전 시즌 부상 기록 (회복 중이면 재발 위험)
 * @returns {Object|null} injury 객체 또는 null (무부상)
 */
export function rollInjury(attributes = {}, lastInjury = null) {
  const mods = calcAttributeModifiers(attributes);
  let prob = mods.injuryProb;

  // 직전 시즌 부상 → 재발 위험 소폭 증가
  if (lastInjury) prob *= 1.2;

  if (Math.random() > prob) return null;

  // 부상 강도 결정 (durability가 낮을수록 중상 확률 높음)
  const durNorm = (Number(attributes?.durability ?? 50) - 20) / 60; // 0~1
  const r = Math.random();

  let injuryType;
  if (r < 0.50 + durNorm * 0.20)      injuryType = INJURY_TYPES.MINOR;
  else if (r < 0.80 + durNorm * 0.10) injuryType = INJURY_TYPES.MODERATE;
  else if (r < 0.97)                  injuryType = INJURY_TYPES.SEVERE;
  else                                injuryType = INJURY_TYPES.CAREER;

  return {
    ...injuryType,
    recoveryProgress: 0, // 0 = 회복 안 됨, 1 = 완전 회복
  };
}

/**
 * 시즌 종료 후 부상 회복 처리
 * 회복력(resilience)이 높을수록 빠르게 recoveryProgress 증가
 *
 * @returns {Object|null} 업데이트된 injury 또는 null (완전 회복)
 */
export function progressInjuryRecovery(injury, attributes = {}) {
  if (!injury) return null;
  const mods = calcAttributeModifiers(attributes);
  const recoveryPerSeason = mods.injuryRecoveryRate / injury.recoverySeasons;
  const newProgress = Math.min(1, injury.recoveryProgress + recoveryPerSeason);
  return newProgress >= 1 ? null : { ...injury, recoveryProgress: newProgress };
}


/* ─────────────────────────────────────────────
   6. 시즌 종료 후 능력치 업데이트
   ───────────────────────────────────────────── */

/**
 * 시즌 종료 후 능력치 업데이트 (핵심 함수)
 *
 * 로직:
 *   1. pitcherEval이 새 시즌 데이터로 계산한 observedAbility가 들어옴
 *   2. 성장 곡선의 기대값(growthExpected)과 블렌딩
 *   3. 운(luck), 부상, 특성 보정 적용
 *   4. 관성(inertia) — 능력치 급변 방지
 *
 * 성장 곡선의 역할:
 *   - 플루크 시즌에 능력치가 너무 많이 오르는 걸 억제
 *   - 슬럼프 시즌에도 너무 많이 떨어지는 걸 완충
 *   - 하지만 완전히 막지는 않음 (실제 데이터가 중요)
 *
 * @param {number} currentAbility    - 현재 저장된 능력치
 * @param {number} observedAbility   - pitcherEval 재계산값 (새 시즌 데이터 기반)
 * @param {number} growthExpected    - 성장 곡선 기대값 (calcGrowthFactor 기반)
 * @param {Object} params
 *   @param {number} params.ip             - 해당 시즌 이닝 수
 *   @param {Object} params.attributes     - 선수 특성
 *   @param {Object|null} params.injury    - rollInjury() 결과
 *   @param {boolean} params.isGrowthPhase - 성장기 여부
 * @returns {number} 업데이트된 능력치
 */
export function updateAbilityAfterSeason(
  currentAbility,
  observedAbility,
  growthExpected,
  { ip = 60, attributes = {}, injury = null, isGrowthPhase = false } = {}
) {
  // ── 데이터 신뢰도 (IP 기반) ──
  const dataTrust = Math.min(ip / 120, 1.0);

  // ── 성장 곡선과 관측값 블렌딩 ──
  const curveTrust = isGrowthPhase ? 0.4 : 0.25;
  const observedTrust = (1 - curveTrust) * dataTrust;
  const remainTrust = 1 - curveTrust - observedTrust;

  const blended = (
    growthExpected   * curveTrust    +
    observedAbility  * observedTrust +
    currentAbility   * remainTrust
  );

  // ── 부상 패널티 ──
  let afterInjury = blended;
  if (injury) {
    const recoveryRatio = 1 - injury.recoveryProgress;
    afterInjury = blended * (1 - injury.abilityPenalty * recoveryRatio);
  }

  // ── 관성: 이전 능력치의 일부 보존 (급변 방지) ──
  const inertia = 0.20;
  const result = currentAbility * inertia + afterInjury * (1 - inertia);

  return Math.max(20, Math.min(80, Math.round(result)));
}

/**
 * 5대 능력치 전체에 시즌 업데이트 적용
 *
 * @param {Object} currentRatings  - 현재 { stuff, command, control, holding, stamina }
 * @param {Object} observedRatings - pitcherEval이 새 시즌 데이터로 계산한 값
 * @param {Object} growthProfile   - generateGrowthProfile() 결과
 * @param {number} currentAge
 * @param {Object} params          - updateAbilityAfterSeason 나머지 파라미터
 * @returns {Object} 업데이트된 5대 능력치
 */
export function updateAllAbilitiesAfterSeason(
  currentRatings,
  observedRatings,
  growthProfile,
  currentAge,
  params = {}
) {
  const growthFactor = calcGrowthFactor(currentAge, growthProfile);
  const isGrowthPhase = currentAge < growthProfile.peakAge;

  return Object.fromEntries(
    Object.keys(currentRatings).map(key => {
      const current  = currentRatings[key]  ?? 50;
      const observed = observedRatings[key] ?? current;
      // 성장 곡선 기대값: 현재 능력치에 성장 계수 적용
      const growthExpected = Math.round(current * (growthFactor / calcGrowthFactor(currentAge - 1, growthProfile)));

      return [key, updateAbilityAfterSeason(
        current, observed, growthExpected,
        { ...params, isGrowthPhase }
      )];
    })
  );
}

/* ─────────────────────────────────────────────
   7. 시즌 시뮬레이션 진입점
   ───────────────────────────────────────────── */

/**
 * 시즌 시작 전 — 해당 시즌 상태 결정
 *
 * 시뮬레이션에서 매 시즌 이 함수를 호출해서
 * "이번 시즌 이 선수에게 어떤 일이 일어날지" 결정
 *
 * @param {Object} player          - { age, attributes, growthProfile, adaptationProfile, lastInjury, lastLuck }
 * @param {number} seasonProgress  - 리그 경험 진행도 (toLeagueProgress로 계산)
 * @returns {Object} seasonState
 */
export function resolveSeasonState(player, seasonProgress) {
  const { age, attributes, growthProfile, adaptationProfile, lastInjury, lastLuck } = player;

  const mods = calcAttributeModifiers(attributes);

  // 성장 계수
  const growthFactor = calcGrowthFactor(age, growthProfile);

  // 적응 계수 (적응 속도에 adaptability 보정 적용)
  const adjustedAdaptProfile = {
    ...adaptationProfile,
    speed: adaptationProfile.speed * mods.adaptationSpeedMultiplier,
  };
  const adaptationFactor = calcAdaptationFactor(seasonProgress, adjustedAdaptProfile);

  // 부상 여부
  const injury = rollInjury(attributes, lastInjury);

  // 이번 시즌 실효 능력치 배율
  const injuryFactor = injury
    ? (1 - injury.abilityPenalty * (1 - injury.recoveryProgress))
    : 1.0;
  const effectiveMultiplier = growthFactor * adaptationFactor * injuryFactor;

  return {
    growthFactor,
    adaptationFactor,
    injury,
    effectiveMultiplier,
    isGrowthPhase: age < growthProfile.peakAge,
  };
}

/* ─────────────────────────────────────────────
   3. 통합: 현재 실제 능력치
   ───────────────────────────────────────────── */

/**
 * 현재 시점의 실제 능력치 계산
 *
 * @param {number} baseAbility      - 기준 능력치 (20-80 스케일)
 * @param {number} growthFactor     - calcGrowthFactor() 결과
 * @param {number} adaptationFactor - calcAdaptationFactor() 결과
 * @returns {number} 실제 현재 능력치 (20-80)
 */
export function calcCurrentAbility(baseAbility, growthFactor, adaptationFactor) {
  const raw = baseAbility * growthFactor * adaptationFactor;
  return Math.max(20, Math.min(80, Math.round(raw)));
}

/**
 * 선수의 5대 능력치 전체에 성장+적응 계수 적용
 *
 * @param {Object} baseRatings      - { stuff, command, control, holding, stamina }
 * @param {number} growthFactor     - calcGrowthFactor() 결과
 * @param {number} adaptationFactor - calcAdaptationFactor() 결과
 * @returns {Object} 현재 실제 능력치
 */
export function applyGrowthToRatings(baseRatings, growthFactor, adaptationFactor) {
  return Object.fromEntries(
    Object.entries(baseRatings).map(([key, val]) => [
      key,
      val != null ? calcCurrentAbility(val, growthFactor, adaptationFactor) : null,
    ])
  );
}

/* ─────────────────────────────────────────────
   유틸
   ───────────────────────────────────────────── */

function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function randInt(min, max) {
  return Math.round(rand(min, max));
}
function pickWeighted(items) {
  const r = Math.random();
  let acc = 0;
  for (const item of items) {
    acc += item.prob;
    if (r < acc) return item;
  }
  return items[items.length - 1];
}
