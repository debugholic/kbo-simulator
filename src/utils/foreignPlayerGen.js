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
// 상한을 높여 이론적 80 도달 가능 + 2.5% 확률로 OVR 73-78 엘리트
export const LEAGUE_BASE = {
  MLB: { stuff: [58, 78], command: [53, 74], control: [53, 72] },
  AAA: { stuff: [48, 72], command: [45, 68], control: [45, 66] },
  NPB: { stuff: [50, 70], command: [50, 70], control: [50, 68] },
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

  // ── 숨겨진 진짜 능력치 (엘리트 연속 분포) ──
  const eliteRoll = Math.random();
  const eliteTier = eliteRoll < 0.025 ? 3   // 2.5% S급
    : eliteRoll < 0.10 ? 2                   // 7.5% A급
    : eliteRoll < 0.25 ? 1                   // 15% B급
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
  const scoutedStuff   = clamp(trueStuff   + rand(-noiseRange, noiseRange));
  const scoutedCommand = clamp(trueCommand + rand(-noiseRange, noiseRange));
  const scoutedControl = clamp(trueControl + rand(-noiseRange, noiseRange));

  // KBO 적합도 (스카우팅된 능력치 기반)
  const kboFit = clamp(
    50 + (scoutedStuff - 50) * 0.6 + (scoutedControl - 50) * 0.4 + rand(-5, 5),
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

  // ── 스카우팅 힌트 생성 (스카우팅된 능력치 기반 — 스카우트가 보는 것) ──
  const hints = generateHints(scoutedStuff, scoutedCommand, scoutedControl, adaptationType, kboFit, sourceLeague);

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

export function generateHints(stuff, command, control, adapt, kboFit, league) {
  const hints = [];

  // ── 구위 ──
  if (stuff >= 70) {
    hints.push({ type: 'positive', text: pick([
      '탁월한 구위 — KBO 타자들이 적응하기 어려울 것',
      '직구 위력이 리그 최상위권 수준, 즉전력 기대',
      '파워 피처형 — 삼진 생산 능력 높음',
      '구위만으로도 KBO 로테이션 상위권 가능',
      '위압적인 패스트볼, 한국 타선 제압 가능',
      '공의 무브먼트가 탁월 — 헛스윙 유도 능력 특급',
      '직구·변화구 모두 위력적, 다각도 공격 가능',
      '투구 무기가 다양하고 날카로움, KBO 최상위 전력',
    ])});
  } else if (stuff >= 62) {
    hints.push({ type: 'positive', text: pick([
      '직구와 변화구 조합이 좋아 삼진을 기대할 수 있음',
      '결정구 위력이 좋아 이닝 마무리에 강점',
      '구위가 준수하며 타자를 압도할 잠재력 보유',
      '변화구 무브먼트가 인상적, KBO 타선에 유효할 것',
      '파워와 기술이 균형 잡힌 타입 — 안정적 삼진 확보',
      'KBO 수준에서 충분히 통할 구종 레퍼토리 보유',
    ])});
  } else if (stuff >= 55) {
    hints.push({ type: 'neutral', text: pick([
      '리그 평균 이상의 구위, 변화구 조합이 관건',
      '직구가 준수한 수준 — 제구와의 조합이 승부처',
      '구위는 합격선, 적응만 된다면 안정적 등판 가능',
      '평균 이상 구위, 다른 요소에서 차별화 필요',
      '직구 구속은 보통 — 무브먼트와 로케이션이 관건',
      '결정구의 날카로움이 일정하지 않아 변동성 존재',
      '구위 자체는 무난, 볼배합 운용에 따라 성적 갈림',
      '평범한 직구를 변화구로 커버하는 타입',
    ])});
  } else {
    hints.push({ type: 'negative', text: pick([
      '구위 의존도 낮음 — 제구와 변화구 조합이 핵심',
      '파워 부족, 타자를 압도할 수 있는 무기 부재',
      'KBO 상위 타자들에게 직구 노출 위험 있음',
      '구위 열세 — 볼배합과 위치 선구가 생명선',
      '직구가 평범하여 카운트 불리 시 위험도 상승',
      '변화구 의존도가 높아 패턴 노출 시 취약',
      '공의 위력이 부족해 장타 허용 가능성 높음',
      'KBO 중상위 타선 상대로는 고전이 예상됨',
    ])});
  }

  // ── 제구/커맨드 ──
  if (command >= 65) {
    hints.push({ type: 'positive', text: pick([
      '투구 위치 정밀도 높음 — 코너워크 일품',
      '원하는 곳에 꽂는 능력 탁월, 피안타 관리 기대',
      '존 엣지 공략 능력 우수 — 카운트 주도 용이',
      '가운데 몰림 없는 정교한 코스 공략형',
    ])});
  } else if (command < 48) {
    hints.push({ type: 'negative', text: pick([
      '투구가 가운데로 몰리는 경향 — 장타 위험',
      '의도한 위치에 공이 안 꽂히는 제구 불안',
      '존 중앙 투구 비율 높아 장타율 피해 우려',
      '코너워크 부재로 타자에게 유리한 카운트 허용',
    ])});
  }

  // ── 컨트롤 ──
  if (control >= 62) {
    hints.push({ type: 'positive', text: pick([
      '볼넷 억제력 우수, 이닝 소화 안정적',
      '스트라이크 비율이 높아 불필요한 위기 최소화',
      '타자와의 카운트 싸움에서 주도권 유리',
      '볼넷 걱정 없는 안정적 스트라이크 제어',
      '투구 효율이 좋아 이닝 깊숙이 소화 가능',
      '카운트 관리 능력이 좋아 경기 템포 유지에 유리',
    ])});
  } else if (control >= 52) {
    hints.push({ type: 'neutral', text: pick([
      '컨트롤은 평균적 수준, 볼넷 관리가 관건',
      '스트라이크 비율 보통 — 투구 수 관리 필요',
      '카운트 싸움에서 간헐적으로 불리한 장면 발생',
      '볼넷은 적정 수준이나 위기 상황에서 흔들릴 수 있음',
    ])});
  } else {
    hints.push({ type: 'negative', text: pick([
      'BB/9 높음 — 제구 불안이 최대 리스크',
      '볼넷이 잦아 이닝 소화에 부담, 선발 한계 우려',
      '출루 허용이 많아 실점 위험 상시 존재',
      '스트라이크존 공략 능력 부족 — 카운트 불리 잦음',
      '볼넷으로 자멸하는 패턴이 반복될 우려',
      '투구 수 낭비가 심해 5이닝 이상 버티기 어려울 수 있음',
      '주자 쌓인 상황에서 볼넷으로 추가 실점 위험',
    ])});
  }

  // ── 적응 관련 (모호한 힌트 — 적응 유형을 직접 노출하지 않음) ──
  const adaptHints = [
    { type: 'neutral', text: '스카우팅 데이터 한계로 실전 검증 전까지 불확실' },
    { type: 'neutral', text: '새로운 리그 적응 여부는 실전에서 확인 필요' },
    { type: 'neutral', text: '환경 변화에 대한 적응력은 미지수' },
    { type: 'neutral', text: '리그 이동 경험이 제한적 — 적응 속도 예측 어려움' },
    { type: 'neutral', text: '해외 생활 적응과 팀 케미스트리는 현장 확인 사항' },
    { type: 'neutral', text: 'KBO 공인구 차이에 대한 적응이 변수' },
    { type: 'neutral', text: '장기 레이스에서의 체력 관리와 페이스 조절은 실전 확인 필요' },
    { type: 'neutral', text: '한국 음식·문화 적응이 컨디션에 영향을 줄 수 있음' },
    { type: 'neutral', text: '통역·코칭스태프와의 소통이 적응 속도를 좌우' },
    { type: 'neutral', text: 'KBO 특유의 응원 문화와 분위기가 변수로 작용 가능' },
  ];
  hints.push(pick(adaptHints));

  // ── 출신 리그 ──
  if (league === 'MLB') {
    hints.push({ type: 'positive', text: pick([
      'MLB 경험 보유 — KBO 수준 차이 기대',
      '메이저리그 마운드 경험, 압박 상황 대처 능력 검증',
      'MLB 출신 특유의 파워와 무브먼트 기대',
      '빅리그 커리어 보유 — 기술적 완성도 높음',
      'MLB 경쟁에서 살아남은 검증된 실력',
      '빅리그 수준의 훈련 체계를 거친 선수',
    ])});
  } else if (league === 'NPB') {
    hints.push({ type: 'neutral', text: pick([
      'NPB 출신 — KBO와 유사한 야구 문화로 적응 수월',
      '일본 리그 경험 — 세밀한 피칭 스타일 기대',
      'NPB 스타일의 제구 중심 투구, KBO 적응 무난 예상',
      '타자 공략 패턴이 KBO와 어느 정도 겹쳐 초반 유리',
      '아시아 리그 경험으로 문화적 적응 장벽 낮음',
      'NPB 공인구와 KBO 공인구 차이가 관건',
    ])});
  } else {
    hints.push({ type: 'neutral', text: pick([
      'AAA 출신 — MLB 승격 경쟁에서 단련된 경험',
      '마이너리그 상위 레벨 경험, 기본기 검증됨',
      'AAA에서의 성적이 KBO로 직결되진 않으나 기대할 만함',
      '마이너리그 최상위급 — 잠재력은 충분',
      'MLB 콜업 경험 유무에 따라 기대치 조정 필요',
      'AAA 수준의 경쟁에서 검증된 내구성 보유',
    ])});
  }

  // ── 투구 스타일 (추가 다양성) ──
  const styleHints = [];
  if (stuff >= 65 && control >= 60) {
    styleHints.push(
      { type: 'positive', text: '파워와 제구를 겸비한 완성형 — 에이스급 자질' },
      { type: 'positive', text: '구위와 컨트롤 모두 우수, 로테이션 중심 역할 가능' },
    );
  }
  if (stuff >= 60 && command < 50) {
    styleHints.push(
      { type: 'neutral', text: '파워는 있으나 제구가 불안 — 양날의 검' },
      { type: 'neutral', text: '강속구에 의존하는 스타일, 볼배합 개선 시 급성장 가능' },
    );
  }
  if (stuff < 55 && control >= 60) {
    styleHints.push(
      { type: 'neutral', text: '구위보다 컨트롤로 승부하는 기교파 타입' },
      { type: 'neutral', text: '삼진보다 타구 관리로 이닝을 먹는 스타일' },
    );
  }
  if (stuff < 50 && control < 50) {
    styleHints.push(
      { type: 'negative', text: '구위와 제구 모두 평범 — 차별화 포인트 부재' },
      { type: 'negative', text: '뚜렷한 강점이 보이지 않아 리스크가 큰 선택' },
    );
  }
  if (styleHints.length > 0) {
    hints.push(pick(styleHints));
  }

  // ── KBO 적합도 연계 ──
  if (kboFit >= 70) {
    hints.push({ type: 'positive', text: pick([
      'KBO 리그 스타일과의 궁합 양호',
      'KBO 타자 스타일에 유리한 구종 조합 보유',
      '스카우팅 분석상 KBO 환경 최적화 가능성 높음',
      '리그 궁합 우수 — 즉시 전력감으로 평가됨',
      '한국 야구 환경에 잘 맞는 투구 패턴',
      'KBO 타선 약점을 공략할 수 있는 구종 보유',
    ])});
  } else if (kboFit < 40) {
    hints.push({ type: 'negative', text: pick([
      'KBO 타자 상대 유효 무기가 불분명',
      '리그 궁합 불투명 — 뚜껑 열어봐야 알 수 있는 케이스',
      'KBO 스타일에 맞지 않는 투구 패턴, 조정 필요',
      '타자 우위의 KBO 환경에서 고전할 수 있음',
      'KBO 공인구와의 궁합이 미지수',
      '한국 타자들의 선구안에 고전할 가능성',
    ])});
  }

  // 최대 3개만 선택 (다양한 카테고리에서 골고루)
  // 셔플 후 3개 pick — 매번 다른 조합
  for (let i = hints.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [hints[i], hints[j]] = [hints[j], hints[i]];
  }
  return hints.slice(0, 3);
}
