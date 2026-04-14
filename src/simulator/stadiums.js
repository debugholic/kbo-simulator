/**
 * stadiums.js — KBO 구장 외야 담장 데이터
 *
 * direction: 타구 방향 (degrees)
 *   42  = 우측 파울 라인
 *   90  = 중앙 (센터)
 *   138 = 좌측 파울 라인
 *
 * walls: [[direction, distance_meters], ...] — 각도별 담장 거리
 * 각도 사이 값은 선형 보간으로 계산
 */

export const STADIUMS = {
  jamsil: {
    name: '잠실야구장',
    // 실제 잠실 구장 치수 기반
    // 우익선: 99m, 우중간: 116m, 중앙: 125m, 좌중간: 116m, 좌익선: 99m
    walls: [
      [42,  99],
      [58,  109],
      [70,  116],
      [80,  122],
      [90,  125],
      [100, 122],
      [110, 116],
      [122, 109],
      [138,  99],
    ],
  },
};

/**
 * 주어진 구장의 특정 방향 담장 거리를 반환 (선형 보간).
 * @param {string} stadiumKey  — STADIUMS 키 (e.g. 'jamsil')
 * @param {number} direction   — 타구 방향 (degrees, 42~138)
 * @returns {number}           — 담장 거리 (meters)
 */
export function getWallDistance(stadiumKey, direction) {
  const stadium = STADIUMS[stadiumKey] ?? STADIUMS.jamsil;
  const walls = stadium.walls;

  // 범위 클램프
  const d = Math.max(walls[0][0], Math.min(walls[walls.length - 1][0], direction));

  // 앞뒤 포인트 찾기
  for (let i = 0; i < walls.length - 1; i++) {
    const [d0, w0] = walls[i];
    const [d1, w1] = walls[i + 1];
    if (d >= d0 && d <= d1) {
      const t = (d - d0) / (d1 - d0);
      return Math.round(w0 + t * (w1 - w0));
    }
  }

  return walls[walls.length - 1][1];
}
