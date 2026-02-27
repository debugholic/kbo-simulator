import React, { useEffect } from 'react';
import { getOverall, getGrade, getPositionGroup, POSITION_KOR, getBarColor, getTeamDisplayColor } from '../utils';
import styles from './PlayerModal.module.css';

const PITCHER_STATS = [
  { key: 'control', label: '제구력', desc: 'Control' },
  { key: 'stuff', label: '구위', desc: 'Stuff' },
  { key: 'stamina', label: '체력', desc: 'Stamina' },
  { key: 'command', label: '커맨드', desc: 'Command' },
];

const BATTER_STATS = [
  { key: 'contact', label: '컨택', desc: 'Contact' },
  { key: 'discipline', label: '선구안', desc: 'Discipline' },
  { key: 'power', label: '파워', desc: 'Power' },
  { key: 'speed', label: '주력', desc: 'Speed' },
];

function RadarBar({ label, desc, value }) {
  if (!value) return null;
  const pct = value; // 0~100 기준
  const color = getBarColor(value);
  return (
    <div className={styles.radarRow}>
      <div className={styles.radarLabel}>
        <span>{label}</span>
        <span className={styles.radarDesc}>{desc}</span>
      </div>
      <div className={styles.radarBarWrap}>
        <div className={styles.radarBar} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.radarVal} style={{ color }}>{value}</span>
    </div>
  );
}

export default function PlayerModal({ player, team, onClose }) {
  const overall = getOverall(player);
  const grade = getGrade(overall);
  const isPitcher = getPositionGroup(player.position) === 'pitcher';
  const stats = isPitcher ? PITCHER_STATS : BATTER_STATS;
  const displayColor = getTeamDisplayColor(team);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div
          className={styles.header}
          style={{
            background: team
              ? `linear-gradient(135deg, ${displayColor}55 0%, ${displayColor}22 60%, transparent 100%)`
              : 'var(--bg3)',
            borderBottomColor: team ? displayColor + '44' : 'var(--border)',
          }}
        >
          <div className={styles.headerLeft}>
            {team && (
              <div className={styles.teamTag} style={{ background: displayColor }}>
                {team.name_kor}
              </div>
            )}
            <h2 className={styles.playerName}>{player.name_kor}</h2>
            {player.name_eng && (
              <p className={styles.playerNameEng}>{player.name_eng}</p>
            )}
          </div>

          <div className={styles.headerRight}>
            {overall != null && (
              <div className={styles.ovrCircle} style={{ borderColor: grade.color + '88' }}>
                <span className={styles.ovrGrade} style={{ color: grade.color }}>
                  {grade.label}
                </span>
                <span className={styles.ovrNum}>{overall}</span>
                <span className={styles.ovrLabel}>OVR</span>
              </div>
            )}
            {player.number && (
              <div className={styles.jersey}>#{player.number}</div>
            )}
          </div>

          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>

        {/* Meta info */}
        <div className={styles.meta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>포지션</span>
            <span className={styles.metaVal}>
              {POSITION_KOR[player.position] || player.position}
            </span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>나이</span>
            <span className={styles.metaVal}>{player.age ?? '-'}</span>
          </div>
          {player.bats_throws && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>타/투</span>
              <span className={styles.metaVal}>{player.bats_throws}</span>
            </div>
          )}
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>유형</span>
            <span className={`${styles.metaVal} ${isPitcher ? styles.pitcher : styles.batter}`}>
              {isPitcher ? '투수' : '타자'}
            </span>
          </div>
          {player.source && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>데이터</span>
              <span className={styles.metaVal}>
                {player.source === 'statistical' ? '통계 기반' : 'AI 생성'}
              </span>
            </div>
          )}
          {player.confidence && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>신뢰도</span>
              <span className={styles.metaVal}>
                {Math.round(parseFloat(player.confidence) * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Abilities */}
        <div className={styles.abilities}>
          <h3 className={styles.sectionTitle}>
            {isPitcher ? '투수 능력치' : '타자 능력치'}
          </h3>
          <div className={styles.statsGrid}>
            {stats.map(stat => (
              <RadarBar
                key={stat.key}
                label={stat.label}
                desc={stat.desc}
                value={player[stat.key]}
              />
            ))}
          </div>
        </div>

        {/* AI Summary */}
        {player.ai_summary && (
          <div className={styles.summary}>
            <h3 className={styles.sectionTitle}>AI 평가</h3>
            <p className={styles.summaryText}>{player.ai_summary}</p>
          </div>
        )}
      </div>
    </div>
  );
}
