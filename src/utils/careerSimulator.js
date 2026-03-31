/**
 * careerSimulator.js
 * 투수 커리어 시뮬레이션 엔진
 *
 * GrowthSimDemo(데모 UI)와 실제 게임 시즌 시뮬 양쪽에서 동일하게 사용할 수 있도록
 * UI 의존성 없이 순수 로직만 담는다.
 *
 * 핵심 흐름:
 *   1. generateSeasonStats  — 현재 능력치 → 시즌 통계 (ERA/K9/IP 등)
 *   2. evalFromStats         — 시즌 통계 → 측정 능력치
 *   3. simulateCareer        — 성장 곡선 × 적응도 × 부상 × 성적 루프 (가변 시즌, 은퇴 포함)
 *   4. runDistribution       — N회 시뮬 → OVR 분포 (팬차트용, activePct 포함)
 */

import {
  generateGrowthProfile,
  calcGrowthFactor,
  generateAdaptationProfile,
  calcAdaptationFactor,
  rollInjury,
  progressInjuryRecovery,
} from './playerGrowth';

/* ─────────────────────────────────────────────
   상수
   ───────────────────────────────────────────── */

// potential 1~10 → OVR 천장 [min, max]
// 각 구간 폭 7, 인접 레벨 간 2~3 OVR 겹침
//   S(73+) / A(66-72) / B(58-65) / C(50-57) / D(42-49) / E(<42)
export const POTENTIAL_CEILING = {
  1:  [33, 39],  // E 하위 — 함량 미달
  2:  [38, 44],  // E 상위 — 방출 위기        ←overlap 2
  3:  [43, 49],  // D 하위 — 하위 백업        ←overlap 2
  4:  [48, 54],  // D 상위 — 백업/교체        ←overlap 2
  5:  [52, 58],  // C      — 리그 평균        ←overlap 3
  6:  [56, 62],  // C 상위 — 평균 이상        ←overlap 3
  7:  [59, 65],  // B      — 상급 주전        ←overlap 3
  8:  [62, 67],  // B 상위 — 올스타급         ←overlap 3 (max=A 하위 경계)
  9:  [66, 72],  // A      — 리그 최정상      ←overlap 1 (S 미진입)
  10: [73, 80],  // S      — 역대급           (순수 S등급)
};

// KBO 리그 기준값 (시뮬 평가용)
export const KBO_LEAGUE_STATS = {
  era:  { avg: 4.50, std: 1.00 },
  k9:   { avg: 7.50, std: 1.50 },
  bb9:  { avg: 3.50, std: 1.00 },
  whip: { avg: 1.40, std: 0.18 },
  fip:  { avg: 4.30, std: 0.90 },
};

/* ─────────────────────────────────────────────
   유틸
   ───────────────────────────────────────────── */

/**
 * 야구 이닝 표기: .0 / .1 / .2 (1/3 아웃 단위)
 * 105.333 → "105.1", 105.666 → "105.2", 106.0 → "106.0"
 */
export function formatIP(ip) {
  const full = Math.floor(ip);
  const rem  = Math.round((ip - full) * 3); // 0, 1, 2
  return `${full}.${rem}`;
}

/* ─────────────────────────────────────────────
   1. 시즌 성적 생성 (능력치 → 통계)
   ───────────────────────────────────────────── */

/**
 * @param {Object} abilities   - { stuff, command, control, holding, stamina }
 * @param {string} position    - 'SP' | 'RP' | ...
 * @param {number} adaptFactor - 리그 적응도 (0~1)
 * @param {number} injuryFactor - 부상 퀄리티 패널티 (0~1)
 * @param {number} ipFactor    - 부상/성적 이닝 감소율 (0~1)
 * @returns {Object} { g, gs, ipPerStart, ip, era, k9, bb9, whip, fip }
 */
export function generateSeasonStats(abilities, position, adaptFactor, injuryFactor, ipFactor = 1.0) {
  const { stuff, command, control, stamina } = abilities;
  // 50 = 리그평균 기준 정규화: -1(20) ~ 0(50) ~ +1(80)
  const n = v => (v - 50) / 30;

  // ── IP 계산: 선발/불펜 분리 ──
  // SP: "경기당 이닝(ipPerStart)"과 "등판 수"를 별도 계산
  //   - ipPerStart = 체력(stamina)의 본질 → 부상/성적과 무관
  //   - 등판 수     = ipFactor(부상) × performanceFactor(성적) × adaptFactor 로 결정
  // RP: 총 이닝 방식
  let ip, gs, g, ipPerStart;

  if (position === 'SP') {
    // 경기당 이닝: stamina 50 → 6.0이닝, 65 → 6.75이닝, 80 → 7.5이닝
    const baseIPPS = 6.0 + n(stamina) * 1.5;
    ipPerStart = Math.max(3.0, baseIPPS + (Math.random() - 0.5) * 0.4);

    // 선발 등판 수: 28경기 기준 × 부상/성적/적응도
    const baseStarts = 28;
    gs = Math.max(1, Math.round(
      baseStarts * ipFactor * adaptFactor * (0.88 + Math.random() * 0.22)
    ));
    ip = ipPerStart * gs;
    g  = gs;
  } else {
    // 불펜: 총 이닝으로 계산
    const baseIP = 60 + n(stamina) * 20;
    ip = Math.max(5, baseIP * ipFactor * adaptFactor * (0.88 + Math.random() * 0.22));
    g  = Math.max(1, Math.round(ip / 1.2));
    gs = 0;
    ipPerStart = null;
  }

  // ERA: 리그평균 4.50 중심
  const eraBase = 4.50 - n(stuff) * 1.20 - n(command) * 1.00 - n(control) * 0.80;
  const era = Math.max(0.80, eraBase + (Math.random() - 0.5) * 1.60);

  // K/9: 리그평균 7.50 중심 (stuff 주도)
  const k9Base = 7.50 + n(stuff) * 4.50 + n(command) * 0.50;
  const k9 = Math.max(1.0, k9Base + (Math.random() - 0.5) * 2.50);

  // BB/9: 리그평균 3.50 중심 (command/control 주도)
  const bb9Base = 3.50 - n(command) * 1.50 - n(control) * 1.00;
  const bb9 = Math.max(0.3, bb9Base + (Math.random() - 0.5) * 1.50);

  // WHIP
  const whipBase = 1.40 + (era - 4.50) * 0.12 + (bb9 - 3.50) * 0.05;
  const whip = Math.max(0.55, whipBase + (Math.random() - 0.5) * 0.18);

  // FIP
  const fip = Math.max(0.80, era * (0.85 + Math.random() * 0.25));

  return {
    g, gs, ipPerStart,
    ip:   Math.round(ip * 3) / 3,
    era:  Math.round(era  * 100) / 100,
    k9:   Math.round(k9   * 100) / 100,
    bb9:  Math.round(bb9  * 100) / 100,
    whip: Math.round(whip * 100) / 100,
    fip:  Math.round(fip  * 100) / 100,
  };
}

/* ─────────────────────────────────────────────
   2. 시즌 통계 → 측정 능력치
   ───────────────────────────────────────────── */

/**
 * @param {Object} stats         - generateSeasonStats() 반환값
 * @param {string} position
 * @param {Object} prevAbilities - 이전 능력치 (관성용)
 * @returns {{ stuff, command, control }}
 */
export function evalFromStats(stats, position, prevAbilities) {
  const { era, k9, bb9, whip, fip, ip } = stats;

  const z = (val, key, invert = false) => {
    const raw = (val - KBO_LEAGUE_STATS[key].avg) / KBO_LEAGUE_STATS[key].std;
    return invert ? -raw : raw;
  };

  const zEra  = z(era,  'era',  true);
  const zK9   = z(k9,   'k9');
  const zBB9  = z(bb9,  'bb9',  true);
  const zWhip = z(whip, 'whip', true);
  const zFip  = z(fip,  'fip',  true);

  // 데이터 신뢰도: IP가 많을수록 측정 신뢰
  const ipRef = position === 'SP' ? 120 : 50;
  const trust = Math.min(ip / ipRef, 1.0);

  const toScore = (z, t) =>
    Math.max(20, Math.min(80, Math.round(50 + z * 10 * t)));

  const stuff   = toScore(zK9 * 0.6 + zFip * 0.4, trust);
  const command = toScore(zBB9 * 0.7 + zWhip * 0.3, trust);
  const control = toScore(zEra * 0.5 + zFip * 0.3 + zWhip * 0.2, trust);

  // 관성: 이전 능력치와 블렌딩 (급변 방지)
  const inertia = 0.30;
  return {
    stuff:   Math.round(prevAbilities.stuff   * inertia + stuff   * (1 - inertia)),
    command: Math.round(prevAbilities.command * inertia + command * (1 - inertia)),
    control: Math.round(prevAbilities.control * inertia + control * (1 - inertia)),
  };
}

/* ─────────────────────────────────────────────
   2-B. 은퇴 확률 계산
   ───────────────────────────────────────────── */

/**
 * 시즌 후 은퇴 여부를 결정한다.
 * - 나이 기반 기본 확률 + OVR/IP/연속부진/특성 보정
 * @param {number} age
 * @param {number} ovr
 * @param {Object} stats          - { ip, era, ... }
 * @param {string} position       - 'SP' | 'RP'
 * @param {Object} attributes     - { resilience, work_ethic, ... }
 * @param {number} poorSeasonStreak - 연속 부진 시즌 수
 * @returns {boolean} true이면 은퇴
 */
function rollRetirement(age, ovr, stats, position, attributes, poorSeasonStreak) {
  if (age < 31) return false;

  // 나이 기반 기본 확률 — 나이 단독으로는 크지 않고, OVR 하락과 맞물려야 의미 있음
  const AGE_PROB = [
    [31, 0.003], [32, 0.006], [33, 0.012],
    [34, 0.018], [35, 0.028], [36, 0.044], [37, 0.065],
    [38, 0.095], [39, 0.140], [40, 0.200], [41, 0.280],
    [42, 0.390], [43, 0.520], [44, 0.660],
  ];
  let prob = 0;
  for (const [a, p] of AGE_PROB) {
    if (age >= a) prob = p;
  }
  if (age >= 45) prob = 0.82;

  // OVR 보정: 핵심 드라이버 — 아직 쓸만하면 은퇴를 강하게 억제
  if      (ovr >= 65) prob -= 0.10;  // 여전히 에이스급 → 거의 안 은퇴
  else if (ovr >= 60) prob -= 0.07;  // 준수한 성적 → 억제
  else if (ovr >= 55) prob -= 0.02;  // 평균 수준 → 소폭 억제
  else if (ovr >= 50) prob += 0.03;  // 평균 이하
  else if (ovr >= 45) prob += 0.09;  // 하위권
  else                prob += 0.17;  // 심각한 부진

  // IP 보정: 성적이 괜찮아도 출전 기회 급감이면 신호
  // (OVR이 이미 반영하므로 가중치 완화)
  const ip = stats?.ip ?? 999;
  if (position === 'SP') {
    if      (ip < 30) prob += 0.12;
    else if (ip < 60) prob += 0.05;
  } else {
    if      (ip < 10) prob += 0.12;
    else if (ip < 25) prob += 0.05;
  }

  // 연속 부진: 추가 압박 (이미 OVR에서 잡히지만 꾸준한 부진은 별도 가중)
  if      (poorSeasonStreak >= 3) prob += 0.09;
  else if (poorSeasonStreak >= 2) prob += 0.04;

  // 정신적 특성 (resilience·work_ethic 높을수록 은퇴 미룸)
  const resilience = attributes?.resilience ?? 50;
  const workEthic  = attributes?.work_ethic  ?? 50;
  prob -= (resilience - 50) / 30 * 0.07;
  prob -= (workEthic  - 50) / 30 * 0.07;

  return Math.random() < Math.max(0, Math.min(0.95, prob));
}

/* ─────────────────────────────────────────────
   3. 커리어 시뮬레이션 루프
   ───────────────────────────────────────────── */

/**
 * trueAbility(커브 앵커) + measured 블렌딩 → 자연스러운 전성기 오르락내리락
 *
 * @param {Object} player    - PLAYERS 항목 { currentAge, currentYear, currentAbility, attributes, position, sourceLeague }
 * @param {number} potential - 1~10
 * @returns {Object} { seasons, growthProfile, ... }
 */
export function simulateCareer(player, potential) {
  const { currentAge, currentYear, currentAbility, attributes, position, sourceLeague, forcedGrowthType } = player;

  const [ceilMin, ceilMax] = POTENTIAL_CEILING[potential] ?? [52, 58];
  const targetPeak = ceilMin + Math.random() * (ceilMax - ceilMin);

  const growthProfile = generateGrowthProfile(currentAge, position, forcedGrowthType ?? null);

  const startOvr = currentAbility.stuff * 0.40 + currentAbility.command * 0.25 +
    currentAbility.control * 0.25 + currentAbility.holding * 0.05 + currentAbility.stamina * 0.05;
  growthProfile.ceilingMult = Math.max(0.80, targetPeak / startOvr);

  // ── work_ethic → 전성기 연장 & 하락 완화 ──
  const wNorm = ((attributes.work_ethic ?? 50) - 50) / 30;
  growthProfile.peakWindow = Math.max(0, Math.round(growthProfile.peakWindow + wNorm * 2));
  growthProfile.declineRate = Math.max(0.005, growthProfile.declineRate * (1 - wNorm * 0.25));

  // ── 베테랑 강제 하락기 고정 (34세 이상) ──
  if (currentAge >= 34) {
    growthProfile.peakWindow = 0;
    if (growthProfile.peakAge >= currentAge - 2) {
      growthProfile.peakAge = currentAge - 3;
    }
  }

  // 하락 시작 나이
  const declineStart = growthProfile.peakAge + (growthProfile.peakWindow ?? 0);

  // ── baseGF: 모든 프로파일 조정 완료 후 계산 ──
  // 반드시 work_ethic/베테랑 override 이후에 계산해야
  // gfNow(루프 내)와 동일한 growthProfile 기준으로 ratio=1.0 보장
  const baseGF = calcGrowthFactor(currentAge, growthProfile);

  // ── 하락 기준 OVR 결정 ──
  const alreadyInDecline = currentAge > declineStart;
  const peakOvrForDecline = alreadyInDecline
    ? startOvr * (growthProfile.ceilingMult / baseGF)
    : targetPeak;

  // ── 적응 프로파일 ──
  // KBO 경험자: 작은 threshold + 높은 floor → 평소엔 100%, 부상 시 잠깐 하락 후 빠른 회복
  const rawAdaptProfile = generateAdaptationProfile(sourceLeague);
  const adaptProfile = sourceLeague === 'KBO'
    ? { ...rawAdaptProfile, ipThreshold: 60, speed: 12, floor: 0.88, ceiling: 1.00 }
    : rawAdaptProfile;

  // KBO 경험자는 이미 완전 적응 상태로 시작
  let cumulativeIP = sourceLeague === 'KBO' ? adaptProfile.ipThreshold : 0;

  const isForeign = sourceLeague !== 'KBO' && sourceLeague !== 'KBO_ROOKIE';
  const avgIPPerSeason = position === 'SP' ? 150 : 65;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const round = Math.round;

  const seasons = [];
  const initialAbilities = { ...currentAbility };
  let abilities = { ...currentAbility };
  let lastInjury = null;
  let prevOvr = null;        // 직전 시즌 OVR (성적 기반 출전 기회 조정용)
  let poorSeasonStreak = 0;  // 연속 부진 시즌 카운터

  const MAX_SEASONS = 26;

  for (let s = 0; s < MAX_SEASONS; s++) {
    const year = currentYear + s;
    const age  = currentAge + s;
    const isDecline = age > declineStart;

    const gfNow = calcGrowthFactor(age, growthProfile);
    const ratio = baseGF > 0 ? gfNow / baseGF : 1.0;

    // 하락기 전용: 구위·체력은 성장 곡선보다 빠르게 감소
    // 성장기(ratio≥1)엔 동일, 하락기에만 (1-ratio) 폭을 증폭
    const declineBoost = (r, mult) =>
      (!isDecline || r >= 1.0) ? r : Math.max(0.30, 1.0 - (1.0 - r) * mult);

    // 나이 기반 물리 한계 (성장 프로파일 peak window와 무관)
    // peakRatio: 전성기 때 실제로 도달하는 ratio (ceilingMult / baseGF)
    // physPeak* = 전성기 절대 최고치(80 clamp 포함) → 나이별 비율로 감소
    // → 성장기엔 성장을 막지 않고, 고령에서만 고정 방지
    const peakRatio       = baseGF > 0 ? growthProfile.ceilingMult / baseGF : 1.0;
    const physPeakStuff   = clamp(round(initialAbilities.stuff   * peakRatio), 20, 80);
    const physPeakStamina = clamp(round(initialAbilities.stamina * peakRatio), 20, 80);
    const physCapFrac      = Math.max(0.50, 1.0 - Math.max(0, age - 34) * 0.032); // 구위: 34세부터 3.2%/년
    const physCapFracSt    = Math.max(0.40, 1.0 - Math.max(0, age - 32) * 0.042); // 체력: 32세부터 4.2%/년

    // ① trueCore: 성장 곡선 기준 이상적 능력치
    const trueCore = {
      stuff:   clamp(round(Math.min(
        initialAbilities.stuff * declineBoost(ratio, 1.65),  // 하락기 구위 감소 배율 ↑
        physPeakStuff * physCapFrac    // 나이 기반 한계 (전성기 피크값 기준)
      )), 20, 80),
      command: clamp(round(initialAbilities.command * ratio), 20, 80),
      control: clamp(round(initialAbilities.control * ratio), 20, 80),
    };

    // ② 포텐셜 천장
    // alreadyInDecline 선수: 현재 OVR이 실제 기준 → 첫 시즌 그대로, 이후 하락
    const currentTargetOvr = isDecline
      ? peakOvrForDecline * (gfNow / growthProfile.ceilingMult)
      : targetPeak;
    const coreOvr = trueCore.stuff * 0.40 + trueCore.command * 0.25 + trueCore.control * 0.25;
    const scaledOvr = coreOvr / 0.90;
    let cappedCore = { ...trueCore };
    if (scaledOvr > currentTargetOvr) {
      const capRatio = currentTargetOvr / scaledOvr;
      cappedCore = {
        stuff:   clamp(round(trueCore.stuff   * capRatio), 20, 80),
        command: clamp(round(trueCore.command * capRatio), 20, 80),
        control: clamp(round(trueCore.control * capRatio), 20, 80),
      };
    }

    // ③-0 성적 기반 출전 기회 조정
    // 직전 시즌 OVR이 낮을수록 감독이 기회를 줄임
    let performanceFactor = 1.0;
    if (prevOvr !== null) {
      if      (prevOvr >= 63) performanceFactor = 1.00;
      else if (prevOvr >= 56) performanceFactor = 0.85;
      else if (prevOvr >= 50) performanceFactor = 0.70;
      else                    performanceFactor = 0.55;
    }

    // ③ 부상 결정
    const injury = rollInjury(attributes, lastInjury);
    // injuryFactor: 능력치/퀄리티 저하 (ERA/K9/BB9 등)
    const injuryFactor = injury ? (1 - injury.abilityPenalty) : 1.0;
    // ipFactor: 실제 이닝 감소
    const ipFactor = injury ? (1 - injury.ipReductionRate) : 1.0;
    if (injury) {
      const ipLoss = injury.ipReductionRate * avgIPPerSeason * 0.7;
      cumulativeIP = Math.max(0, cumulativeIP - ipLoss);
    }

    // ④ 적응 계수
    const baseAdaptFactor = calcAdaptationFactor(cumulativeIP, adaptProfile);
    const adaptInjuryMult = injury ? (1 - injury.ipReductionRate * 0.40) : 1.0;
    const adaptFactor = baseAdaptFactor * adaptInjuryMult;

    // ⑤ 시즌 통계 생성
    const statsAbilities = { ...abilities, ...cappedCore };
    const stats = generateSeasonStats(
      statsAbilities, position, adaptFactor, injuryFactor,
      ipFactor * performanceFactor
    );
    cumulativeIP += stats.ip;

    // ⑥ 통계 → 측정 능력치 (30% 관성 내장)
    const measured = evalFromStats(stats, position, cappedCore);

    // ⑦ 표시 능력치: 커브 앵커(80%) + 측정(20%) 블렌딩
    const displayed = {
      stuff:   clamp(round(cappedCore.stuff   * 0.80 + measured.stuff   * 0.20), 20, 80),
      command: clamp(round(cappedCore.command * 0.80 + measured.command * 0.20), 20, 80),
      control: clamp(round(cappedCore.control * 0.80 + measured.control * 0.20), 20, 80),
    };

    // ⑧ 주자억제 / 체력
    const holdingNoise = round((Math.random() - 0.5) * 4);
    const newHolding = clamp(abilities.holding + holdingNoise, 20, 80);

    // 체력: 하락기에 구위보다 더 빠르게 감소 (×1.70) + 34세부터 물리 한계
    const trueStamina = clamp(round(Math.min(
      initialAbilities.stamina * declineBoost(ratio, 1.90),  // 하락기 체력 감소 배율 ↑
      physPeakStamina * physCapFracSt   // 나이 기반 한계 (전성기 피크값 기준)
    )), 20, 80);
    const injuryStaminaPenalty = injury ? injury.ipReductionRate * 0.5 : 0;
    const staminaTarget = clamp(round(trueStamina * (1 - injuryStaminaPenalty)), 20, 80);
    const newStamina = clamp(round(abilities.stamina * 0.55 + staminaTarget * 0.45), 20, 80);

    abilities = { ...displayed, holding: newHolding, stamina: newStamina };

    const ovr = round(
      abilities.stuff   * 0.40 + abilities.command * 0.25 +
      abilities.control * 0.25 + abilities.holding * 0.05 + abilities.stamina * 0.05
    );

    // 부진 시즌 판단 (OVR 낮거나 출전 기회 감소)
    const isPoorSeason =
      ovr < 52 ||
      (position === 'SP' && stats.ip < 80) ||
      (position !== 'SP' && stats.ip < 35);
    poorSeasonStreak = isPoorSeason ? poorSeasonStreak + 1 : 0;

    seasons.push({
      year, age, abilities: { ...abilities }, stats, ovr,
      growthFactor: gfNow, adaptFactor, injury,
      isGrowthPhase: !isDecline,
    });

    prevOvr = ovr;
    lastInjury = progressInjuryRecovery(injury, attributes);

    // ── 은퇴 체크 (2번째 시즌부터, 30세 이상) ──
    if (s >= 1 && rollRetirement(age, ovr, stats, position, attributes, poorSeasonStreak)) {
      seasons[seasons.length - 1].retired = true;
      break;
    }
  }

  const lastSeason = seasons[seasons.length - 1];
  return {
    seasons, growthProfile,
    isForeign, isAdaptNeeded: true,
    targetPeak: round(targetPeak), ceilMin, ceilMax,
    declineStart, alreadyInDecline,
    startOvr: round(startOvr),
    retiredAge: lastSeason?.retired ? lastSeason.age : null,
  };
}

/* ─────────────────────────────────────────────
   4. 100회 시뮬레이션 → OVR 분포
   ───────────────────────────────────────────── */

/**
 * @param {Object} player
 * @param {number} potential
 * @param {number} N - 시뮬레이션 횟수 (기본 100)
 * @returns {Array} distribution — 시즌별 { year, age, min, p10, p25, median, p75, p90, max, activePct }
 *   activePct: 해당 시즌에 아직 현역인 시뮬레이션 비율 (은퇴 구간 시각화용)
 */
export function runDistribution(player, potential, N = 100) {
  const runs = Array.from({ length: N }, () => simulateCareer(player, potential));
  const maxSeasons = Math.max(...runs.map(r => r.seasons.length));

  const result = [];
  for (let s = 0; s < maxSeasons; s++) {
    const activeRuns = runs.filter(r => r.seasons.length > s);
    const activePct = activeRuns.length / N;

    // 전체의 2% 미만만 남으면 의미 없는 꼬리 → 중단
    if (activePct < 0.02) break;

    const sorted = activeRuns.map(r => r.seasons[s].ovr).sort((a, b) => a - b);
    const n = sorted.length;
    const p = frac => sorted[Math.min(n - 1, Math.floor(n * frac))];

    // 나이/연도는 생존한 런 중 첫 번째 기준 (모두 동일 출발)
    const rep = activeRuns[0].seasons[s];
    result.push({
      year:   rep.year,
      age:    rep.age,
      min:    sorted[0],
      p10:    p(0.10),
      p25:    p(0.25),
      median: p(0.50),
      p75:    p(0.75),
      p90:    p(0.90),
      max:    sorted[n - 1],
      activePct,
    });
  }
  return result;
}
