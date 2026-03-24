/**
 * 외국인 투수 생성 및 스카우팅 시스템
 */

// 적응 유형
export const ADAPTATION_TYPES = [
  { id: 'early',  label: '조기 적응형', curve: [1.00, 1.00, 1.00], prob: 0.25 },
  { id: 'normal', label: '일반 적응형', curve: [0.80, 1.00, 1.00], prob: 0.45 },
  { id: 'slow',   label: '느린 적응형', curve: [0.60, 0.85, 1.00], prob: 0.20 },
  { id: 'bust',   label: '부적응형',    curve: [0.55, 0.65, 0.70], prob: 0.10 },
];

// 출신 리그별 능력치 기대값 범위
export const LEAGUE_BASE = {
  MLB: { stuff: [60, 75], command: [55, 72], control: [55, 70] },
  AAA: { stuff: [50, 68], command: [48, 65], control: [48, 63] },
  NPB: { stuff: [52, 67], command: [52, 68], control: [52, 66] },
};

// 구종별 구속 범위 (km/h)
// MLB 평균 포심 ~152, 엘리트 160+; AAA ~148; NPB ~146
const PITCH_META = {
  '4seam':  { kor: '포심',    veloKmh: { MLB: [149,165], AAA: [144,158], NPB: [142,155] } },
  '2seam':  { kor: '투심',    veloKmh: { MLB: [146,161], AAA: [141,155], NPB: [139,152] } },
  sinker:   { kor: '싱커',    veloKmh: { MLB: [146,161], AAA: [141,154], NPB: [139,151] } },
  cutter:   { kor: '커터',    veloKmh: { MLB: [140,152], AAA: [136,149], NPB: [135,147] } },
  slider:   { kor: '슬라이더', veloKmh: { MLB: [134,149], AAA: [130,145], NPB: [129,143] } },
  changeup: { kor: '체인지업', veloKmh: { MLB: [133,147], AAA: [129,143], NPB: [128,141] } },
  curve:    { kor: '커브',    veloKmh: { MLB: [121,138], AAA: [117,134], NPB: [116,133] } },
  fork:     { kor: '포크',    veloKmh: { MLB: [131,145], AAA: [128,141], NPB: [127,140] } },
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

    const veloRange = PITCH_META[type]?.veloKmh?.[sourceLeague] || [138, 150];
    const velo = randInt(veloRange[0], veloRange[1]);
    const name = PITCH_META[type]?.kor || type;

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
    // 리더십: MLB/NPB 경력자가 약간 높음
    leadership:      clamp(rand(40, 65) + (league === 'MLB' ? rand(5, 12) : league === 'NPB' ? rand(2, 8) : rand(-4, 6)) + rand(-4, 4)),
  };
}

/**
 * 가상 외국인 투수 생성
 * @param {string} sourceLeague - 'MLB' | 'AAA' | 'NPB'
 * @param {string} role - 'SP' | 'RP'
 */
export function generateForeignPitcher(sourceLeague = 'AAA', role = 'SP') {
  const base = LEAGUE_BASE[sourceLeague] || LEAGUE_BASE.AAA;

  // ── 숨겨진 진짜 능력치 ──
  const trueStuff   = clamp(rand(...base.stuff)   + (Math.random() < 0.15 ? rand(5, 10) : 0));
  const trueCommand = clamp(rand(...base.command)  + (Math.random() < 0.15 ? rand(4, 8)  : 0));
  const trueControl = clamp(rand(...base.control)  + (Math.random() < 0.15 ? rand(4, 8)  : 0));
  const trueStamina = role === 'SP'
    ? clamp(rand(52, 70))
    : clamp(rand(44, 62));
  const trueHolding = role === 'SP'
    ? clamp(rand(42, 65))
    : clamp(rand(50, 70));

  // 적응 유형 (숨김)
  const adaptationType = pickWeighted(ADAPTATION_TYPES);

  // KBO 적합도: 0~100 (숨김)
  const kboFit = clamp(
    (trueStuff - 40) * 0.6 + (trueControl - 40) * 0.4
    + (adaptationType.id === 'bust' ? -15 : adaptationType.id === 'early' ? 10 : 0)
    + rand(-10, 10),
    0, 100
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

  // ── 스카우팅 힌트 생성 ──
  const hints = generateHints(trueStuff, trueCommand, trueControl, adaptationType, kboFit, sourceLeague);

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
    },
    hidden: {
      trueStuff,
      trueCommand,
      trueControl,
      trueStamina,
      trueHolding,
      attributes,
      adaptationType,
      kboFit,
    },
    simPlayer,
  };
}

// 풀에서 랜덤 1개 선택
export function pick(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

export function generateHints(stuff, command, control, adapt, kboFit, league) {
  const hints = [];

  // ── 구위 ──
  if (stuff >= 65) {
    hints.push({ type: 'positive', text: pick([
      '탁월한 구위 — KBO 타자들이 적응하기 어려울 것',
      '직구 위력이 리그 최상위권 수준, 즉전력 기대',
      '파워 피처형 — 삼진 생산 능력 높음',
      '구위만으로도 KBO 로테이션 상위권 가능',
    ])});
  } else if (stuff >= 58) {
    hints.push({ type: 'neutral', text: pick([
      '리그 평균 이상의 구위, 변화구 조합이 관건',
      '직구가 준수한 수준 — 제구와의 조합이 승부처',
      '구위는 합격선, 적응만 된다면 안정적 등판 가능',
      '평균 이상 구위, 다른 요소에서 차별화 필요',
    ])});
  } else {
    hints.push({ type: 'negative', text: pick([
      '구위 의존도 낮음 — 제구와 변화구 조합이 핵심',
      '파워 부족, 타자를 압도할 수 있는 무기 부재',
      'KBO 상위 타자들에게 직구 노출 위험 있음',
      '구위 열세 — 볼배합과 위치 선구가 생명선',
    ])});
  }

  // ── 제구/컨트롤 ──
  if (control >= 62) {
    hints.push({ type: 'positive', text: pick([
      '볼넷 억제력 우수, 이닝 소화 안정적',
      '제구 정밀도 높음 — 피안타 관리 능력 기대',
      '스트라이크 비율이 높아 불필요한 위기 최소화',
      '타자와의 카운트 싸움에서 주도권 유리',
    ])});
  } else if (control < 50) {
    hints.push({ type: 'negative', text: pick([
      'BB/9 높음 — 제구 불안이 최대 리스크',
      '볼넷이 잦아 이닝 소화에 부담, 선발 한계 우려',
      '출루 허용이 많아 실점 위험 상시 존재',
      '스트라이크존 공략 능력 부족 — 카운트 불리 잦음',
    ])});
  }

  // ── 적응 유형 ──
  if (adapt.id === 'early') {
    hints.push({ type: 'positive', text: pick([
      '과거 리그 이동 시 빠른 적응 이력',
      '환경 변화에 강한 멘탈과 루틴 보고됨',
      '1년차부터 풀 활약 기대 가능한 적응형 선수',
      '새 팀·리그에서도 퍼포먼스 유지 이력 있음',
    ])});
  } else if (adapt.id === 'slow') {
    hints.push({ type: 'neutral', text: pick([
      '1년차 기대치를 낮게 잡는 것을 권장',
      '초반 적응 시간이 필요한 타입, 장기적 관점 필요',
      '환경 변화에 익숙해지기까지 시간이 걸리는 편',
      '2년차 반등 가능성 열어두고 인내심 있는 운용 필요',
    ])});
  } else if (adapt.id === 'bust') {
    hints.push({ type: 'negative', text: pick([
      '환경 변화에 민감한 스타일로 보고됨',
      '리그 이동 후 급격한 성적 저하 패턴 있음',
      '낯선 타자 데이터에 노출 시 적응 고전 우려',
      '심리적 안정이 확보되지 않으면 성적 불안정 예상',
    ])});
  }

  // ── 출신 리그 ──
  if (league === 'MLB') {
    hints.push({ type: 'positive', text: pick([
      'MLB 경험 보유 — KBO 수준 차이 기대',
      '메이저리그 마운드 경험, 압박 상황 대처 능력 검증',
      'MLB 출신 특유의 파워와 무브먼트 기대',
      '빅리그 커리어 보유 — 기술적 완성도 높음',
    ])});
  } else if (league === 'NPB') {
    hints.push({ type: 'neutral', text: pick([
      'NPB 출신 — KBO와 유사한 야구 문화로 적응 수월',
      '일본 리그 경험 — 세밀한 피칭 스타일 기대',
      'NPB 스타일의 제구 중심 투구, KBO 적응 무난 예상',
      '타자 공략 패턴이 KBO와 어느 정도 겹쳐 초반 유리',
    ])});
  }

  // ── KBO 적합도 ──
  if (kboFit >= 70) {
    hints.push({ type: 'positive', text: pick([
      'KBO 리그 스타일과의 궁합 양호',
      'KBO 타자 스타일에 유리한 구종 조합 보유',
      '스카우팅 분석상 KBO 환경 최적화 가능성 높음',
      '리그 궁합 우수 — 즉시 전력감으로 평가됨',
    ])});
  } else if (kboFit < 45) {
    hints.push({ type: 'negative', text: pick([
      'KBO 타자 상대 유효 무기가 불분명',
      '리그 궁합 불투명 — 뚜껑 열어봐야 알 수 있는 케이스',
      'KBO 스타일에 맞지 않는 투구 패턴, 조정 필요',
      '스카우팅 데이터 한계로 실전 검증 전까지 불확실',
      '타자 우위의 KBO 환경에서 고전할 수 있음',
    ])});
  }

  return hints;
}
