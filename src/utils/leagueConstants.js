/**
 * leagueConstants.js
 * 리그 수준 관련 상수 단일 관리 파일
 *
 * 리그 수준 순서 (투수 관점):
 *   MLB >> AAA >= NPB > CPBL > NPB_FARM > ABL
 *
 * 이 파일을 수정하면 pitcherEval.js / foreignPlayerGen.js 양쪽에 반영됩니다.
 */

// ── 리그 수준 변환 (z-score 오프셋) ─────────────────────────────
// KBO 기준: 해당 리그 평균 투수가 KBO에서 z-score 몇에 해당하는지
// 양수 = KBO보다 강한 리그 / 음수 = KBO보다 약한 리그
//
// 환경 보정 주의:
//   AAA  — 타고투저 → ERA/BB 부풀려짐 → 투수에게 후한 오프셋
//   NPB  — 투고타저 → ERA/WHIP 좋게 나옴 → ERA 계열(command/control) 음수 보정
//   CPBL — NPB보다 약함, 환경은 중립에 가까움
export const LEAGUE_Z_OFFSETS = {
  KBO:      { stuff:  0.0, command:  0.0, control:  0.0,  holding:  0.0,  stamina:  0.0  },
  MLB:      { stuff:  1.5, command:  1.0, control:  0.8,  holding:  0.5,  stamina:  0.5  },
  AAA:      { stuff:  1.3, command:  1.3, control:  1.3,  holding:  0.5,  stamina:  0.5  },
  NPB:      { stuff:  0.2, command: -0.1, control: -0.1,  holding:  0.0,  stamina:  0.0  },
  CPBL:     { stuff:  0.0, command: -0.2, control: -0.2,  holding: -0.1,  stamina: -0.1  },
  NPB_FARM: { stuff: -0.2, command: -0.25,control: -0.2,  holding: -0.1,  stamina: -0.1  },
  ABL:      { stuff: -0.3, command: -0.35,control: -0.3,  holding: -0.15, stamina: -0.15 },
};

export const SUPPORTED_LEAGUES = Object.keys(LEAGUE_Z_OFFSETS);

// ── 리그별 카테고리 점수 하한선 (floor) ─────────────────────────
// 외국 리그 선수는 KBO에 데려온 이유가 있으므로 극단적 저평가 방지
export const LEAGUE_SCORE_FLOOR = {
  KBO:      20,
  MLB:      50,
  AAA:      48,
  NPB:      48,
  CPBL:     32,
  NPB_FARM: 28,
  ABL:      22,
};

// ── 랜덤 생성 능력치 범위 (foreignPlayerGen 용) ──────────────────
// stuff / command / control 기대값 범위 [min, max]
export const LEAGUE_BASE = {
  MLB:      { stuff: [58, 78], command: [53, 74], control: [53, 72] },
  AAA:      { stuff: [48, 72], command: [45, 68], control: [45, 66] },
  NPB:      { stuff: [45, 70], command: [45, 68], control: [45, 66] },
  CPBL:     { stuff: [42, 65], command: [42, 63], control: [42, 61] },
  NPB_FARM: { stuff: [41, 63], command: [41, 61], control: [41, 59] }, // CPBL~ABL 사이
  ABL:      { stuff: [38, 60], command: [38, 58], control: [38, 56] },
};

// ── 리그별 S급 출현 확률 ─────────────────────────────────────────
// A급(7.5%) / B급(15%)은 모든 리그 동일, S급만 차등
export const ELITE_S_PROB = {
  MLB:      0.025,
  AAA:      0.020,
  NPB:      0.015,
  CPBL:     0.010,
  NPB_FARM: 0.008,
  ABL:      0.005,
};

// ── 외국 스탯 참고 비중 (pitcherEval 용) ────────────────────────
// KBO 기록 없는 외국인 선수 평가 시 나머지는 리그 범위 내 랜덤
export const STAT_ANCHOR_WEIGHT = {
  MLB:      0.40,
  AAA:      0.25,
  NPB:      0.30,
  CPBL:     0.25,
  NPB_FARM: 0.20,
  ABL:      0.20,
};

// ── 구종별 리그 평균 구속 범위 (km/h) ────────────────────────────
export const PITCH_VELO = {
  '4seam':  { MLB: [149,165], AAA: [144,158], NPB: [142,155], CPBL: [140,153], NPB_FARM: [139,152], ABL: [138,151] },
  '2seam':  { MLB: [146,161], AAA: [141,155], NPB: [139,152], CPBL: [137,150], NPB_FARM: [136,149], ABL: [135,148] },
  sinker:   { MLB: [146,161], AAA: [141,154], NPB: [139,151], CPBL: [137,149], NPB_FARM: [136,148], ABL: [135,147] },
  cutter:   { MLB: [140,152], AAA: [136,149], NPB: [135,147], CPBL: [133,145], NPB_FARM: [132,144], ABL: [131,143] },
  slider:   { MLB: [134,149], AAA: [130,145], NPB: [129,143], CPBL: [127,141], NPB_FARM: [126,140], ABL: [125,139] },
  changeup: { MLB: [133,147], AAA: [129,143], NPB: [128,141], CPBL: [126,139], NPB_FARM: [125,138], ABL: [124,137] },
  curve:    { MLB: [121,138], AAA: [117,134], NPB: [116,133], CPBL: [114,131], NPB_FARM: [113,130], ABL: [112,129] },
  fork:     { MLB: [131,145], AAA: [128,141], NPB: [127,140], CPBL: [125,138], NPB_FARM: [124,137], ABL: [123,136] },
};
