/**
 * genAbilities.js
 * gen_abilities.js 공식을 브라우저에서 실행할 수 있도록 포팅한 모듈.
 * Supabase player_season_stats 데이터를 받아 능력치를 계산한다.
 */

// ───────── 유틸 ─────────

/** 0~100 범위로 클램프 */
function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * 이닝(IP) 파싱
 * "103⅔" → 103.667 / "⅓" → 0.333 / "50" → 50
 */
function parseIP(ipStr) {
  if (!ipStr) return 0;
  const str = String(ipStr).replace(/\xa0/g, ' ').trim();
  const fractionMap = { '⅓': 1 / 3, '⅔': 2 / 3 };
  for (const [frac, val] of Object.entries(fractionMap)) {
    if (str.endsWith(frac)) {
      const intPart = parseFloat(str.replace(frac, '').trim()) || 0;
      return intPart + val;
    }
  }
  return parseFloat(str) || 0;
}

/** 빈 문자열 / null을 null로 통일 */
function toFloat(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

/**
 * 최근 3시즌 가중 평균 (가중치: 0.5 / 0.3 / 0.2)
 * seasonStats: { year: { col: value } }
 */
function weightedAverage(seasonStats, key, customParser = null) {
  const weights = [0.5, 0.3, 0.2];
  const years = Object.keys(seasonStats || {})
    .map(Number)
    .sort((a, b) => b - a)
    .slice(0, 3);

  if (!years.length) return null;

  let sum = 0;
  let totalWeight = 0;

  years.forEach((year, i) => {
    const raw = seasonStats[year]?.[key];
    const value = customParser ? customParser(raw) : toFloat(raw);
    if (value !== null && !isNaN(value)) {
      sum += value * weights[i];
      totalWeight += weights[i];
    }
  });

  return totalWeight > 0 ? sum / totalWeight : null;
}

/** 통계: 평균 & 표준편차 */
function computeStats(arr) {
  const valid = arr.filter(v => v !== null && !isNaN(v));
  if (!valid.length) return { mean: 0, std: 1 };
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const variance = valid.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / valid.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

/**
 * z-score 정규화 → 50 기준 스케일
 */
function normalize(value, { mean, std }, { spread = 15, inverse = false } = {}) {
  const z = (value - mean) / std;
  return 50 + (inverse ? -z : z) * spread;
}

/**
 * 신뢰도 보정: 샘플이 적을수록 50(평균)으로 회귀
 */
function applyReliability(ability, reliability) {
  const r = Math.min(Math.max(reliability, 0), 1);
  return 50 + (ability - 50) * r;
}

/** 투수 여부 판별 */
function isPitcherPosition(position) {
  if (!position) return false;
  const parts = position.split('/');
  return parts.some(p => ['P', 'SP', 'RP', 'CP'].includes(p.trim()));
}

// ───────── 리그 분포 계산 ─────────

/**
 * players: [{ id, position, seasonStats: { year: { avg, obp, ... } } }]
 */
function calculateLeagueDistributions(players) {
  const collectors = {
    avg:         { values: [] },
    obpMinusAvg: { values: [] },
    iso:         { values: [] },
    hrPerPA:     { values: [] },
    sbPerPA:     { values: [] },
    b3PerPA:     { values: [] },
    kPerPA:      { values: [] },
    era:         { values: [] },
    whip:        { values: [] },
    kPer9:       { values: [] },
    bbPer9:      { values: [] },
    ip:          { values: [] },
  };

  players.forEach(player => {
    const stats = player.seasonStats;
    if (!stats || !Object.keys(stats).length) return;

    const isPitcher = isPitcherPosition(player.position);

    if (!isPitcher) {
      const avg = weightedAverage(stats, 'avg');
      const obp = weightedAverage(stats, 'obp');
      const slg = weightedAverage(stats, 'slg');
      const hr  = weightedAverage(stats, 'hr');
      const sb  = weightedAverage(stats, 'sb');
      const pa  = weightedAverage(stats, 'pa');
      const so  = weightedAverage(stats, 'so');
      const b3  = weightedAverage(stats, 'b3');

      if (avg !== null)  collectors.avg.values.push(avg);
      if (avg !== null && obp !== null) collectors.obpMinusAvg.values.push(obp - avg);
      if (avg !== null && slg !== null) collectors.iso.values.push(slg - avg);
      if (hr  !== null && pa > 0) collectors.hrPerPA.values.push(hr  / pa);
      if (sb  !== null && pa > 0) collectors.sbPerPA.values.push(sb  / pa);
      if (b3  !== null && pa > 0) collectors.b3PerPA.values.push(b3  / pa);
      if (so  !== null && pa > 0) collectors.kPerPA.values.push(so   / pa);
    } else {
      const era  = weightedAverage(stats, 'era');
      const whip = weightedAverage(stats, 'whip');
      const so   = weightedAverage(stats, 'so');
      const bb   = weightedAverage(stats, 'bb');
      const ip   = weightedAverage(stats, 'ip', parseIP);

      if (era  !== null) collectors.era.values.push(era);
      if (whip !== null) collectors.whip.values.push(whip);
      if (so !== null && ip > 0) collectors.kPer9.values.push((so / ip) * 9);
      if (bb !== null && ip > 0) collectors.bbPer9.values.push((bb / ip) * 9);
      if (ip  !== null) collectors.ip.values.push(ip);
    }
  });

  const league = {};
  for (const [key, { values }] of Object.entries(collectors)) {
    league[key] = computeStats(values);
  }
  return league;
}

// ───────── 타자 능력치 ─────────

function calculateHitterAbilities(seasonStats, league) {
  const avg = weightedAverage(seasonStats, 'avg');
  const obp = weightedAverage(seasonStats, 'obp');
  const slg = weightedAverage(seasonStats, 'slg');
  const hr  = weightedAverage(seasonStats, 'hr');
  const sb  = weightedAverage(seasonStats, 'sb');
  const bb  = weightedAverage(seasonStats, 'bb');
  const pa  = weightedAverage(seasonStats, 'pa');
  const so  = weightedAverage(seasonStats, 'so');
  const b3  = weightedAverage(seasonStats, 'b3');

  const reliability = pa ? Math.min(pa / 300, 1) : 0;

  if (avg === null) {
    return { contact: 50, discipline: 50, power: 50, speed: 50 };
  }

  const iso       = slg !== null ? slg - avg : null;
  const obpMinAvg = obp !== null ? obp - avg : null;
  const hrPerPA   = hr  !== null && pa > 0 ? hr  / pa : null;
  const sbPerPA   = sb  !== null && pa > 0 ? sb  / pa : null;
  const b3PerPA   = b3  !== null && pa > 0 ? b3  / pa : null;
  const kPerPA    = so  !== null && pa > 0 ? so  / pa : null;

  const n = (val, dist, opts) =>
    val !== null ? clamp(normalize(val, dist, opts)) : 50;

  const raw = {
    contact: kPerPA !== null
      ? clamp(Math.round(
          0.7 * n(avg,    league.avg,    { spread: 20 }) +
          0.3 * n(kPerPA, league.kPerPA, { spread: 20, inverse: true })
        ))
      : n(avg, league.avg, { spread: 20 }),

    discipline: kPerPA !== null
      ? clamp(Math.round(
          0.5 * n(obpMinAvg, league.obpMinusAvg, { spread: 20 }) +
          0.5 * n(kPerPA,    league.kPerPA,       { spread: 20, inverse: true })
        ))
      : n(obpMinAvg, league.obpMinusAvg, { spread: 20 }),

    power: iso !== null
      ? clamp(Math.round(
          0.6 * n(iso,    league.iso,    { spread: 20 }) +
          0.4 * (hrPerPA !== null ? n(hrPerPA, league.hrPerPA, { spread: 20 }) : 50)
        ))
      : 50,

    speed: sbPerPA !== null
      ? clamp(Math.round(
          0.7 * n(sbPerPA, league.sbPerPA, { spread: 20 }) +
          0.3 * (b3PerPA !== null ? n(b3PerPA, league.b3PerPA, { spread: 20 }) : 50)
        ))
      : 50,
  };

  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, clamp(applyReliability(v, reliability))])
  );
}

// ───────── 투수 능력치 ─────────

function calculatePitcherAbilities(seasonStats, league) {
  const era  = weightedAverage(seasonStats, 'era');
  const whip = weightedAverage(seasonStats, 'whip');
  const so   = weightedAverage(seasonStats, 'so');
  const bb   = weightedAverage(seasonStats, 'bb');
  const ip   = weightedAverage(seasonStats, 'ip', parseIP);

  const reliability = ip ? Math.min(ip / 100, 1) : 0;

  if (era === null) {
    return { control: 50, stuff: 50, stamina: 50, command: 50 };
  }

  const kPer9  = so !== null && ip > 0 ? (so / ip) * 9 : null;
  const bbPer9 = bb !== null && ip > 0 ? (bb / ip) * 9 : null;

  const eraScore    = clamp(normalize(era,   league.era,   { spread: 20, inverse: true }));
  const whipScore   = whip   !== null ? clamp(normalize(whip,   league.whip,   { spread: 20, inverse: true })) : 50;
  const kPer9Score  = kPer9  !== null ? clamp(normalize(kPer9,  league.kPer9,  { spread: 20 }))               : 50;
  const bbPer9Score = bbPer9 !== null ? clamp(normalize(bbPer9, league.bbPer9, { spread: 20, inverse: true })) : 50;

  const raw = {
    // 제구: WHIP(60%) + BB/9(40%) — 안타+볼넷 허용 + 볼넷 억제
    control: clamp(Math.round(0.6 * whipScore   + 0.4 * bbPer9Score)),
    // 구위: K/9(60%) + ERA(40%) — 탈삼진 파워 + 실점 방지 종합
    stuff:   clamp(Math.round(0.6 * kPer9Score  + 0.4 * eraScore)),
    // 체력: IP 그대로 — OVR 가중치는 utils.js에서 낮춤
    stamina: clamp(normalize(ip, league.ip, { spread: 15 })),
    // 커맨드: BB/9만 — 순수 볼넷 억제력
    command: bbPer9Score,
  };

  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, clamp(applyReliability(v, reliability))])
  );
}

// ───────── 메인 ─────────

/**
 * Supabase에서 받은 데이터로 능력치를 계산한다.
 *
 * @param {Array} players       - players 테이블 rows (id, position, team_id, ...)
 * @param {Array} seasonStats   - player_season_stats 테이블 rows (player_id, season, avg, ...)
 * @param {Array} [adjustments] - player_ai_adjustments 테이블 rows (player_id, contact_adj, ...)
 * @returns {Array} [{ player_id, control, stuff, stamina, command, contact, discipline, power, speed, _base }]
 */
export function calcAllAbilities(players, seasonStats, adjustments = []) {
  // player_id → { season: { ...stats } }
  const statsMap = {};
  seasonStats.forEach(row => {
    const pid = String(row.player_id);
    if (!statsMap[pid]) statsMap[pid] = {};
    statsMap[pid][row.season] = row;
  });

  // player_id → adjustment row
  const adjMap = {};
  adjustments.forEach(row => { adjMap[String(row.player_id)] = row; });

  // 리그 분포 계산용 데이터 구성
  const playersWithStats = players.map(p => ({
    id: String(p.id),
    position: p.position,
    seasonStats: statsMap[String(p.id)] || {},
  }));

  const league = calculateLeagueDistributions(playersWithStats);

  // 각 선수 능력치 계산
  return playersWithStats.map(player => {
    const hasSeason = Object.keys(player.seasonStats).length > 0;
    const pitcher = isPitcherPosition(player.position);

    let base;
    if (!hasSeason) {
      base = pitcher
        ? { control: 50, stuff: 50, stamina: 50, command: 50 }
        : { contact: 50, discipline: 50, power: 50, speed: 50 };
    } else if (pitcher) {
      base = calculatePitcherAbilities(player.seasonStats, league);
    } else {
      base = calculateHitterAbilities(player.seasonStats, league);
    }

    // AI 보정치 적용
    const adj = adjMap[player.id];
    const abilities = { ...base };
    if (adj) {
      const cols = pitcher
        ? ['control', 'stuff', 'stamina', 'command']
        : ['contact', 'discipline', 'power', 'speed'];
      cols.forEach(col => {
        const delta = adj[`${col}_adj`];
        if (delta) abilities[col] = clamp((abilities[col] ?? 50) + delta);
      });
    }

    return {
      player_id: player.id,
      ...abilities,
      _base: base,  // 어드민 UI에서 formula 기본값 표시용 (DB 저장 안 함)
      source: 'generated',
      is_manual: false,
      updated_at: new Date().toISOString(),
    };
  });
}
