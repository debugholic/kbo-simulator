/**
 * 투수 5대 능력치 산출 (Stuff, Command, Control, Holding Runners, Stamina)
 *
 * 방식:
 * - 리그 테이블(league_*)의 연도별 데이터 → 가중 평균/stddev (7:4:2:1:1)
 * - Stamina는 KBO 고정 기준값 + 선발 보너스
 * - IP < 30 이닝 투수는 리그 평균 방향으로 회귀 보정
 * - 외국 리그(MLB/AAA/NPB) 스탯은 리그 수준 차이 보정 (z-score 오프셋)
 * - 20-80 스케일 출력
 */

import {
  ADAPTATION_TYPES, pickWeighted, clamp,
  generateHints,
} from './foreignPlayerGen';
import {
  LEAGUE_Z_OFFSETS, LEAGUE_SCORE_FLOOR, SUPPORTED_LEAGUES,
  LEAGUE_BASE, STAT_ANCHOR_WEIGHT, ELITE_S_PROB,
} from './leagueConstants';

// 리그 연도별 stddev → 개인 수준 편차 근사치로 변환하는 배율
const LEAGUE_STDDEV_SCALE = 4;

// LEAGUE_Z_OFFSETS, LEAGUE_SCORE_FLOOR, SUPPORTED_LEAGUES, LEAGUE_BASE, STAT_ANCHOR_WEIGHT
// → leagueConstants.js 에서 import
export { LEAGUE_Z_OFFSETS, SUPPORTED_LEAGUES };

// 연도별 가중치 (최신 순: 2025→2021)
const YEAR_WEIGHTS = [12, 5, 3, 2, 1];

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
  { key: 'zone_in_pitch_pct',    source: 'quality', dir: 'higher', weight: 0.5 },  // 1.2→0.5: 파워 불펜은 존 밖 승부가 전략 — 과도한 패널티 완화
  { key: 'zone_out_swing_pct',   source: 'quality', dir: 'higher', weight: 0.8 },  // 존 밖 헛스윙 유도 — 진짜 로케이션 커맨드
  { key: 'looking_pct',          source: 'quality', dir: 'higher', weight: 1.2 },  // called strike% → 엣지 로케이션
  { key: 'first_pitch_s_pct',    source: 'quality', dir: 'higher', weight: 1.0 },
  { key: 'k_bb',                 source: 'season',  dir: 'higher', weight: 1.0 },  // K/BB: K를 잡으며 BB를 안 주는 정밀 압도
  { key: 'p_per_ip',             source: 'season',  dir: 'lower',  weight: 0.8 },  // 이닝당 투구수: 낮을수록 스트라이크 효율 높음
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
  { key: 'sb_pct',               source: 'running', dir: 'lower',  weight: 1.5 },  // 도루 성공률 (1.0→1.5)
  { key: 'sba_per_ip',           source: 'derived', dir: 'lower',  weight: 1.2 },  // 도루 시도 억제 (1.0→1.2)
  { key: 'bk_per_ip',            source: 'derived', dir: 'lower',  weight: 0.8 },  // 보크 (0.6→0.8)
  { key: 'pick_out_per_ip',      source: 'derived', dir: 'higher', weight: 0.4 },  // 견제 아웃 (0.8→0.4)
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
  ip_per_g:  { mean: 1.15, std: 0.4 },
  np_per_g:  { mean: 20, std: 5 },
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
  { key: 'stuff',    label: 'Stuff',    labelKor: '구위',     metrics: STUFF_METRICS, zMultiplier: 9 },
  { key: 'command',  label: 'Command',  labelKor: '커맨드',   metrics: COMMAND_METRICS, zMultiplier: 14 },
  { key: 'control',  label: 'Control',  labelKor: '컨트롤',   metrics: CONTROL_METRICS, zMultiplier: 9 },
  { key: 'holding',  label: 'Holding',  labelKor: '주자억제', metrics: HOLDING_METRICS, zMultiplier: 6 },
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
      if (!runningStats) return null;
      return (Number(runningStats.sba ?? 0) / ip) * 9;
    }
    if (key === 'pick_out_per_ip') {
      if (!runningStats) return null;
      return (Number(runningStats.pick_out_all ?? 0) / ip) * 9;
    }
    if (key === 'bk_per_ip') {
      if (!runningStats) return null;
      return (Number(runningStats.bk ?? seasonStats?.bk ?? 0) / ip) * 9;
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

/* ── 오프셋 블렌딩 ── */

/**
 * 카테고리 내 season/quality 지표 비중에 따라 오프셋 블렌딩
 * season 소스와 quality 소스의 리그가 다를 때 (예: AAA 시즌 + MLB quality)
 */
function blendOffset(metrics, seasonOffset, qualityOffset) {
  if (seasonOffset === qualityOffset) return seasonOffset;
  let seasonW = 0, qualityW = 0;
  for (const m of metrics) {
    if (m.source === 'season' || m.source === 'derived') seasonW += m.weight;
    else if (m.source === 'quality') qualityW += m.weight;
  }
  const total = seasonW + qualityW;
  if (total <= 0) return seasonOffset;
  return (seasonOffset * seasonW + qualityOffset * qualityW) / total;
}

/* ── 메인 산출 함수 ── */

// 소표본 보정 기준 (이닝) — 이 이닝을 채워야 실제 스탯 100% 반영
const REGRESSION_IP = 50;
// 회귀 목표 점수 (20-80 스케일) — 소표본 선수는 이 점수로 수렴
// 40 = 리그 평균(50) 기준 -1σ 방향
const REGRESSION_Z = 1;

/**
 * 다년도 가중 z-score 블렌딩 (시즌별 리그 보정)
 * 각 시즌 스탯을 해당 연도 리그 평균 대비 z-score로 먼저 변환한 뒤,
 * IP × 연도가중치로 블렌딩
 */
function calcBlendedCategoryScore(
  metrics, statsMap, playerYearData, leagueAvgsByYear, maxYear,
  zMultiplier = 10, leagueZOffset = 0
) {
  let totalWeight = 0;
  let weightedZSum = 0;

  for (const { year, seasonStats, qualityStats, runningStats } of playerYearData) {
    const yearIdx = maxYear - year;
    if (yearIdx >= YEAR_WEIGHTS.length) break;

    const ip = parseIP(seasonStats?.ip);
    if (ip <= 0) continue;

    const yearW = YEAR_WEIGHTS[yearIdx];
    const ipWeight = ip * yearW;
    const regressionFactor = Math.min(ip / REGRESSION_IP, 1);

    // 해당 연도 리그 평균 (없으면 최신 연도 사용)
    const yearLeague = leagueAvgsByYear[year] || leagueAvgsByYear[maxYear];
    if (!yearLeague) continue;

    let zSum = 0;
    let metricW = 0;

    for (const metric of metrics) {
      const raw = getPlayerValue(metric, seasonStats, qualityStats, runningStats);
      const leagueMean = getLeagueMean(
        metric, yearLeague.season, yearLeague.quality, yearLeague.running
      );
      const stats = statsMap[metric.key];

      if (raw == null || leagueMean == null || !stats) continue;

      // 소표본 회귀: 목표점을 리그 평균(→50)이 아닌 나쁜 방향(→30)으로 설정
      // dir='higher': 리그 평균 -2σ (낮을수록 나쁨), dir='lower': +2σ (높을수록 나쁨)
      const regressionTarget = leagueMean + (metric.dir === 'lower' ? 1 : -1) * REGRESSION_Z * stats.std;
      const adjusted = regressionTarget + (raw - regressionTarget) * regressionFactor;
      let z = (adjusted - leagueMean) / stats.std;
      if (metric.dir === 'lower') z = -z;
      z = Math.max(-3.7, Math.min(3.7, z));

      zSum += z * metric.weight;
      metricW += metric.weight;
    }

    if (metricW > 0) {
      weightedZSum += (zSum / metricW) * ipWeight;
      totalWeight += ipWeight;
    }
  }

  if (totalWeight <= 0) return null;
  const avgZ = weightedZSum / totalWeight + leagueZOffset;
  return Math.max(20, Math.min(80, Math.round(50 + avgZ * zMultiplier)));
}

/**
 * 다년도 Stamina 점수 (고정 벤치마크 기반, 시즌별 선발/불펜 자동 구분)
 */
function calcBlendedStaminaScore(playerYearData, maxYear, leagueZOffset = 0) {
  const latestStarter = isStarter(playerYearData[0]?.seasonStats);
  const zMul = latestStarter ? 9 : 11;
  let totalWeight = 0;
  let weightedZSum = 0;
  let gsBonus = 0;
  let bonusW = 0;

  for (const { year, seasonStats } of playerYearData) {
    const yearIdx = maxYear - year;
    if (yearIdx >= YEAR_WEIGHTS.length) break;

    const ip = parseIP(seasonStats?.ip);
    if (ip <= 0) continue;

    const yearW = YEAR_WEIGHTS[yearIdx];
    const ipWeight = ip * yearW;
    const starter = isStarter(seasonStats);
    const metrics = starter ? STAMINA_STARTER_METRICS : STAMINA_RELIEVER_METRICS;
    const benchmarks = starter ? STAMINA_STARTER_BENCHMARKS : STAMINA_RELIEVER_BENCHMARKS;
    const gs = Number(seasonStats?.gs ?? 0);
    const g = Number(seasonStats?.g ?? 0);
    const regressionFactor = starter ? Math.min(gs / 30, 1) : Math.min(g / 40, 1);

    let zSum = 0;
    let metricW = 0;

    for (const metric of metrics) {
      const raw = getPlayerValue(metric, seasonStats, null, null);
      const bench = benchmarks[metric.key];
      if (raw == null || !bench) continue;

      const adjusted = bench.mean + (raw - bench.mean) * regressionFactor;
      let z = (adjusted - bench.mean) / bench.std;
      if (metric.dir === 'lower') z = -z;
      z = Math.max(-3.7, Math.min(3.7, z));

      zSum += z * metric.weight;
      metricW += metric.weight;
    }

    if (metricW > 0) {
      weightedZSum += (zSum / metricW) * ipWeight;
      totalWeight += ipWeight;
    }

    if (starter) {
      gsBonus += starterGsBonus(gs) * yearW;
      bonusW += yearW;
    }
  }

  if (totalWeight <= 0) return null;
  const avgZ = weightedZSum / totalWeight + leagueZOffset;
  let score = Math.round(50 + avgZ * zMul);
  if (bonusW > 0) score += Math.round(gsBonus / bonusW);
  return Math.max(20, Math.min(80, score));
}

/**
 * 단일 투수의 5대 능력치 산출
 * @param {Object} leagueAvgsByYear - { [year]: { season, quality, running } } 연도별 리그 평균
 */
export function evaluatePitcher(playerData, leagueAvgs, stdDevs, sourceLeague = 'KBO', leagueAvgsByYear = null) {
  const { allSeasonStats, allQualityStats, allRunningStats } = playerData;

  // 시즌별 데이터 매핑
  const qualityByYear = {};
  (allQualityStats || []).forEach(q => { qualityByYear[q.year] = q; });
  const runningByYear = {};
  (allRunningStats || []).forEach(r => { runningByYear[r.year] = r; });

  const seasonList = allSeasonStats && allSeasonStats.length > 0
    ? allSeasonStats : [playerData.seasonStats].filter(Boolean);
  const playerYearData = seasonList
    .sort((a, b) => b.year - a.year)
    .map(s => ({
      year: s.year,
      seasonStats: s,
      qualityStats: qualityByYear[s.year] || null,
      runningStats: runningByYear[s.year] || null,
    }));

  if (playerYearData.length === 0) return {};

  const maxYear = playerYearData[0].year;
  const latestSeason = playerYearData[0].seasonStats;
  const starter = isStarter(latestSeason);

  // leagueAvgsByYear 미제공 시 leagueAvgs를 maxYear에 매핑
  const avgsByYear = leagueAvgsByYear || { [maxYear]: leagueAvgs };

  // 리그 오프셋
  const seasonOffsets = LEAGUE_Z_OFFSETS[sourceLeague] || LEAGUE_Z_OFFSETS.KBO;
  const qualityLeague = playerData.qualityStats?.source_league || sourceLeague;
  const qualityOffsets = LEAGUE_Z_OFFSETS[qualityLeague] || LEAGUE_Z_OFFSETS.KBO;
  const floor = LEAGUE_SCORE_FLOOR[sourceLeague] ?? 20;
  const result = { isStarterRole: starter, sourceLeague };

  // Stuff, Command, Control, Holding — 시즌별 리그 보정 + IP×연도가중 블렌딩
  for (const category of EVAL_CATEGORIES) {
    if (category.metrics == null) continue;
    const offset = blendOffset(category.metrics, seasonOffsets[category.key] || 0, qualityOffsets[category.key] || 0);
    const raw = calcBlendedCategoryScore(
      category.metrics, stdDevs.common, playerYearData, avgsByYear, maxYear,
      category.zMultiplier, offset
    );
    result[category.key] = raw != null ? Math.max(floor, raw) : null;
  }

  // Stuff 보정: quality stats가 전혀 없는 투수는 구속 보강
  const hasAnyQuality = playerYearData.some(d => d.qualityStats != null);
  if (result.stuff != null && !hasAnyQuality) {
    const pitchStats = playerData.pitchStats;
    if (pitchStats) {
      const fbVelo = Math.max(
        pitchStats.velo_4seam ? Number(pitchStats.velo_4seam) : 0,
        pitchStats.velo_2seam ? Number(pitchStats.velo_2seam) : 0,
        pitchStats.velo_sinker ? Number(pitchStats.velo_sinker) : 0,
      );
      if (fbVelo > 0) {
        const veloZ = (fbVelo - 145) / 3.5;
        const veloScore = 50 + veloZ * 10;
        result.stuff = Math.max(floor, Math.min(80, Math.round(result.stuff * 0.5 + veloScore * 0.5)));
      }
    }
  }

  // Command 폴백: quality stats 없을 때 시즌 스탯 기반 간접 추정
  if (result.command == null && latestSeason) {
    const fip = latestSeason.fip != null ? Number(latestSeason.fip) : NaN;
    const whip = latestSeason.whip != null ? Number(latestSeason.whip) : NaN;
    const kbb = latestSeason.k_bb != null ? Number(latestSeason.k_bb) : NaN;
    const ppip = latestSeason.p_per_ip != null ? Number(latestSeason.p_per_ip) : NaN;
    if (!isNaN(fip) && !isNaN(whip)) {
      let z = 0, n = 0;
      z += -(fip - 4.2) / 0.7; n++;
      z += -(whip - 1.35) / 0.15; n++;
      if (!isNaN(kbb)) { z += (kbb - 2.5) / 0.8; n++; }
      // P/IP: KBO 전용 (외국 리그는 투구 페이스가 달라 왜곡됨) — quality stats 없을 때만 사용
      if (!isNaN(ppip) && sourceLeague === 'KBO') { z += -(ppip - 17.2) / 0.8; n++; }
      const avgZ = z / n + (seasonOffsets.command || 0);
      result.command = Math.max(floor, Math.min(80, Math.round(50 + avgZ * 10)));
    }
  }

  // 주자억제: running stats가 전혀 없으면 리그 평균(50)으로 fallback
  if (result.holding == null) {
    const hasRunningData = playerYearData.some(d => d.runningStats != null);
    result.holding = hasRunningData ? null : 50;
  }

  // Stamina — 시즌별 고정 벤치마크 + 선발 보너스 (IP×연도가중 블렌딩)
  const rawStamina = calcBlendedStaminaScore(playerYearData, maxYear, seasonOffsets.stamina || 0);
  result.stamina = rawStamina != null ? Math.max(floor, rawStamina) : null;

  return result;
}

/* ── 신인 투수 평가 (스카우팅 기반) ── */

// 구속(km/h) → stuff 추정
function veloToStuff(maxVelo, avgVelo) {
  // KBO 평균 구속 ~145km, std ~3.5
  const veloZ = ((avgVelo || maxVelo * 0.96) - 145) / 3.5;
  // 최고 구속 보너스 (155+ = 엘리트)
  const maxBonus = maxVelo >= 155 ? (maxVelo - 155) * 0.5 : 0;
  return Math.max(20, Math.min(80, Math.round(50 + veloZ * 10 + maxBonus)));
}

/**
 * 스카우팅 보고서 기반 신인 투수 평가
 * @param {Object} scouting - 스카우팅 데이터
 *   { maxVelo, avgVelo, pitchGrades: { slider, curve, changeup, ... },
 *     commandGrade, controlGrade, draftRound, draftPick, age, education }
 *
 * education별 특성:
 *   고졸      - SCALE 0.30, BASE +0 → 잠재력 중심, 즉전성 낮음
 *   독립리그   - SCALE 0.37, BASE +1 → 실전 경험 있으나 수준 낮음
 *   대졸      - SCALE 0.45, BASE +2 → 즉전감, 스카우팅 신뢰도 높음
 */
export function evaluateRookie(scouting) {
  const {
    maxVelo = 140, avgVelo, pitchGrades = {},
    commandGrade = 50, controlGrade = 50,
    draftRound = 10, age = 18,
    source_league = 'HIGH_SCHOOL',
  } = scouting;

  // source_league별 스케일/베이스 보정
  // scale: 스카우팅 등급 신뢰도 / baseBonus: 실전 경험 반영 기저 보정
  const EDU_CONFIG = {
    HIGH_SCHOOL: { scale: 0.30, baseBonus: 0 },  // 미검증, 잠재력 중심
    INDIE:       { scale: 0.37, baseBonus: 1 },  // 실전 경험 있으나 수준 낮음
    COLLEGE:     { scale: 0.45, baseBonus: 2 },  // 즉전감, 스카우팅 신뢰도 높음
    KBO_FARM:    { scale: 0.52, baseBonus: 4 },  // 퓨처스 경험, 프로 적응 완료
  };
  const { scale: ROOKIE_SCALE, baseBonus } = EDU_CONFIG[source_league] ?? EDU_CONFIG.HIGH_SCHOOL;

  // 스카우팅 등급(잠재력)을 KBO 실전 기준으로 할인
  // 목표 OVR: 1R 36-40, 2-3R 32-36, 4-5R 30-33, 6-10R 27-30
  const ROOKIE_BASE = (draftRound === 1 ? 36
    : draftRound <= 3 ? 32
    : draftRound <= 5 ? 29
    : 26) + baseBonus;

  const toKBO = (raw) => Math.max(20, Math.min(80, Math.round(ROOKIE_BASE + (raw - 50) * ROOKIE_SCALE)));

  // Stuff: 구속 + 변화구 등급 가중 평균 (raw 스케일)
  const stuffFromVelo = veloToStuff(maxVelo, avgVelo);
  const breakingGrades = Object.values(pitchGrades).filter(v => v != null);
  const avgBreaking = breakingGrades.length > 0
    ? breakingGrades.reduce((a, b) => a + b, 0) / breakingGrades.length
    : 50;
  const stuffRaw = Math.round(stuffFromVelo * 0.6 + avgBreaking * 0.4);
  const stuff = toKBO(stuffRaw);

  // Command & Control: 스카우팅 등급 → KBO 할인
  const command = toKBO(commandGrade);
  const control = toKBO(controlGrade);

  // Holding: 신인은 데이터 없음 → base 그대로
  const holding = ROOKIE_BASE;

  // Stamina: 나이/드래프트/학력 기반
  // 대졸·독립리그는 체력 기반이 더 성숙
  const ageBonus = source_league === 'COLLEGE' ? 3 : source_league === 'INDIE' ? 2 : age >= 22 ? 2 : 0;
  const draftBonus = draftRound === 1 ? 1 : 0;
  const stamina = Math.min(80, ROOKIE_BASE - 3 + ageBonus + draftBonus);

  return {
    isStarterRole: true,
    sourceLeague: 'ROOKIE',
    stuff: Math.max(20, Math.min(80, stuff)),
    command: Math.max(20, Math.min(80, command)),
    control: Math.max(20, Math.min(80, control)),
    holding,
    stamina,
  };
}

/* ── 외국인 용병 평가 (KBO 기록 없는 외국인 = 가상 선수) ── */

// STAT_ANCHOR_WEIGHT → leagueConstants.js 에서 import

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

/**
 * KBO 기록 없는 외국인 투수 — 능력치 생성 (가상 선수)
 *
 * foreignPlayerGen과 동일한 방식으로 5대 능력치를 랜덤 생성하되,
 * evaluatePitcher의 외국 스탯 추정치를 앵커(참고)로 활용.
 * 구종 데이터는 실제 외국 리그 기록을 그대로 사용.
 *
 * @param {Object} baseEval - evaluatePitcher()의 결과 (외국 스탯 참고용)
 * @param {string} sourceLeague - 'MLB' | 'AAA' | 'NPB' | 'NPB_FARM'
 * @returns pitcherEval 호환 객체 + scouting 메타데이터
 */
export function evaluateForeignSignee(baseEval, sourceLeague) {
  if (!baseEval || baseEval.stuff == null) return null;

  const anchorW = STAT_ANCHOR_WEIGHT;
  const leagueRange = LEAGUE_BASE[sourceLeague] || LEAGUE_BASE.AAA;
  const starter = baseEval.isStarterRole;
  const role = starter ? 'SP' : 'RP';

  // 외국 스탯 기반 추정치 (참고용)
  const estimate = {};
  for (const key of ['stuff', 'command', 'control', 'holding', 'stamina']) {
    estimate[key] = baseEval[key];
  }

  // ── 엘리트 보너스: DB 스탯 수준에 따라 확률 가중 ──
  // 앵커 가중치가 높아진 만큼, 보너스도 실제 스탯이 좋을수록 더 잘 걸리게
  const avgEstimate = (estimate.stuff + estimate.command + estimate.control) / 3;
  const sProb  = ELITE_S_PROB[sourceLeague] ?? 0.015;
  // 평균 추정치 65+ 이면 S급 확률 1.5배, 60+ 이면 1.2배
  const sMult  = avgEstimate >= 65 ? 1.5 : avgEstimate >= 60 ? 1.2 : 1.0;
  const eliteRoll = Math.random();
  const adjSProb  = Math.min(sProb * sMult, 0.12);
  const eliteTier = eliteRoll < adjSProb            ? 3  // S급
    : eliteRoll < adjSProb + 0.075                  ? 2  // A급 7.5%
    : eliteRoll < adjSProb + 0.075 + 0.15           ? 1  // B급 15%
    : 0;
  const eliteBonus = eliteTier === 3 ? rand(8, 14)
    : eliteTier === 2 ? rand(4, 8)
    : eliteTier === 1 ? rand(1, 4)
    : 0;

  const ability = {};
  for (const key of ['stuff', 'command', 'control']) {
    const range = leagueRange[key];
    const randomVal = rand(range[0], range[1]);
    const anchor = estimate[key] != null ? estimate[key] : (range[0] + range[1]) / 2;
    ability[key] = clamp(anchor * anchorW + randomVal * (1 - anchorW) + eliteBonus);
  }
  // holding: 외국 리그 주자억제 샘플 극소 → 50 중심 좁은 분포
  ability.holding = clamp(rand(46, 54));
  ability.stamina = starter ? clamp(rand(52, 70)) : clamp(rand(44, 62));

  // ── 적응 유형 ──
  const adaptationType = pickWeighted(ADAPTATION_TYPES);

  // ── 스카우팅 정확도 ──
  // 신뢰도 높으면 노이즈 작음, 낮으면 노이즈 큼
  const scoutAccuracy = clamp(rand(20, 95), 0, 100);
  const noiseRange = (100 - scoutAccuracy) / 100 * 15; // 최대 ±15

  // ── 스카우팅된 능력치 (노이즈 반영 — 영입 시 보이는 값) ──
  const scouted = {};
  for (const key of ['stuff', 'command', 'control', 'holding', 'stamina']) {
    scouted[key] = clamp(ability[key] + rand(-noiseRange, noiseRange));
  }

  // ── KBO 적합도 (스카우팅된 능력치 기반 — 노이즈 포함) ──
  const kboFit = clamp(
    50
    + (scouted.stuff - 50) * 0.6 + (scouted.control - 50) * 0.4
    + rand(-5, 5),
    0, 100
  );

  // ── 적응 커브 적용 능력치 (시즌 중 실제 발휘 — trueAbility × 적응계수) ──
  const adaptFactor1 = adaptationType.curve[0];
  const adapted = {};
  for (const key of ['stuff', 'command', 'control', 'holding', 'stamina']) {
    adapted[key] = clamp(50 + (ability[key] - 50) * adaptFactor1);
  }

  // ── 스카우팅 힌트 (스카우팅된 능력치 기반 — 스카우트가 보는 것) ──
  const hints = generateHints(
    scouted.stuff, scouted.command, scouted.control,
    adaptationType, kboFit, sourceLeague
  );

  return {
    // pitcherEval 호환 — 스카우팅된 능력치 (영입 시 표시)
    isStarterRole: starter,
    sourceLeague,
    stuff:   scouted.stuff,
    command: scouted.command,
    control: scouted.control,
    holding: scouted.holding,
    stamina: scouted.stamina,

    // 용병 스카우팅 메타데이터
    isForeignSignee: true,
    scouting: {
      estimate,            // 외국 스탯 기반 참고 추정치
      trueAbility: ability, // 진짜 능력치 (히든 — 시즌 진행 시 드러남)
      adapted,             // 시즌 중 실제 발휘 (trueAbility × 적응계수)
      adaptationType,
      kboFit,
      scoutAccuracy,       // 스카우팅 신뢰도 (0~100%)
      hints,
    },
  };
}
