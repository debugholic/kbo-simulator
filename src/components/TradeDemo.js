import React, { useState, useMemo } from 'react';
import { getOverall, getGrade, POSITION_KOR, getPositionGroup } from '../utils';
import { AbilityVisibilityCard } from './AbilityVisibilityCard';
import styles from './TradeDemo.module.css';

const EVAL_STAT_DEFS = [
  { key: 'stuff',   label: '구위',    color: '#4CAF50' },
  { key: 'command', label: '커맨드',  color: '#2196F3' },
  { key: 'control', label: '컨트롤',  color: '#26A69A' },
  { key: 'holding', label: '주자억제', color: '#9C27B0' },
  { key: 'stamina', label: '체력',    color: '#FF9800' },
];

function pickAttrDesc(opinions, attribute, value) {
  const matches = opinions.filter(
    o => o.attribute === attribute && value >= o.range_min && value <= o.range_max
  );
  if (!matches.length) return null;
  return matches[Math.floor(Math.random() * matches.length)].description;
}

function getAttrHighlight(player, opinions) {
  const attrs = player.attributes;
  if (!attrs) return { strength: null, weakness: null };
  let bestKey = null, bestVal = 55;
  let worstKey = null, worstVal = 46;
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null && value > bestVal) { bestVal = value; bestKey = key; }
    if (value != null && value < worstVal) { worstVal = value; worstKey = key; }
  }
  return {
    strength: bestKey ? pickAttrDesc(opinions, bestKey, bestVal) : null,
    weakness: worstKey ? pickAttrDesc(opinions, worstKey, worstVal) : null,
  };
}

// ── 가시성 캘리브레이션 ──
// 투수: 200 IP → 100%  (floor 30%)
// 타자: 763 PA → 100%, 600 PA ≈ 85%  (floor 30%)
const MAX_IP   = 200;
const MAX_PA   = 763;
const FLOOR    = 0.30;
const HALF_PA  = 600;

// 포지션별 시즌 절반 기대 이닝
const HALF_IP_BY_POS = { SP: 80, RP: 35, CP: 35, 'SP/RP': 55, P: 50 };

// 선수 유형별 불확실 범위 폭
function getPriorWidth(src) {
  if (src === 'ROOKIE') return 20;
  if (['AAA', 'MLB', 'NPB', 'NPB_FARM'].includes(src)) return 14;
  return 6; // KBO
}

// confidence = FLOOR + (1 - FLOOR) * min(totalAcc / maxAcc, 1)
function calcConfidence(totalAcc, maxAcc) {
  return Math.min(FLOOR + (1 - FLOOR) * (totalAcc / maxAcc), 1);
}

/**
 * 자팀 선수 가시성: 실제 IP/PA 기반, floor 30%
 */
function getMyVisibility(player) {
  const isPitcher = getPositionGroup(player.position) === 'pitcher';
  const src = player.pitcherEval?.sourceLeague || 'KBO';
  const priorWidth = getPriorWidth(src);

  if (isPitcher) {
    const historicalIP = (player.allSeasonStats || [])
      .slice(1)
      .reduce((sum, s) => sum + (parseFloat(s.ip) || 0), 0);
    const halfExpected = HALF_IP_BY_POS[player.position] || 50;
    const currentIP   = Math.max(parseFloat(player.seasonStats?.ip) || 0, halfExpected);
    const totalIP     = historicalIP + currentIP;
    const confidence  = calcConfidence(totalIP, MAX_IP);
    return { confidence, halfWidth: Math.round(priorWidth * (1 - confidence)) };
  } else {
    const confidence = calcConfidence(HALF_PA, MAX_PA); // ≈ 85%
    return { confidence, halfWidth: Math.round(priorWidth * (1 - confidence)) };
  }
}

// 상대 선수 스카우팅 신뢰도
const SCOUT_CONF_DEFAULT    = 0.15; // 기본: 경기 관찰만
const SCOUT_CONF_BASIC      = 0.30; // KBO 기록 없음 최대
const SCOUT_CONF_DETAIL_KBO = 0.70; // KBO 기록 있음 최대
const PRIOR_MEAN = 50;

// ── 데모 전용: 시즌 진행도 기반 현재 시즌 KBO 소화 이닝/타석 생성 ──
const DEMO_SEASON_PROGRESS = 0.67; // seasonPct = 67과 동기화
const DEMO_FULL_IP = { SP: 170, RP: 60, CP: 55, 'SP/RP': 100, P: 70 };
const DEMO_FULL_PA = 500;

// 기록이 전혀 없는 선수(미데뷔)는 0, 나머지는 진행도 비례 이닝 반환
function getDemoCurrentIP(player) {
  const hasStats = player.seasonStats || (player.allSeasonStats || []).length > 0;
  if (!hasStats) return 0;
  return Math.round((DEMO_FULL_IP[player.position] ?? 60) * DEMO_SEASON_PROGRESS);
}
function getDemoCurrentPA(player) {
  const hasStats = player.seasonStats || (player.allSeasonStats || []).length > 0;
  if (!hasStats) return 0;
  return Math.round(DEMO_FULL_PA * DEMO_SEASON_PROGRESS);
}

/**
 * 상대 선수 스카우팅 최대 신뢰도
 * - 역대 KBO 이닝 + 데모 현재 시즌 KBO 이닝 합산, 상한 70%
 */
function getTheirMaxConf(player) {
  const isPitcher = getPositionGroup(player.position) === 'pitcher';

  if (isPitcher) {
    const historicalIP = (player.allSeasonStats || [])
      .reduce((sum, s) => sum + (parseFloat(s.ip) || 0), 0);
    const demoIP = getDemoCurrentIP(player);
    return Math.min(SCOUT_CONF_DETAIL_KBO, calcConfidence(historicalIP + demoIP, MAX_IP));
  } else {
    const historicalPA = (player.allSeasonStats || [])
      .reduce((sum, s) => sum + (parseInt(s.pa) || 0), 0);
    const demoPA = getDemoCurrentPA(player);
    return Math.min(SCOUT_CONF_DETAIL_KBO, calcConfidence(historicalPA + demoPA, MAX_PA));
  }
}

function buildScoutStats(eval5, src, conf) {
  if (!eval5) return [];
  const priorWidth = getPriorWidth(src);
  const half = Math.round(priorWidth * (1 - conf));
  return EVAL_STAT_DEFS
    .filter(d => eval5[d.key] != null)
    .map(d => {
      const center = Math.round(PRIOR_MEAN + (eval5[d.key] - PRIOR_MEAN) * conf);
      return { label: d.label, color: d.color, center, low: center - half, high: center + half };
    });
}

/* ── 내 선수 카드 — 능력치 가시성 모듈 ── */
function MyPlayerCard({ player, attrOpinions, color, onRemove }) {
  const ovr   = getOverall(player);
  const grade = getGrade(ovr);
  const eval5 = player.pitcherEval;
  const { strength, weakness } = useMemo(
    () => getAttrHighlight(player, attrOpinions),
    [player, attrOpinions]
  );
  const { confidence, halfWidth } = getMyVisibility(player);

  const stats = eval5
    ? EVAL_STAT_DEFS
        .filter(d => eval5[d.key] != null)
        .map(d => ({
          label: d.label, color: d.color,
          center: eval5[d.key],
          low:    eval5[d.key] - halfWidth,
          high:   eval5[d.key] + halfWidth,
        }))
    : [];

  const headerRight = (
    <div className={styles.cardHeaderRight}>
      {ovr && (
        <div className={styles.ovrBadge} style={{ background: grade.background, color: grade.textColor }}>
          <span className={styles.ovrGrade}>{grade.label}</span>
          <span className={styles.ovrVal}>{ovr}</span>
        </div>
      )}
      <button className={styles.removeBtn} onClick={onRemove}>✕</button>
    </div>
  );

  return (
    <div className={styles.playerCard} style={{ borderTopColor: color }}>
      <AbilityVisibilityCard
        name={player.name_kor}
        nameSub={player.name_eng || undefined}
        nameExtra={<PotentialStars playerId={player.id} potential={player.defaultPotential} confidence={confidence} />}
        position={POSITION_KOR[player.position] || player.position}
        headerRight={headerRight}
        confidence={confidence}
        stats={stats}
      />
      {(strength || weakness) && (
        <div className={styles.attrHints}>
          {strength && (
            <div className={styles.attrStrength}>
              <span className={styles.attrIcon}>✓</span>
              <span>{strength}</span>
            </div>
          )}
          {weakness && (
            <div className={styles.attrWeakness}>
              <span className={styles.attrIcon}>!</span>
              <span>{weakness}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 외국인 선수 name_eng: DB가 "Last First" 순 저장 → "First Last" 변환
function fmtEngName(name) {
  if (!name) return name;
  const parts = name.trim().split(/\s+/);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : name;
}

// player.id 기반 시드 난수 — 렌더마다 같은 값 보장
function seededRand(seed) {
  let s = (parseInt(seed) || 0) ^ 0xdeadbeef;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 0x100000000;
  };
}

// 신뢰도 → 노이즈 레벨
function confToNoise(conf) {
  if (conf >= 1.0) return 1;
  if (conf >= 0.7) return 2;
  if (conf >= 0.3) return 3;
  return 4;
}

// 신뢰도 기반 포텐셜 추정 중간값 (M)
function potentialMid(playerId, actual, confidence) {
  if (!actual) return null;
  const r    = seededRand(playerId);
  const noise = confToNoise(confidence);
  const below = Math.round(r() * noise);
  const above = Math.round(r() * noise);
  const lo = Math.max(1, actual - below);
  const hi = Math.min(10, actual + above);
  return (lo + hi) / 2;
}

// ★ 별점 표시 (5개, 금색)
function PotentialStars({ playerId, potential, confidence = 0 }) {
  if (!potential) return null;
  const mid = potentialMid(playerId, potential, confidence);
  if (mid == null) return null;

  const fullCount = Math.floor(mid / 2);
  const mod = parseFloat((mid % 2).toFixed(1)); // 0, 0.5, 1.0, 1.5

  const HalfStar = ({ faded }) => (
    <span style={{ position: 'relative', display: 'inline-block', fontSize: 12 }}>
      <span style={{ color: '#E8B820', opacity: 0.15 }}>★</span>
      <span style={{
        position: 'absolute', left: 0, top: 0,
        overflow: 'hidden', width: '50%',
        color: faded ? '#E8B82066' : '#E8B820',
      }}>★</span>
    </span>
  );

  return (
    <span className={styles.stars}>
      {Array.from({ length: fullCount }, (_, i) => (
        <span key={i} className={styles.starFull}>★</span>
      ))}
      {mod === 0.5 && <HalfStar faded />}
      {mod === 1.0 && <HalfStar />}
      {mod === 1.5 && <span className={styles.starFaded}>★</span>}
    </span>
  );
}

/* ── 상대 선수 카드 — 스카우팅 모듈 ── */
function TheirPlayerCard({ player, attrOpinions, color, onRemove, scoutConf, onScout }) {
  const eval5   = player.pitcherEval;
  const src     = eval5?.sourceLeague || 'KBO';
  const conf    = scoutConf;
  const maxConf = getTheirMaxConf(player);
  // 역대 KBO 기록 OR 데모 현재 시즌 KBO 이닝 > 0 이면 기록 있음
  const hasKBORecord =
    (player.allSeasonStats || []).some(s => (s.source_league || 'KBO') === 'KBO') ||
    getDemoCurrentIP(player) > 0;

  const { strength, weakness } = useMemo(
    () => getAttrHighlight(player, attrOpinions),
    [player, attrOpinions]
  );

  const stats = buildScoutStats(eval5, src, conf);

  const headerRight = (
    <div className={styles.cardHeaderRight}>
      {!hasKBORecord && (
        <span className={styles.rookieBadge}>KBO 기록 없음</span>
      )}
      <button className={styles.removeBtn} onClick={onRemove}>✕</button>
    </div>
  );

  return (
    <div className={`${styles.playerCard} ${styles.scoutCard}`} style={{ borderTopColor: color }}>
      <AbilityVisibilityCard
        name={player.name_kor}
        nameSub={player.name_eng || undefined}
        nameExtra={<PotentialStars playerId={player.id} potential={player.defaultPotential} confidence={conf} />}
        position={POSITION_KOR[player.position] || player.position}
        headerRight={headerRight}
        confidence={conf}
        stats={stats}
      />

      {/* 스카우팅 보고서 요청 버튼 — 현재 신뢰도가 최대치 미만일 때 표시 */}
      {conf < maxConf && (
        <button className={styles.scoutRequestBtn} onClick={() => onScout(maxConf)}>
          스카우팅 보고서 요청
          <span style={{ marginLeft: 4, opacity: 0.6, fontWeight: 400 }}>
            ({Math.round(maxConf * 100)}%)
          </span>
        </button>
      )}

      {/* 특성 힌트: 기본 스카우팅 이상이면 표시 */}
      {conf >= SCOUT_CONF_BASIC && (strength || weakness) && (
        <div className={styles.attrHints}>
          {strength && (
            <div className={styles.attrStrength}>
              <span className={styles.attrIcon}>✓</span>
              <span>{strength}</span>
            </div>
          )}
          {weakness && (
            <div className={styles.attrWeakness}>
              <span className={styles.attrIcon}>!</span>
              <span>{weakness}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TeamPanel({ title, color, players, selectedIds, onToggle }) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() =>
    players.filter(p =>
      p.name_kor.includes(search) ||
      (p.name_eng || '').toLowerCase().includes(search.toLowerCase())
    ),
    [players, search]
  );

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div className={styles.teamDot} style={{ background: color }} />
        <span className={styles.teamName} style={{ color }}>{title}</span>
        {selectedIds.length > 0 && (
          <span className={styles.selectedCount} style={{ background: color + '22', color }}>
            {selectedIds.length}명
          </span>
        )}
      </div>
      <div className={styles.searchWrap}>
        <input
          className={styles.search}
          placeholder="선수 검색..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className={styles.playerList}>
        {filtered.map(p => {
          const ovr = getOverall(p);
          const isSelected = selectedIds.includes(p.id);
          return (
            <div
              key={p.id}
              className={`${styles.playerRow} ${isSelected ? styles.selectedRow : ''}`}
              style={isSelected ? { borderLeftColor: color, background: color + '11' } : {}}
              onClick={() => onToggle(p)}
            >
              <div className={styles.rowLeft}>
                <span
                  className={`${styles.checkbox} ${isSelected ? styles.checkboxChecked : ''}`}
                  style={isSelected ? { background: color, borderColor: color } : {}}
                >
                  {isSelected && '✓'}
                </span>
                <span className={styles.rowName}>{p.name_kor}</span>
                <span className={styles.rowPos}>{POSITION_KOR[p.position] || p.position}</span>
              </div>
              {ovr && (
                <span className={styles.rowOvr} style={isSelected ? { color } : {}}>{ovr}</span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className={styles.empty}>검색 결과 없음</div>}
      </div>
    </div>
  );
}

export default function TradeDemo({ onClose, players, teams, attrOpinions = [] }) {
  const [myPlayerIds,    setMyPlayerIds]    = useState([]);
  const [theirPlayerIds, setTheirPlayerIds] = useState([]);
  const [scoutLevels, setScoutLevels] = useState(new Map());

  // 데모용 고정 시즌 진행도
  const seasonYear = 2025;
  const seasonPct  = 67;

  const hanwhaTeam = useMemo(() => teams.find(t => t.name_kor?.includes('한화')), [teams]);
  const lotteTeam  = useMemo(() => teams.find(t => t.name_kor?.includes('롯데')), [teams]);

  const hanwhaPlayers = useMemo(() =>
    players.filter(p => p.team_id === hanwhaTeam?.id)
      .sort((a, b) => (getOverall(b) || 0) - (getOverall(a) || 0)),
    [players, hanwhaTeam]
  );
  const lottePlayers = useMemo(() =>
    players.filter(p => p.team_id === lotteTeam?.id)
      .sort((a, b) => (getOverall(b) || 0) - (getOverall(a) || 0)),
    [players, lotteTeam]
  );

  const hanwhaColor = hanwhaTeam?.color || '#FF6B00';
  const lotteColor  = lotteTeam?.color  || '#002060';

  const mySelectedPlayers    = useMemo(() => hanwhaPlayers.filter(p => myPlayerIds.includes(p.id)),    [hanwhaPlayers, myPlayerIds]);
  const theirSelectedPlayers = useMemo(() => lottePlayers.filter(p => theirPlayerIds.includes(p.id)), [lottePlayers, theirPlayerIds]);

  const toggleMyPlayer    = p => setMyPlayerIds(ids    => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id]);
  const toggleTheirPlayer = p => setTheirPlayerIds(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id]);
  const setScoutLevel = (p, level) => setScoutLevels(m => new Map([...m, [p.id, level]]));

  const canPropose = myPlayerIds.length > 0 && theirPlayerIds.length > 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <div className={styles.modalHeader}>
          <span className={styles.title}>트레이드</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {seasonYear && (
          <div className={styles.seasonBar}>
            <span className={styles.seasonLabel}>{seasonYear} 정규시즌</span>
            <div className={styles.seasonTrack}>
              <div className={styles.seasonFill} style={{ width: `${seasonPct}%` }} />
            </div>
            <span className={styles.seasonPct}>{seasonPct}%</span>
          </div>
        )}

        <div className={styles.content}>
          {/* 한화 패널 */}
          <div className={styles.side}>
            <TeamPanel
              title={hanwhaTeam?.name_kor || '한화 이글스'}
              color={hanwhaColor}
              players={hanwhaPlayers}
              selectedIds={myPlayerIds}
              onToggle={toggleMyPlayer}
            />
            <div className={styles.cardList}>
              {mySelectedPlayers.map(p => (
                <MyPlayerCard key={p.id} player={p} attrOpinions={attrOpinions} color={hanwhaColor} onRemove={() => toggleMyPlayer(p)} />
              ))}
              {mySelectedPlayers.length === 0 && <div className={styles.placeholder}><span>선수를 선택하세요</span></div>}
            </div>
          </div>

          {/* 중앙 */}
          <div className={styles.center}>
            <div className={styles.arrowWrap}>
              <div className={styles.vsTeamCount} style={{ color: myPlayerIds.length > 0 ? hanwhaColor : 'var(--text2)', background: myPlayerIds.length > 0 ? hanwhaColor + '18' : 'transparent' }}>
                {myPlayerIds.length > 0 ? `${myPlayerIds.length}명` : '—'}
              </div>
              <div className={styles.arrow}>⇄</div>
              <div className={styles.vsTeamCount} style={{ color: theirPlayerIds.length > 0 ? lotteColor : 'var(--text2)', background: theirPlayerIds.length > 0 ? lotteColor + '18' : 'transparent' }}>
                {theirPlayerIds.length > 0 ? `${theirPlayerIds.length}명` : '—'}
              </div>
            </div>
          </div>

          {/* 롯데 패널 */}
          <div className={styles.side}>
            <TeamPanel
              title={lotteTeam?.name_kor || '롯데 자이언츠'}
              color={lotteColor}
              players={lottePlayers}
              selectedIds={theirPlayerIds}
              onToggle={toggleTheirPlayer}
            />
            <div className={styles.cardList}>
              {theirSelectedPlayers.map(p => (
                <TheirPlayerCard
                  key={p.id}
                  player={p}
                  attrOpinions={attrOpinions}
                  color={lotteColor}
                  onRemove={() => toggleTheirPlayer(p)}
                  scoutConf={scoutLevels.get(p.id) ?? SCOUT_CONF_DEFAULT}
                  onScout={(level) => setScoutLevel(p, level)}
                />
              ))}
              {theirSelectedPlayers.length === 0 && <div className={styles.placeholder}><span>선수를 선택하세요</span></div>}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <button
            className={styles.proposeBtn}
            disabled={!canPropose}
            style={canPropose ? { background: hanwhaColor } : {}}
          >
            트레이드 제안
          </button>
        </div>

      </div>
    </div>
  );
}
