import React, { useState, useMemo } from 'react';
import { getOverall, getGrade, getBarColor, POSITION_KOR } from '../utils';
import styles from './TradeDemo.module.css';

const EVAL_LABELS = [
  { key: 'stuff',   label: '구위' },
  { key: 'command', label: '제구' },
  { key: 'control', label: '컨트롤' },
  { key: 'holding', label: '주자억제' },
  { key: 'stamina', label: '체력' },
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

function PlayerCard({ player, attrOpinions, color }) {
  const ovr = getOverall(player);
  const grade = getGrade(ovr);
  const eval5 = player.pitcherEval;
  const { strength, weakness } = useMemo(
    () => getAttrHighlight(player, attrOpinions),
    [player, attrOpinions]
  );

  return (
    <div className={styles.playerCard} style={{ borderTopColor: color }}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardName}>{player.name_kor}</div>
          <div className={styles.cardSub}>
            {player.name_eng && <span>{player.name_eng} · </span>}
            {POSITION_KOR[player.position] || player.position}
          </div>
        </div>
        {ovr && (
          <div className={styles.ovrBadge} style={{ background: grade.background, color: grade.textColor }}>
            <span className={styles.ovrGrade}>{grade.label}</span>
            <span className={styles.ovrVal}>{ovr}</span>
          </div>
        )}
      </div>

      {eval5 && (
        <div className={styles.bars}>
          {EVAL_LABELS.map(({ key, label }) =>
            eval5[key] != null ? (
              <div key={key} className={styles.barRow}>
                <span className={styles.barLabel}>{label}</span>
                <div className={styles.barTrack}>
                  <div
                    className={styles.barFill}
                    style={{
                      width: `${Math.max(0, ((eval5[key] - 20) / 60) * 100)}%`,
                      background: getBarColor(eval5[key]),
                    }}
                  />
                </div>
                <span className={styles.barVal}>{eval5[key]}</span>
              </div>
            ) : null
          )}
        </div>
      )}

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

function TeamPanel({ title, color, players, selected, onSelect }) {
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
          const isSelected = selected?.id === p.id;
          return (
            <div
              key={p.id}
              className={`${styles.playerRow} ${isSelected ? styles.selectedRow : ''}`}
              style={isSelected ? { borderLeftColor: color, background: color + '11' } : {}}
              onClick={() => onSelect(isSelected ? null : p)}
            >
              <div className={styles.rowLeft}>
                <span className={styles.rowName}>{p.name_kor}</span>
                <span className={styles.rowPos}>{POSITION_KOR[p.position] || p.position}</span>
              </div>
              {ovr && (
                <span className={styles.rowOvr} style={isSelected ? { color } : {}}>
                  {ovr}
                </span>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className={styles.empty}>검색 결과 없음</div>
        )}
      </div>
    </div>
  );
}

export default function TradeDemo({ onClose, players, teams, attrOpinions = [] }) {
  const [myPlayer, setMyPlayer] = useState(null);
  const [theirPlayer, setTheirPlayer] = useState(null);

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

  const canPropose = myPlayer && theirPlayer;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <div className={styles.modalHeader}>
          <span className={styles.title}>트레이드 스카우팅</span>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.content}>
          {/* 한화 패널 */}
          <div className={styles.side}>
            <TeamPanel
              title={hanwhaTeam?.name_kor || '한화 이글스'}
              color={hanwhaColor}
              players={hanwhaPlayers}
              selected={myPlayer}
              onSelect={setMyPlayer}
            />
            {myPlayer && (
              <PlayerCard
                player={myPlayer}
                attrOpinions={attrOpinions}
                color={hanwhaColor}
              />
            )}
            {!myPlayer && (
              <div className={styles.placeholder}>
                <span>선수를 선택하세요</span>
              </div>
            )}
          </div>

          {/* 중앙 */}
          <div className={styles.center}>
            <div className={styles.arrowWrap}>
              <div className={styles.arrow}>⇄</div>
              {canPropose && (
                <div className={styles.vsLabel}>
                  <span style={{ color: hanwhaColor }}>{myPlayer.name_kor}</span>
                  <span className={styles.vsText}> vs </span>
                  <span style={{ color: lotteColor }}>{theirPlayer.name_kor}</span>
                </div>
              )}
            </div>
          </div>

          {/* 롯데 패널 */}
          <div className={styles.side}>
            <TeamPanel
              title={lotteTeam?.name_kor || '롯데 자이언츠'}
              color={lotteColor}
              players={lottePlayers}
              selected={theirPlayer}
              onSelect={setTheirPlayer}
            />
            {theirPlayer && (
              <PlayerCard
                player={theirPlayer}
                attrOpinions={attrOpinions}
                color={lotteColor}
              />
            )}
            {!theirPlayer && (
              <div className={styles.placeholder}>
                <span>선수를 선택하세요</span>
              </div>
            )}
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
