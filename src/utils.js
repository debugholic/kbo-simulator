// 능력치 등급 계산
export function getGrade(value) {
  if (!value) return { label: '-', color: '#555570' };
  if (value >= 73) return { label: 'S', color: '#FFD700' };
  if (value >= 66) return { label: 'A', color: '#4CAF50' };
  if (value >= 58) return { label: 'B', color: '#2196F3' };
  if (value >= 50) return { label: 'C', color: '#9E9E9E' };
  if (value >= 42) return { label: 'D', color: '#795548' };
  return { label: 'E', color: '#F44336' };
}

// 포지션 그룹 분류
export function getPositionGroup(position) {
  if (['P', 'SP', 'RP', 'CP', 'SP/RP'].includes(position)) return 'pitcher';
  return 'batter';
}

// 포지션 한국어
export const POSITION_KOR = {
  P: '투수', SP: '선발', RP: '불펜', CP: '마무리', 'SP/RP': '선발/불펜',
  C: '포수', '1B': '1루', '2B': '2루', '3B': '3루', SS: '유격',
  LF: '좌익', CF: '중견', RF: '우익', OF: '외야', IF: '내야',
};

// 종합 능력치 계산
// 투수: pitcherEval 5대 능력치 기반 (체력은 0.4 가중치)
// 타자: attributes 7개 평균 (추후 변경 예정)
export function getOverall(player) {
  const isPitcher = getPositionGroup(player.position) === 'pitcher';

  if (isPitcher && player.pitcherEval) {
    const e = player.pitcherEval;
    const core = [e.stuff, e.command, e.control].filter(v => v != null);
    if (!core.length) return null;
    let sum = core.reduce((a, b) => a + b, 0);
    let denom = core.length;
    if (e.holding != null) { sum += e.holding * 0.3; denom += 0.3; }
    if (e.stamina != null) { sum += e.stamina * 0.3; denom += 0.3; }
    return Math.round(sum / denom);
  }

  const attr = player.attributes;
  if (!attr) return null;
  const vals = [
    attr.competitiveness, attr.resilience, attr.focus,
    attr.adaptability, attr.work_ethic, attr.durability, attr.leadership,
  ].filter(v => v != null);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// 능력치 바 색상
export function getBarColor(value) {
  if (!value) return '#333350';
  if (value >= 70) return '#00C853'; // 선명한 초록
  if (value >= 60) return '#26A69A'; // 틸
  if (value >= 50) return '#3A8FCA'; // 블루
  if (value >= 40) return '#C49A50'; // 앰버
  return '#A0A0A0';                  // 회색
}

// 팀 대표 색상 반환
export function getTeamDisplayColor(team) {
  if (!team) return '#888888';
  return team.color;
}

// 포지션 필터 그룹 - 투수 (현재 DB는 'P'만 사용)
export const PITCHER_POSITION_GROUPS = {
  ALL: '전체',
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
  if (group === 'C') return player.position === 'C';
  if (group === 'IF') return ['1B', '2B', '3B', 'SS', 'IF'].includes(player.position);
  if (group === 'OF') return ['LF', 'CF', 'RF', 'OF'].includes(player.position);
  return true;
}

// 구종 한국어 이름
export const PITCH_TYPE_KOR = {
  '4seam': '포심',
  '2seam': '투심',
  cutter: '커터',
  curve: '커브',
  slider: '슬라이더',
  changeup: '체인지업',
  sinker: '싱커',
  fork: '포크',
  knuckle: '너클',
  other: '기타',
};

export const PITCH_TYPES = ['4seam', '2seam', 'cutter', 'curve', 'slider', 'changeup', 'sinker', 'fork', 'knuckle', 'other'];

// 투수 평가 능력치 컬럼 (테이블용)
export const PITCHER_EVAL_COLS = [
  { key: 'stuff',   label: '구위' },
  { key: 'command', label: '제구' },
  { key: 'control', label: '컨트롤' },
  { key: 'holding', label: '주자억제' },
  { key: 'stamina', label: '체력' },
];

// 특성(attributes) 정의
export const ATTRIBUTE_DEFS = [
  { key: 'competitiveness', label: '승부욕', desc: 'Competitiveness' },
  { key: 'resilience',      label: '회복력', desc: 'Resilience' },
  { key: 'focus',            label: '집중력', desc: 'Focus' },
  { key: 'adaptability',    label: '적응력', desc: 'Adaptability' },
  { key: 'work_ethic',      label: '성실함', desc: 'Work Ethic' },
  { key: 'durability',      label: '내구력', desc: 'Durability' },
  { key: 'leadership',      label: '리더십', desc: 'Leadership' },
];

// birthdate → 나이 계산
export function calcAge(birthdate) {
  if (!birthdate) return null;
  const birth = new Date(birthdate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
