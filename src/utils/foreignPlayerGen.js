/**
 * 외국인 투수 생성 및 스카우팅 시스템
 */

import {
  LEAGUE_BASE, ELITE_S_PROB, PITCH_VELO,
} from './leagueConstants';

// 적응 유형
export const ADAPTATION_TYPES = [
  { id: 'early',  label: '조기 적응형', curve: [1.00, 1.00, 1.00], prob: 0.25 },
  { id: 'normal', label: '일반 적응형', curve: [0.80, 1.00, 1.00], prob: 0.45 },
  { id: 'slow',   label: '느린 적응형', curve: [0.60, 0.85, 1.00], prob: 0.20 },
  { id: 'bust',   label: '부적응형',    curve: [0.55, 0.65, 0.70], prob: 0.10 },
];

// LEAGUE_BASE, ELITE_S_PROB, PITCH_VELO → leagueConstants.js 에서 import
// LEAGUE_BASE 외부 참조용 재export (하위 호환)
export { LEAGUE_BASE };

// 구종별 구속 범위 (km/h)
// MLB 평균 포심 ~152, 엘리트 160+; AAA ~148; NPB ~146
// 구종 한국어 표기 (구속은 PITCH_VELO 참조)
const PITCH_KOR = {
  '4seam': '포심', '2seam': '투심', sinker: '싱커', cutter: '커터',
  slider: '슬라이더', changeup: '체인지업', curve: '커브', fork: '포크',
};

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.round(rand(min, max));
}

export function pickWeighted(items) {
  const r = Math.random();
  let acc = 0;
  for (const item of items) {
    acc += item.prob;
    if (r < acc) return item;
  }
  return items[items.length - 1];
}

export function clamp(v, min = 20, max = 80) {
  return Math.max(min, Math.min(max, Math.round(v)));
}

/**
 * 구종 레퍼토리 생성
 * 직구 계열 1개 + 변화구 2~3개 (SP), 직구 + 변화구 1~2개 (RP)
 */
function generatePitches(sourceLeague, role) {
  // 직구 계열 (1개)
  const fastballPool = [
    { type: '4seam', prob: 0.60 },
    { type: '2seam', prob: 0.25 },
    { type: 'sinker', prob: 0.15 },
  ];
  const primary = pickWeighted(fastballPool).type;

  // 변화구 풀
  const breakingPool = ['slider', 'curve', 'changeup', 'cutter', 'fork'];
  const numBreaking = role === 'SP' ? randInt(2, 3) : randInt(1, 2);
  const shuffled = [...breakingPool].sort(() => Math.random() - 0.5).slice(0, numBreaking);

  const allTypes = [primary, ...shuffled];

  // 사용 비율 배분
  let remaining = 100;
  const result = allTypes.map((type, i) => {
    const isLast = i === allTypes.length - 1;
    let pct;
    if (isLast) {
      pct = remaining;
    } else if (i === 0) {
      pct = Math.round(rand(40, 58)); // 직구 40~58%
    } else {
      pct = Math.round(remaining * rand(0.35, 0.55));
    }
    pct = Math.max(8, Math.min(pct, remaining - (allTypes.length - i - 1) * 8));
    remaining -= pct;

    const veloRange = PITCH_VELO[type]?.[sourceLeague] || [138, 150];
    const velo = randInt(veloRange[0], veloRange[1]);
    const name = PITCH_KOR[type] || type;

    return { type, name, velo, pct };
  });

  return result;
}

/**
 * player_attributes 생성
 * adaptationType, kboFit, league, 능력치에서 특성값 추론
 */
function generateAttributes(adaptationType, kboFit, league, trueStuff, trueCommand) {
  const cmdNorm = (trueCommand - 55) * 0.5; // 제구 좋을수록 집중력·승부욕 높은 경향
  return {
    // 승부욕: 전반적으로 높음, MLB 출신 더 높음
    competitiveness: clamp(rand(52, 72) + (league === 'MLB' ? rand(4, 10) : 0) + rand(-4, 4)),
    // 회복력: 부적응형은 멘탈 약함
    resilience:      clamp(rand(45, 68) + (adaptationType.id === 'bust' ? rand(-14, -5) : rand(-3, 7)) + rand(-4, 4)),
    // 집중력: 제구 연관
    focus:           clamp(rand(46, 68) + cmdNorm + rand(-5, 5)),
    // 적응력: 적응 유형과 직결
    adaptability:    clamp(rand(40, 65)
      + (adaptationType.id === 'early' ? rand(10, 18)
       : adaptationType.id === 'bust'  ? rand(-22, -8)
       : adaptationType.id === 'slow'  ? rand(-8, -2)
       : rand(-2, 8)) + rand(-4, 4)),
    // 성실함: MLB 출신 베테랑이 조금 높은 경향
    work_ethic:      clamp(rand(48, 70) + (league === 'MLB' ? rand(3, 9) : rand(-4, 6)) + rand(-4, 4)),
    // 내구력: 순수 랜덤 (부상 이력 알 수 없음)
    durability:      clamp(rand(42, 68) + rand(-5, 5)),
    // 리더십: MLB/NPB 경력자가 약간 높음, 마이너/약소리그는 낮음
    leadership:      clamp(rand(40, 65) + (league === 'MLB' ? rand(5, 12) : league === 'NPB' ? rand(2, 8) : league === 'NPB_FARM' || league === 'ABL' ? rand(-6, 2) : rand(-4, 6)) + rand(-4, 4)),
  };
}

/**
 * 가상 외국인 투수 생성
 * @param {string} sourceLeague - 'MLB' | 'AAA' | 'NPB'
 * @param {string} role - 'SP' | 'RP'
 */
export function generateForeignPitcher(sourceLeague = 'AAA', role = 'SP', hintPool = {}) {
  const base = LEAGUE_BASE[sourceLeague] || LEAGUE_BASE.AAA;

  // ── 숨겨진 진짜 능력치 (엘리트 연속 분포) ──
  const eliteRoll = Math.random();
  const sProb = ELITE_S_PROB[sourceLeague] ?? 0.015;
  const eliteTier = eliteRoll < sProb             ? 3   // S급 (리그별 상이)
    : eliteRoll < sProb + 0.075                   ? 2   // A급 7.5% (공통)
    : eliteRoll < sProb + 0.075 + 0.15            ? 1   // B급 15%  (공통)
    : 0;
  const eliteBonus = eliteTier === 3 ? rand(12, 18)
    : eliteTier === 2 ? rand(6, 12)
    : eliteTier === 1 ? rand(2, 6)
    : 0;
  const trueStuff   = clamp(rand(...base.stuff)   + eliteBonus);
  const trueCommand = clamp(rand(...base.command)  + eliteBonus);
  const trueControl = clamp(rand(...base.control)  + eliteBonus);
  const trueStamina = role === 'SP'
    ? clamp(rand(52, 70))
    : clamp(rand(44, 62));
  const trueHolding = role === 'SP'
    ? clamp(rand(42, 65))
    : clamp(rand(50, 70));

  // 적응 유형 (숨김)
  const adaptationType = pickWeighted(ADAPTATION_TYPES);

  // ── 스카우팅 정확도 & 노이즈 ──
  // 신뢰도 높으면 노이즈 작음, 낮으면 노이즈 큼 → 하이리스크 하이리턴
  const scoutAccuracy = clamp(rand(20, 95), 0, 100);
  const noiseRange = (100 - scoutAccuracy) / 100 * 15; // 최대 ±15

  // 스카우팅된 능력치 (노이즈 반영 — 영입 시 보이는 값)
  const scoutedStuff   = clamp(trueStuff   + rand(-noiseRange * 1.2, noiseRange * 0.8));
  const scoutedCommand = clamp(trueCommand + rand(-noiseRange * 1.2, noiseRange * 0.8));
  const scoutedControl = clamp(trueControl + rand(-noiseRange * 1.2, noiseRange * 0.8));

  // KBO 적합도 (스카우팅된 능력치 기반)
  const rawFit = 50 + (scoutedStuff - 50) * 0.6 + (scoutedControl - 50) * 0.4 + rand(-4, 4);

  const kboFit = clamp(
    50 + (rawFit - 50) * 0.85
  );

  // ── 직전 리그 성적 (스카우팅 가능 정보) ──
  const leagueERA  = +(rand(2.8, 5.5) - (trueStuff - 55) * 0.04 + rand(-0.3, 0.3)).toFixed(2);
  const leagueK9   = +(rand(6.0, 11.0) + (trueStuff - 55) * 0.06 + rand(-0.5, 0.5)).toFixed(1);
  const leagueBB9  = +(rand(2.0, 4.5) - (trueControl - 55) * 0.03 + rand(-0.3, 0.3)).toFixed(1);
  const leagueWHIP = +(0.85 + (leagueERA - 3.0) * 0.12 + rand(-0.05, 0.05)).toFixed(2);
  const leagueIP   = role === 'SP' ? randInt(80, 160) : randInt(40, 70);

  // ── KBO 예상 성적 범위 ──
  // 적응 1년차 기준, 불확실성 포함
  // 페널티 축소: (1-adaptFactor)*0.35, 리그 조정 축소
  const adaptFactor1 = adaptationType.curve[0];
  const leagueAdj = sourceLeague === 'MLB' ? -0.4 : sourceLeague === 'NPB' ? 0.1 : 0.2;
  const midERA = leagueERA * (1 + (1 - adaptFactor1) * 0.35) + leagueAdj;
  const kboERALow  = +(midERA - rand(0.3, 0.7)).toFixed(2);
  const kboERAHigh = +(midERA + rand(0.4, 1.0)).toFixed(2);

  // ── 구종 레퍼토리 ──
  const pitches = generatePitches(sourceLeague, role);

  // ── 특성(attributes) 생성 ──
  const attributes = generateAttributes(adaptationType, kboFit, sourceLeague, trueStuff, trueCommand);

  // ── 스카우팅 힌트 생성 (스카우팅된 능력치 기반 — 스카우트가 보는 것) ──
  const hints = generateHints(scoutedStuff, scoutedCommand, scoutedControl, adaptationType, kboFit, sourceLeague, hintPool);

  // ── 시뮬레이션용 player 객체 (careerSimulator 호환) ──
  const simPlayer = {
    position: role,
    sourceLeague,
    currentAge: randInt(26, 33),
    currentYear: 2026,
    currentAbility: {
      stuff:   trueStuff,
      command: trueCommand,
      control: trueControl,
      holding: trueHolding,
      stamina: trueStamina,
    },
    attributes,
  };

  return {
    visible: {
      sourceLeague,
      role,
      prevStats: {
        era:  Math.max(1.5, leagueERA),
        k9:   Math.min(13, Math.max(4, leagueK9)),
        bb9:  Math.min(6,  Math.max(1.2, leagueBB9)),
        whip: Math.max(0.8, leagueWHIP),
        ip:   leagueIP,
      },
      projectedERA: {
        low:  Math.max(2.5, kboERALow),
        high: Math.min(7.0, kboERAHigh),
      },
      pitches,
      hints,
      kboFit,           // 스카우팅 기대치 — 계약 전 공개
      scoutAccuracy,    // 스카우팅 정확도 (0~100%)
    },
    hidden: {
      trueStuff,
      trueCommand,
      trueControl,
      trueStamina,
      trueHolding,
      attributes,
      adaptationType,
    },
    simPlayer,
  };
}

// 풀에서 랜덤 1개 선택
export function pick(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * condition_key별로 힌트 풀을 그룹화
 */
export function buildHintPool(rows) {
  const pool = {};
  for (const row of rows) {
    const key = row.condition_key;
    if (!pool[key]) pool[key] = [];
    pool[key].push({ type: row.hint_type, text: row.opinion });
  }
  return pool;
}

function pickFromPool(pool, conditionKey) {
  const candidates = pool[conditionKey];
  if (!candidates || candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export function generateHints(stuff, command, control, adapt, kboFit, league, hintPool = {}) {
  const hints = [];

  // ── 구위 ──
  const stuffKey = stuff >= 70 ? 'stuff_elite' : stuff >= 62 ? 'stuff_high' : stuff >= 55 ? 'stuff_mid' : 'stuff_low';
  const stuffHint = pickFromPool(hintPool, stuffKey);
  if (stuffHint) hints.push(stuffHint);

  // ── 제구/커맨드 ──
  if (command >= 65) {
    const h = pickFromPool(hintPool, 'command_high');
    if (h) hints.push(h);
  } else if (command < 48) {
    const h = pickFromPool(hintPool, 'command_low');
    if (h) hints.push(h);
  }

  // ── 컨트롤 ──
  const controlKey = control >= 62 ? 'control_high' : control >= 52 ? 'control_mid' : 'control_low';
  const controlHint = pickFromPool(hintPool, controlKey);
  if (controlHint) hints.push(controlHint);

  // ── 적응 ──
  const adaptHint = pickFromPool(hintPool, 'adaptation_general');
  if (adaptHint) hints.push(adaptHint);

  // ── 출신 리그 ──
  const leagueKey = league === 'MLB' ? 'league_mlb' : league === 'NPB' ? 'league_npb' : 'league_aaa';
  const leagueHint = pickFromPool(hintPool, leagueKey);
  if (leagueHint) hints.push(leagueHint);

  // ── 투구 스타일 ──
  let styleKey = null;
  if (stuff >= 65 && control >= 60) styleKey = 'style_power_control';
  else if (stuff >= 60 && command < 50) styleKey = 'style_power_wild';
  else if (stuff < 55 && control >= 60) styleKey = 'style_finesse';
  else if (stuff < 50 && control < 50) styleKey = 'style_weak';
  if (styleKey) {
    const h = pickFromPool(hintPool, styleKey);
    if (h) hints.push(h);
  }

  // ── KBO 적합도 ──
  if (kboFit >= 70) {
    const h = pickFromPool(hintPool, 'kbo_fit_high');
    if (h) hints.push(h);
  } else if (kboFit < 40) {
    const h = pickFromPool(hintPool, 'kbo_fit_low');
    if (h) hints.push(h);
  }

  // 셔플 후 3개 반환
  for (let i = hints.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [hints[i], hints[j]] = [hints[j], hints[i]];
  }
  return hints.slice(0, 3);
}
