/**
 * simUtils.js — 시뮬레이터 공통 유틸 & 상수
 *
 * PitchSimulator / BattingSimulator 양쪽에서 공유하는
 * 수학 함수, 존 상수, Yerkes-Dodson 모델을 한 곳에 모아 둡니다.
 */

// ── 수학 유틸 ──────────────────────────────────────────────────────

export function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
export function rand(min, max)     { return Math.random() * (max - min) + min; }
export function lerp(a, b, t)      { return a + (b - a) * t; }

export function gaussRandom(mean = 0, stddev = 1) {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  return mean + stddev * u * mul;
}

/** 20-80 스케일 → 0-1 정규화 */
export function norm(rating) { return clamp((rating - 20) / 60, 0, 1); }

export function weightedPick(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// ── 존 경계 상수 ──────────────────────────────────────────────────

export const ZONE_X = 1.0;   // 홈플레이트 반폭
export const ZONE_Y = 1.35;  // 스트라이크존 반높이
export const BALL_R = 0.17;  // 공 반경 (판정 오차 여유)

// ── Yerkes-Dodson 법칙 (§2-4) ────────────────────────────────────
//
//   tension  0 ~ 19  : 지나친 이완 → 실수 증가 (집중력 부족)
//   tension 20 ~ 65  : 최적 각성 구간 → mistakeMod = 0
//   tension 66 ~ 100 : 지나친 긴장 → 실수 증가
//
// 모든 플레이(투구 퀄리티, 제구, 커맨드, 스윙 판단, 컨택, 타구 등)에
// getYerkesFactor() 또는 getYerkesMistakeMod()를 적용해야 합니다.

/**
 * 긴장도 → 실수 가중치 (0 = 최적, 0.12 = 최악)
 * 영향을 너무 빈번하게 주지 않도록 최대치 축소
 */
export function getYerkesMistakeMod(tension) {
  if (tension < 20)  return (20 - tension)  / 20 * 0.12;
  if (tension > 65)  return (tension - 65)  / 35 * 0.12;
  return 0;
}

/**
 * 긴장도 → 효율 팩터 (1.0 = 최적, 0.88 = 최악)
 */
export function getYerkesFactor(tension) {
  return 1.0 - getYerkesMistakeMod(tension);
}

/**
 * 긴장도 → 오차 팩터 (0 = 최적, +α = 오차 증폭)
 */
export function getYerkesErrorMod(tension) {
  return getYerkesMistakeMod(tension) * 0.4;  // 0 ~ 0.05 추가 오차
}

// ── 구종 분류 ─────────────────────────────────────────────────────

export const FASTBALL_TYPES = new Set(['4seam', '2seam', 'sinker', 'cutter']);
export const BREAKING_TYPES = new Set(['slider', 'curve', 'changeup', 'fork', 'knuckle']);

export const PITCH_TYPE_LABELS = {
  '4seam':    '포심',
  '2seam':    '투심',
  'sinker':   '싱커',
  'cutter':   '커터',
  'slider':   '슬라이더',
  'curve':    '커브',
  'changeup': '체인지업',
  'fork':     '포크',
  'knuckle':  '너클',
};

export const BATTED_BALL_LABELS = {
  'take':       '노스윙',
  'whiff':      '헛스윙',
  'foul':       '파울',
  'foul_back':  '뒤파울',
  'grounder':   '땅볼',
  'line_drive': '직선타',
  'fly_ball':   '뜬공',
  'deep_fly':   '깊은뜬공',
  'popup':      '팝업',
  'home_run':   '홈런',
};
