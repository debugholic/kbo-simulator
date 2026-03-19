/**
 * 투수 5대 능력치 산출 (Stuff, Command, Control, Holding Runners, Stamina)
 *
 * 방식:
 * - 리그 테이블(league_*)의 연도별 데이터 → 가중 평균/stddev (7:4:2:1:1)
 * - Stamina는 KBO 고정 기준값 + 선발 보너스
 * - IP < 30 이닝 투수는 리그 평균 방향으로 회귀 보정
 * - 20-80 스케일 출력
 */

// 리그 연도별 stddev → 개인 수준 편차 근사치로 변환하는 배율
const LEAGUE_STDDEV_SCALE = 4;

// 연도별 가중치 (최신 순: 2025→2021)
const YEAR_WEIGHTS = [7, 4, 2, 1, 1];

/* ── 지표 정의 ── */

// Stuff: 순수 구위 — 타자가 맞출 수 없는 공
const STUFF_METRICS = [
  { key: 'whiff_pct',            source: 'quality', dir: 'higher', weight: 1.2 },
  { key: 'contact_pct',          source: 'quality', dir: 'lower',  weight: 1.2 },
  { key: 'zone_in_contact_pct',  source: 'quality', dir: 'lower',  weight: 1.0 },
  { key: 'zone_out_contact_pct', source: 'quality', dir: 'lower',  weight: 1.0 },
  { key: 'csw_pct',              source: 'quality', dir: 'higher', weight: 1.0 },
  { key: 'putaway_pct',          source: 'quality', dir: 'higher', weight: 1.0 },
  { key: 'zone_out_swing_pct',   source: 'quality', dir: 'higher', weight: 0.8 },
  { key: 'k_per9',               source: 'season',  dir: 'higher', weight: 0.8 },
];

// Command: 투구 위치 정밀도 — 원하는 곳에 꽂는 능력, 가운데로 안 밀림
const COMMAND_METRICS = [
  { key: 'zone_mid_pitch_pct',   source: 'quality', dir: 'lower',  weight: 1.5 },
  { key: 'zone_in_pitch_pct',    source: 'quality', dir: 'higher', weight: 1.2 },
  { key: 'first_pitch_s_pct',    source: 'quality', dir: 'higher', weight: 1.0 },
  { key: 'p_per_ip',             source: 'season',  dir: 'lower',  weight: 0.8 },
];

// Control: 볼넷 억제, 안정적 스트라이크 제어
const CONTROL_METRICS = [
  { key: 'bb_per9',              source: 'season',  dir: 'lower',  weight: 1.5 },
  { key: 'bb_pct',               source: 'season',  dir: 'lower',  weight: 1.0 },
  { key: 's_pct',                source: 'quality', dir: 'higher', weight: 1.0 },
  { key: 'whip',                 source: 'season',  dir: 'lower',  weight: 0.8 },
  { key: 'wp_per_ip',            source: 'derived', dir: 'lower',  weight: 0.6 },
];

const HOLDING_METRICS = [
  { key: 'sb_pct',               source: 'running', dir: 'lower',  weight: 1.0 },
  { key: 'sba_per_ip',           source: 'derived', dir: 'lower',  weight: 1.0 },
  { key: 'pick_out_per_ip',      source: 'derived', dir: 'higher', weight: 0.8 },
  { key: 'bk_per_ip',            source: 'derived', dir: 'lower',  weight: 0.6 },
];

// Stamina — 선발: 경기당 이닝 + 경기당 투구수 (rate 지표만)
const STAMINA_STARTER_METRICS = [
  { key: 'ip_per_gs', source: 'derived', dir: 'higher', weight: 2.0 },
  { key: 'np_per_gs', source: 'derived', dir: 'higher', weight: 1.5 },
];

// Stamina — 불펜: 경기당 이닝 + 경기당 투구수 (rate 지표만)
const STAMINA_RELIEVER_METRICS = [
  { key: 'ip_per_g',  source: 'derived', dir: 'higher', weight: 2.0 },
  { key: 'np_per_g',  source: 'derived', dir: 'higher', weight: 1.5 },
];

// KBO 기준 고정 벤치마크 (Stamina용) — rate 지표
const STAMINA_STARTER_BENCHMARKS = {
  ip_per_gs: { mean: 4.8, std: 0.55 },
  np_per_gs: { mean: 85, std: 10 },
};

const STAMINA_RELIEVER_BENCHMARKS = {
  ip_per_g:  { mean: 1.0, std: 0.4 },
  np_per_g:  { mean: 18, std: 5 },
};

// 선발 보너스: 선발 등판 횟수에 따라 Stamina 추가
function starterGsBonus(gs) {
  if (gs >= 30) return 5;
  if (gs >= 25) return 3;
  if (gs >= 20) return 2;
  if (gs >= 15) return 2;
  return 0;
}

export const EVAL_CATEGORIES = [
  { key: 'stuff',    label: 'Stuff',    labelKor: '구위',     metrics: STUFF_METRICS, zMultiplier: 8 },
  { key: 'command',  label: 'Command',  labelKor: '제구',     metrics: COMMAND_METRICS, zMultiplier: 14 },
  { key: 'control',  label: 'Control',  labelKor: '컨트롤',   metrics: CONTROL_METRICS },
  { key: 'holding',  label: 'Holding',  labelKor: '주자억제', metrics: HOLDING_METRICS },
  { key: 'stamina',  label: 'Stamina',  labelKor: '체력',     metrics: null },
];

/* ── 유틸 함수 ── */

function parseIP(ip) {
  if (ip == null) return 0;
  const n = Number(ip);
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 10);
  return whole + frac / 3;
}

export function isStarter(seasonStats) {
  const gs = Number(seasonStats?.gs ?? 0);
  const gr = Number(seasonStats?.gr ?? 0);
  return gs > 0 && gs >= gr;
}

function getStaminaMetrics(seasonStats) {
  return isStarter(seasonStats) ? STAMINA_STARTER_METRICS : STAMINA_RELIEVER_METRICS;
}

function getStaminaBenchmarks(seasonStats) {
  return isStarter(seasonStats) ? STAMINA_STARTER_BENCHMARKS : STAMINA_RELIEVER_BENCHMARKS;
}

/** 선수의 raw 지표값 추출 */
function getPlayerValue(metric, seasonStats, qualityStats, runningStats) {
  const { key, source } = metric;

  if (source === 'season') {
    const val = seasonStats?.[key];
    return val != null ? Number(val) : null;
  }
  if (source === 'quality') {
    const val = qualityStats?.[key];
    return val != null ? Number(val) : null;
  }
  if (source === 'running') {
    const val = runningStats?.[key];
    return val != null ? Number(val) : null;
  }
  if (source === 'derived') {
    const ip = parseIP(seasonStats?.ip);
    if (ip <= 0) return null;

    if (key === 'wp_per_ip') {
      return (Number(seasonStats?.wp ?? 0) / ip) * 9;
    }
    if (key === 'sba_per_ip') {
      return (Number(runningStats?.sba ?? 0) / ip) * 9;
    }
    if (key === 'pick_out_per_ip') {
      return (Number(runningStats?.pick_out_all ?? 0) / ip) * 9;
    }
    if (key === 'bk_per_ip') {
      return (Number(runningStats?.bk ?? seasonStats?.bk ?? 0) / ip) * 9;
    }
    if (key === 'ip_per_gs') {
      const gs = Number(seasonStats?.gs ?? 0);
      if (gs <= 0) return null;
      return ip / gs;
    }
    if (key === 'ip_per_g') {
      const g = Number(seasonStats?.g ?? 0);
      if (g <= 0) return null;
      return ip / g;
    }
    if (key === 'np_per_gs') {
      const gs = Number(seasonStats?.gs ?? 0);
      const np = Number(seasonStats?.np ?? 0);
      if (gs <= 0 || np <= 0) return null;
      return np / gs;
    }
    if (key === 'np_per_g') {
      const g = Number(seasonStats?.g ?? 0);
      const np = Number(seasonStats?.np ?? 0);
      if (g <= 0 || np <= 0) return null;
      return np / g;
    }
  }
  return null;
}

/** 리그 테이블 단일 행에서 평균값 추출 */
function getLeagueMean(metric, leagueSeason, leagueQuality, leagueRunning) {
  const { key, source } = metric;

  if (source === 'season') {
    const val = leagueSeason?.[key];
    return val != null ? Number(val) : null;
  }
  if (source === 'quality') {
    const val = leagueQuality?.[key];
    return val != null ? Number(val) : null;
  }
  if (source === 'running') {
    const val = leagueRunning?.[key];
    return val != null ? Number(val) : null;
  }
  if (source === 'derived') {
    const ip = parseIP(leagueSeason?.ip);
    if (ip <= 0) return null;

    if (key === 'wp_per_ip') {
      return (Number(leagueRunning?.wp ?? leagueSeason?.wp ?? 0) / ip) * 9;
    }
    if (key === 'sba_per_ip') {
      return (Number(leagueRunning?.sba ?? 0) / ip) * 9;
    }
    if (key === 'pick_out_per_ip') {
      return (Number(leagueRunning?.pick_out_all ?? 0) / ip) * 9;
    }
    if (key === 'bk_per_ip') {
      return (Number(leagueRunning?.bk ?? leagueSeason?.bk ?? 0) / ip) * 9;
    }
    if (key === 'ip_per_gs') {
      const gs = Number(leagueSeason?.gs ?? 0);
      if (gs <= 0) return null;
      return ip / gs;
    }
    if (key === 'ip_per_g') {
      const g = Number(leagueSeason?.g ?? 0);
      if (g <= 0) return null;
      return ip / g;
    }
    if (key === 'np_per_gs') {
      const gs = Number(leagueSeason?.gs ?? 0);
      const np = Number(leagueSeason?.np ?? 0);
      if (gs <= 0 || np <= 0) return null;
      return np / gs;
    }
    if (key === 'np_per_g') {
      const g = Number(leagueSeason?.g ?? 0);
      const np = Number(leagueSeason?.np ?? 0);
      if (g <= 0 || np <= 0) return null;
      return np / g;
    }
  }
  return null;
}

/* ── 리그 테이블 기반 가중 stddev 계산 ── */

/**
 * 가중 평균/stddev 계산
 * @param {number[]} values - 연도별 값 (최신 순)
 * @param {number[]} weights - 연도별 가중치 (최신 순, e.g. [7,4,2,1,1])
 */
function calcWeightedStdDev(values, weights) {
  if (values.length < 2) return null;
  const n = Math.min(values.length, weights.length);
  let wSum = 0, wMean = 0;

  for (let i = 0; i < n; i++) {
    wSum += weights[i];
    wMean += weights[i] * values[i];
  }
  wMean /= wSum;

  let wVar = 0;
  for (let i = 0; i < n; i++) {
    wVar += weights[i] * (values[i] - wMean) ** 2;
  }
  wVar /= wSum;

  return { mean: wMean, std: Math.sqrt(wVar) || 0.01 };
}

/**
 * 리그 테이블의 연도별 데이터로 가중 stddev 계산
 * 최근 시즌 가중치: 7:4:2:1:1
 * × LEAGUE_STDDEV_SCALE 로 개인 수준 편차 근사
 */
export function calcLeagueStdDevsFromTables(leagueSeasonRows, leagueQualityRows, leagueRunningRows) {
  const allMetrics = [
    ...STUFF_METRICS,
    ...COMMAND_METRICS,
    ...CONTROL_METRICS,
    ...HOLDING_METRICS,
  ];

  const common = {};
  const seen = new Set();

  for (const metric of allMetrics) {
    if (seen.has(metric.key)) continue;
    seen.add(metric.key);

    const values = [];
    for (let i = 0; i < leagueSeasonRows.length; i++) {
      const val = getLeagueMean(
        metric,
        leagueSeasonRows[i] || null,
        leagueQualityRows[i] || null,
        leagueRunningRows[i] || null,
      );
      if (val != null) values.push(val);
    }

    const stats = calcWeightedStdDev(values, YEAR_WEIGHTS);
    if (stats) {
      common[metric.key] = {
        mean: stats.mean,
        std: stats.std * LEAGUE_STDDEV_SCALE,
      };
    }
  }

  return { common };
}

/* ── 메인 산출 함수 ── */

/**
 * 카테고리 점수 계산 (Stuff, Command, Control, Holding)
 * z-score 기반, 20-80 스케일
 */
function calcCategoryScore(metrics, statsMap, playerData, leagueAvgs, regressionFactor, zMultiplier = 10) {
  const { seasonStats, qualityStats, runningStats } = playerData;
  let totalWeight = 0;
  let weightedZSum = 0;

  for (const metric of metrics) {
    const raw = getPlayerValue(metric, seasonStats, qualityStats, runningStats);
    const leagueMean = getLeagueMean(
      metric, leagueAvgs.season, leagueAvgs.quality, leagueAvgs.running
    );
    const stats = statsMap[metric.key];

    if (raw == null || leagueMean == null || !stats) continue;

    // IP 기반 회귀 보정
    const adjusted = leagueMean + (raw - leagueMean) * regressionFactor;
    let z = (adjusted - leagueMean) / stats.std;
    if (metric.dir === 'lower') z = -z;
    z = Math.max(-3.5, Math.min(3.5, z)); // 이상치 왜곡 방지

    weightedZSum += z * metric.weight;
    totalWeight += metric.weight;
  }

  if (totalWeight <= 0) return null;
  const avgZ = weightedZSum / totalWeight;
  return Math.max(20, Math.min(80, Math.round(50 + avgZ * zMultiplier)));
}

/**
 * Stamina 점수 계산 (고정 벤치마크 기반 rate 지표 + 선발 보너스)
 */
function calcStaminaScore(metrics, benchmarks, playerData, regressionFactor) {
  const { seasonStats, qualityStats, runningStats } = playerData;
  let totalWeight = 0;
  let weightedZSum = 0;

  for (const metric of metrics) {
    const raw = getPlayerValue(metric, seasonStats, qualityStats, runningStats);
    const bench = benchmarks[metric.key];
    if (raw == null || !bench) continue;

    const adjusted = bench.mean + (raw - bench.mean) * regressionFactor;
    let z = (adjusted - bench.mean) / bench.std;
    if (metric.dir === 'lower') z = -z;
    z = Math.max(-3.5, Math.min(3.5, z));

    weightedZSum += z * metric.weight;
    totalWeight += metric.weight;
  }

  if (totalWeight <= 0) return null;
  const avgZ = weightedZSum / totalWeight;
  let score = Math.round(50 + avgZ * 10);

  // 선발 보너스: 선발 등판 횟수에 따라 추가 보너스
  const gs = Number(seasonStats?.gs ?? 0);
  if (isStarter(seasonStats)) {
    score += starterGsBonus(gs);
  }

  return Math.max(20, Math.min(80, score));
}

/**
 * 단일 투수의 5대 능력치 산출
 */
export function evaluatePitcher(playerData, leagueAvgs, stdDevs) {
  const { seasonStats } = playerData;
  const ip = parseIP(seasonStats?.ip);
  const regressionFactor = Math.min(ip / 30, 1);
  const starter = isStarter(seasonStats);

  const result = { isStarterRole: starter };

  // Stuff, Command, Control, Holding (리그 테이블 기반 가중 stddev)
  for (const category of EVAL_CATEGORIES) {
    if (category.metrics == null) continue;
    result[category.key] = calcCategoryScore(
      category.metrics, stdDevs.common, playerData, leagueAvgs, regressionFactor,
      category.zMultiplier
    );
  }

  // Stamina (고정 벤치마크 rate 지표 + 선발 보너스)
  // 등판 수 기반 회귀: 선발은 GS/30, 불펜은 G/40
  const staminaMetrics = getStaminaMetrics(seasonStats);
  const staminaBenchmarks = getStaminaBenchmarks(seasonStats);
  const gs = Number(seasonStats?.gs ?? 0);
  const g = Number(seasonStats?.g ?? 0);
  const staminaRegression = starter ? Math.min(gs / 30, 1) : Math.min(g / 40, 1);
  result.stamina = calcStaminaScore(
    staminaMetrics, staminaBenchmarks, playerData, staminaRegression
  );

  return result;
}
