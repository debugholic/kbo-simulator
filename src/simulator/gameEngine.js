/**
 * gameEngine.js — 경기 상태 관리 및 플레이 판정
 *
 * 수비 메커니즘이 구현되기 전까지 인플레이 타구는 확률 기반으로 판정합니다.
 */

// ── 기본 라인업 생성 ─────────────────────────────────────────────

const ORDER_LABELS = ['1번', '2번', '3번', '4번', '5번', '6번', '7번', '8번', '9번'];

// 타순별 능력치 분포 (중심 조정)
const ORDER_STATS = [
  { contact: 62, power: 52, eye: 60, speed: 68 }, // 1번: 빠른 선구안
  { contact: 65, power: 55, eye: 58, speed: 58 }, // 2번: 컨택+선구
  { contact: 58, power: 68, eye: 52, speed: 52 }, // 3번: 파워
  { contact: 55, power: 72, eye: 50, speed: 48 }, // 4번: 클린업
  { contact: 56, power: 64, eye: 52, speed: 50 }, // 5번
  { contact: 60, power: 55, eye: 55, speed: 54 }, // 6번
  { contact: 58, power: 50, eye: 52, speed: 56 }, // 7번
  { contact: 55, power: 48, eye: 50, speed: 55 }, // 8번
  { contact: 50, power: 44, eye: 48, speed: 58 }, // 9번: 약한 타자
];

function jitter(base, range = 6) {
  return Math.max(20, Math.min(80, base + Math.round((Math.random() - 0.5) * range)));
}

export function createDefaultLineup(teamId) {
  return ORDER_STATS.map((s, i) => ({
    id:        `${teamId}-bat-${i + 1}`,
    name:      ORDER_LABELS[i],
    contact_l: jitter(s.contact),
    contact_r: jitter(s.contact),
    power:     jitter(s.power),
    eye:       jitter(s.eye),
    speed:     jitter(s.speed),
    bunt:      40,
    fatigue:   0,
  }));
}

// ── 경기 초기 상태 ────────────────────────────────────────────────

export function createGameState() {
  return {
    inning:     1,           // 현재 이닝 (1~9)
    topBottom:  'top',       // 'top' = 원정 공격, 'bottom' = 홈 공격
    outs:       0,
    score:      { away: 0, home: 0 },
    bases:      [false, false, false],  // [1루, 2루, 3루]
    lineupIdx:  { away: 0, home: 0 },  // 현재 타순 인덱스
    count:      { balls: 0, strikes: 0 },
    gameLog:    [],          // play-by-play 텍스트 배열
    isGameOver: false,
    totalInnings: 9,
    // 누적 기록
    stats: {
      away: { ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, so: 0, r: 0 },
      home: { ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, so: 0, r: 0 },
    },
    pitcherStats: {
      away: { pitches: 0, ip: 0, h: 0, bb: 0, so: 0, er: 0 },
      home: { pitches: 0, ip: 0, h: 0, bb: 0, so: 0, er: 0 },
    },
  };
}

// ── 인플레이 타구 판정 (수비 메커니즘 없이 확률 기반) ──────────────

/**
 * @param {Object} bat  — BattingSimulator.simulate() 결과 (result === 'contact')
 * @param {boolean[]} bases
 * @param {number} outs
 * @returns {{ result, hitType?, runsScored, desc, basesAfter, outsAdded }}
 */
export function judgeInPlay(bat, bases, outs) {
  const { type, quality, exitVelo, estDist, wallDist } = bat;
  const q = quality / 100;
  const r = Math.random();

  if (type === 'home_run') {
    const runnersOn = bases.filter(Boolean).length;
    return {
      result:     'home_run',
      hitType:    'home_run',
      outsAdded:  0,
      runsScored: 1 + runnersOn,
      desc:       `홈런! (${1 + runnersOn}점)`,
      basesAfter: [false, false, false],
    };
  }

  if (type === 'popup') {
    return { result: 'out', outType: 'popup', outsAdded: 1, runsScored: 0, desc: '팝플라이 아웃', basesAfter: [...bases] };
  }

  if (type === 'grounder') {
    // 병살 조건: 1루 주자 + 1아웃 미만
    const dpPossible = bases[0] && outs < 2 && q < 0.45;
    if (dpPossible && r < 0.25) {
      const newBases = [...bases];
      newBases[0] = false;
      return { result: 'out', outType: 'dp', outsAdded: 2, runsScored: 0, desc: '병살타', basesAfter: newBases };
    }
    const hitProb = 0.22 + q * 0.24;  // 22~46%
    if (r < hitProb) {
      const { newBases, runs } = advanceBases([...bases], 'single');
      return { result: 'hit', hitType: 'single', outsAdded: 0, runsScored: runs, desc: `안타 (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
    }
    const newBases = advanceOnGroundOut([...bases], outs);
    return { result: 'out', outType: 'grounder', outsAdded: 1, runsScored: 0, desc: '땅볼 아웃', basesAfter: newBases };
  }

  if (type === 'line_drive') {
    const hitProb = 0.60 + q * 0.22;  // 60~82%
    if (r < hitProb) {
      // 2루타: quality + exitVelo 기반 (50레벨 ≈110 km/h → ~23%, 70레벨 ≈125 → ~32%)
      const doubleProb = Math.min(0.50, 0.10 + q * 0.20 + Math.max(0, (exitVelo - 100) / 300));
      const isDouble = Math.random() < doubleProb;
      const isTriple = isDouble && Math.random() < 0.10;
      if (isTriple) {
        const { newBases, runs } = advanceBases([...bases], 'triple');
        return { result: 'hit', hitType: 'triple', outsAdded: 0, runsScored: runs, desc: `3루타! (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
      }
      if (isDouble) {
        const { newBases, runs } = advanceBases([...bases], 'double');
        return { result: 'hit', hitType: 'double', outsAdded: 0, runsScored: runs, desc: `2루타! (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
      }
      const { newBases, runs } = advanceBases([...bases], 'single');
      return { result: 'hit', hitType: 'single', outsAdded: 0, runsScored: runs, desc: `안타 (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
    }
    return { result: 'out', outType: 'line_drive', outsAdded: 1, runsScored: 0, desc: '라이너 아웃', basesAfter: [...bases] };
  }

  if (type === 'deep_fly') {
    // 깊은 외야 타구 (담장 18m 이내): 홈런성이지만 다양한 결과
    const dist = estDist ?? 78;
    const wDist = wallDist ?? 100;

    // 담장 5m 이내: 담장 직격 타구
    if (dist >= wDist - 5) {
      const wallDouble = Math.random() < 0.55;
      if (wallDouble) {
        const { newBases, runs } = advanceBases([...bases], 'double');
        return { result: 'hit', hitType: 'double', outsAdded: 0, runsScored: runs, desc: `담장 직격 2루타! (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
      }
      return { result: 'out', outType: 'deep_fly', outsAdded: 1, runsScored: 0, desc: `담장 앞 외야 플라이 아웃 (${dist}m)`, basesAfter: [...bases] };
    }
    // 담장 12m 이내: 깊은 외야 → 희생플라이 확률 높음
    if (dist >= wDist - 12) {
      if (bases[2] && outs < 2 && Math.random() < 0.70) {
        const nb = [...bases]; nb[2] = false;
        return { result: 'sac_fly', outsAdded: 1, runsScored: 1, desc: `깊은 외야 플라이 희생타 (${dist}m, 1타점)`, basesAfter: nb };
      }
      return { result: 'out', outType: 'deep_fly', outsAdded: 1, runsScored: 0, desc: `깊은 외야 플라이 아웃 (${dist}m)`, basesAfter: [...bases] };
    }
    // 담장 18m 이내: 중간 깊이 외야 → 일반 희생플라이 확률
    if (bases[2] && outs < 2 && q > 0.35 && Math.random() < 0.55) {
      const nb = [...bases]; nb[2] = false;
      return { result: 'sac_fly', outsAdded: 1, runsScored: 1, desc: `외야 희생 플라이 (${dist}m, 1타점)`, basesAfter: nb };
    }
    return { result: 'out', outType: 'deep_fly', outsAdded: 1, runsScored: 0, desc: `외야 플라이 아웃 (${dist}m)`, basesAfter: [...bases] };
  }

  if (type === 'fly_ball') {
    // 일반 외야 플라이 (estDist < 72m)
    if (bases[2] && outs < 2 && q > 0.35 && Math.random() < 0.55) {
      const newBases = [...bases];
      newBases[2] = false;
      return { result: 'sac_fly', outsAdded: 1, runsScored: 1, desc: '희생 플라이 (1타점)', basesAfter: newBases };
    }
    const hitProb = 0.12 + q * 0.16;  // 12~28% (장타 가능)
    if (r < hitProb) {
      // 2루타: quality + exitVelo 기반 (50레벨 ≈110 km/h → ~15%, 70레벨 ≈125 → ~22%)
      const doubleProb = Math.min(0.45, 0.05 + q * 0.15 + Math.max(0, (exitVelo - 100) / 400));
      const isDouble = Math.random() < doubleProb;
      if (isDouble) {
        const { newBases, runs } = advanceBases([...bases], 'double');
        return { result: 'hit', hitType: 'double', outsAdded: 0, runsScored: runs, desc: `2루타! (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
      }
      const { newBases, runs } = advanceBases([...bases], 'single');
      return { result: 'hit', hitType: 'single', outsAdded: 0, runsScored: runs, desc: `안타 (${runs > 0 ? runs + '타점' : ''})`, basesAfter: newBases };
    }
    return { result: 'out', outType: 'fly_ball', outsAdded: 1, runsScored: 0, desc: '뜬공 아웃', basesAfter: [...bases] };
  }

  return { result: 'out', outType: 'unknown', outsAdded: 1, runsScored: 0, desc: '아웃', basesAfter: [...bases] };
}

// ── 주루 시뮬레이션 ───────────────────────────────────────────────

function advanceBases(bases, hitType) {
  let runs = 0;
  const b = [...bases];

  if (hitType === 'single') {
    if (b[2]) { runs++; b[2] = false; }
    if (b[1]) {
      if (Math.random() < 0.60) { runs++; b[1] = false; }
      else { b[2] = true; b[1] = false; }
    }
    if (b[0]) { b[1] = true; b[0] = false; }
    b[0] = true;
  } else if (hitType === 'double') {
    if (b[2]) { runs++; b[2] = false; }
    if (b[1]) { runs++; b[1] = false; }
    if (b[0]) {
      if (Math.random() < 0.50) { runs++; b[0] = false; }
      else { b[2] = true; b[0] = false; }
    }
    b[1] = true;
  } else if (hitType === 'triple') {
    runs += b.filter(Boolean).length;
    b.fill(false);
    b[2] = true;
  } else if (hitType === 'home_run') {
    runs += b.filter(Boolean).length + 1;
    b.fill(false);
  }
  return { newBases: b, runs };
}

function advanceOnGroundOut(bases, outs) {
  // 1아웃 미만이면 주자 한 칸씩 진루 (포스 아웃 제외 다른 주자)
  if (outs < 2 && bases[1]) {
    const b = [...bases];
    if (Math.random() < 0.4) { b[2] = true; b[1] = false; }
    return b;
  }
  return [...bases];
}

// ── 타석 결과 처리 ────────────────────────────────────────────────

/**
 * 타석 완료(볼넷/삼진/인플레이) 후 게임 상태 갱신
 * @param {Object} gs           — gameState (mutate 하지 않고 복사 반환)
 * @param {'away'|'home'} side  — 공격 팀
 * @param {Object} atBatResult  — { type: 'walk'|'strikeout'|'strikeout_looking'|'in_play', playJudge?, batterName }
 * @returns {{ newGs, logLine }}
 */
export function processAtBat(gs, side, atBatResult) {
  const ng = deepCloneGs(gs);
  const pitcherSide = side === 'away' ? 'home' : 'away';
  const { type, playJudge, batterName } = atBatResult;
  const prefix = `${ng.inning}회 ${ng.topBottom === 'top' ? '초' : '말'} [${batterName}]`;
  let logLine = '';

  ng.pitcherStats[pitcherSide].pitches = (ng.pitcherStats[pitcherSide].pitches || 0);

  if (type === 'walk') {
    // 볼넷: 주자 밀어내기
    ng.stats[side].bb++;
    const { newBases, runs } = walkAdvance([...ng.bases]);
    ng.bases = newBases;
    ng.score[side] += runs;
    ng.stats[side].r += runs;
    if (runs > 0) ng.stats[side].rbi = (ng.stats[side].rbi || 0) + runs;
    ng.pitcherStats[pitcherSide].bb++;
    if (runs > 0) ng.pitcherStats[pitcherSide].er += runs;
    logLine = `${prefix} 볼넷${runs > 0 ? ` (밀어내기 득점!)` : ''}`;
  } else if (type === 'strikeout' || type === 'strikeout_looking') {
    ng.stats[side].ab++;
    ng.stats[side].so++;
    ng.pitcherStats[pitcherSide].so++;
    ng.outs++;
    logLine = `${prefix} ${type === 'strikeout' ? '헛스윙 삼진' : '낫아웃 삼진'}`;
  } else if (type === 'in_play' && playJudge) {
    const j = playJudge;
    ng.stats[side].ab++;

    if (j.result === 'out' || j.result === 'sac_fly') {
      ng.outs += j.outsAdded;
      ng.bases = j.basesAfter;
      if (j.runsScored > 0) {
        ng.score[side] += j.runsScored;
        ng.stats[side].r += j.runsScored;
        ng.stats[side].rbi = (ng.stats[side].rbi || 0) + j.runsScored;
        ng.pitcherStats[pitcherSide].er += j.runsScored;
      }
      logLine = `${prefix} ${j.desc}`;
    } else if (j.result === 'hit' || j.result === 'home_run') {
      ng.stats[side].h++;
      ng.pitcherStats[pitcherSide].h++;
      if (j.hitType === 'home_run') ng.stats[side].hr++;
      if (j.runsScored > 0) {
        ng.score[side] += j.runsScored;
        ng.stats[side].r += j.runsScored;
        ng.stats[side].rbi = (ng.stats[side].rbi || 0) + j.runsScored;
        ng.pitcherStats[pitcherSide].er += j.runsScored;
      }
      ng.bases = j.basesAfter;
      logLine = `${prefix} ${j.desc}`;
    }
  }

  // 이닝 종료 체크
  if (ng.outs >= 3) {
    ng.outs = 0;
    ng.bases = [false, false, false];
    ng.count = { balls: 0, strikes: 0 };

    // IP 기록
    ng.pitcherStats[pitcherSide].ip = (ng.pitcherStats[pitcherSide].ip || 0) + 1;

    if (ng.topBottom === 'top') {
      ng.topBottom = 'bottom';
    } else {
      ng.topBottom = 'top';
      ng.inning++;
      // 9회말 홈팀 리드 → 게임 종료
      if (ng.inning > ng.totalInnings) {
        ng.isGameOver = true;
      }
    }

    // 끝내기 체크: 9회말(이상) 홈팀이 앞서면 즉시 종료
    if (!ng.isGameOver && ng.inning >= ng.totalInnings && ng.topBottom === 'bottom' && ng.score.home > ng.score.away) {
      ng.isGameOver = true;
    }
  }

  if (logLine) ng.gameLog = [logLine, ...ng.gameLog].slice(0, 80);
  ng.count = { balls: 0, strikes: 0 };

  return ng;
}

// 볼넷 주루
function walkAdvance(bases) {
  let runs = 0;
  if (bases[0] && bases[1] && bases[2]) {
    runs = 1; // 만루 밀어내기
  } else if (bases[0] && bases[1]) {
    bases[2] = true;
  } else if (bases[0]) {
    bases[1] = true;
  } else {
    bases[0] = true;
  }
  return { newBases: bases, runs };
}

// 현재 공격 팀 반환
export function getAttackingSide(gs) {
  return gs.topBottom === 'top' ? 'away' : 'home';
}

// 현재 수비(투수) 팀 반환
export function getDefendingSide(gs) {
  return gs.topBottom === 'top' ? 'home' : 'away';
}

// ── 이닝/점수 표시 텍스트 ─────────────────────────────────────────

export function inningLabel(gs) {
  if (gs.isGameOver) return '경기 종료';
  return `${gs.inning}회 ${gs.topBottom === 'top' ? '초' : '말'}`;
}

// ── 간이 deepClone (중첩 객체) ────────────────────────────────────

function deepCloneGs(gs) {
  return {
    ...gs,
    score:  { ...gs.score },
    bases:  [...gs.bases],
    lineupIdx: { ...gs.lineupIdx },
    count:  { ...gs.count },
    gameLog: [...gs.gameLog],
    stats: {
      away: { ...gs.stats.away },
      home: { ...gs.stats.home },
    },
    pitcherStats: {
      away: { ...gs.pitcherStats.away },
      home: { ...gs.pitcherStats.home },
    },
  };
}
