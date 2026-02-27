// 능력치 등급 계산 (타자/투수 구분)
export function getGrade(value) {
  if (!value) return { label: '-', color: '#555570' };
  if (value >= 80) return { label: 'S', color: '#FFD700' };
  if (value >= 73) return { label: 'A', color: '#4CAF50' };
  if (value >= 66) return { label: 'B', color: '#2196F3' };
  if (value >= 58) return { label: 'C', color: '#9E9E9E' };
  if (value >= 50) return { label: 'D', color: '#795548' };
  return { label: 'E', color: '#F44336' };
}

// 포지션 그룹 분류
export function getPositionGroup(position) {
  if (['SP', 'RP', 'CP', 'SP/RP'].includes(position)) return 'pitcher';
  return 'batter';
}

// 포지션 한국어
export const POSITION_KOR = {
  SP: '선발', RP: '불펜', CP: '마감', 'SP/RP': '선발/불펜',
  C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격',
  LF: '좌익', CF: '중견', RF: '우익', OF: '외야', IF: '내야',
};

// 타자 종합 능력치 계산
export function getBatterOverall(p) {
  const stats = [p.contact, p.discipline, p.power, p.speed, p.eye];
  const valid = stats.filter(s => s != null);
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// 투수 종합 능력치 계산
export function getPitcherOverall(p) {
  const stats = [p.control, p.stuff, p.stamina, p.command];
  const valid = stats.filter(s => s != null);
  if (!valid.length) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

export function getOverall(player) {
  const isPitcher = getPositionGroup(player.position) === 'pitcher';
  return isPitcher ? getPitcherOverall(player) : getBatterOverall(player);
}

// 능력치 바 색상
export function getBarColor(value) {
  if (!value) return '#333350';
  if (value >= 73) return '#4CAF50';
  if (value >= 58) return '#2196F3';
  if (value >= 50) return '#9E9E9E';
  return '#F44336';
}

// 포지션 필터 그룹
export const POSITION_GROUPS = {
  ALL: '전체',
  SP: '선발',
  RP: '불펜/마감',
  C: '포수',
  IF: '내야',
  OF: '외야',
};

export function matchPositionGroup(player, group) {
  if (group === 'ALL') return true;
  if (group === 'SP') return ['SP', 'SP/RP'].includes(player.position);
  if (group === 'RP') return ['RP', 'CP'].includes(player.position);
  if (group === 'C') return player.position === 'C';
  if (group === 'IF') return ['1B', '2B', '3B', 'SS', 'IF'].includes(player.position);
  if (group === 'OF') return ['LF', 'CF', 'RF', 'OF'].includes(player.position);
  return true;
}
