// 능력치 등급 계산
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
  SP: '선발', RP: '불펜', CP: '마무리', 'SP/RP': '선발/불펜',
  C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격',
  LF: '좌익', CF: '중견', RF: '우익', OF: '외야', IF: '내야',
};

// 타자 종합 능력치 계산 (주력은 0.5 가중치 - 도루형 선수 OVR 과대평가 방지)
export function getBatterOverall(p) {
  const primary = [p.contact, p.discipline, p.power].filter(s => s != null);
  if (!primary.length) return null;
  const sum = primary.reduce((a, b) => a + b, 0) + (p.speed != null ? p.speed * 0.5 : 0);
  const denom = primary.length + (p.speed != null ? 0.5 : 0);
  return Math.round(sum / denom);
}

// 투수 종합 능력치 계산
// 체력(stamina)은 선발/마무리 IP 차이로 OVR 갭이 과도하게 벌어지므로 0.4 가중치로 낮춤
export function getPitcherOverall(p) {
  const primary = [p.control, p.stuff, p.command].filter(s => s != null);
  if (!primary.length) return null;
  const sum = primary.reduce((a, b) => a + b, 0) + (p.stamina != null ? p.stamina * 0.4 : 0);
  const denom = primary.length + (p.stamina != null ? 0.4 : 0);
  return Math.round(sum / denom);
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

// 팀 대표 색상 반환 (라이트 테마에서 원색 그대로 사용)
export function getTeamDisplayColor(team) {
  if (!team) return '#888888';
  return team.color;
}

// 포지션 필터 그룹 - 투수
export const PITCHER_POSITION_GROUPS = {
  ALL: '전체',
  SP: '선발',
  RP: '불펜/마무리',
};

// 포지션 필터 그룹 - 타자
export const BATTER_POSITION_GROUPS = {
  ALL: '전체',
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
