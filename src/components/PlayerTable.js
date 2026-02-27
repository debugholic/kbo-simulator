import React from 'react';
import { getOverall, getGrade, getPositionGroup, POSITION_KOR, getBarColor, getTeamDisplayColor } from '../utils';
import styles from './PlayerTable.module.css';

const PITCHER_COLS = [
  { key: 'control', label: '제구' },
  { key: 'stuff', label: '구위' },
  { key: 'stamina', label: '체력' },
  { key: 'command', label: '커맨드' },
];

const BATTER_COLS = [
  { key: 'contact', label: '컨택' },
  { key: 'discipline', label: '선구안' },
  { key: 'power', label: '파워' },
  { key: 'speed', label: '주력' },
];

function StatBar({ value }) {
  if (!value) return <span className={styles.noStat}>-</span>;
  const pct = value; // 0~100 기준
  const color = getBarColor(value);
  return (
    <div className={styles.statCell}>
      <div className={styles.barWrap}>
        <div className={styles.bar} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.statVal}>{value}</span>
    </div>
  );
}

function SortIcon({ active, dir }) {
  return (
    <span className={`${styles.sortIcon} ${active ? styles.sortActive : ''}`}>
      {active ? (dir === 'desc' ? '↓' : '↑') : '↕'}
    </span>
  );
}

export default function PlayerTable({ players, teamsMap, playerType, sortKey, sortDir, onSort, onSelect, showTeam }) {
  const statCols = playerType === 'pitcher' ? PITCHER_COLS : BATTER_COLS;

  if (!players.length) {
    return (
      <div className={styles.empty}>
        <span>검색 결과가 없습니다</span>
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th className={styles.thNum}>#</th>
            <th className={`${styles.th} ${styles.thName}`} onClick={() => onSort('name')}>
              선수명 <SortIcon active={sortKey === 'name'} dir={sortDir} />
            </th>
            <th className={styles.th}>포지션</th>
            {showTeam && <th className={styles.th}>구단</th>}
            <th className={styles.th} onClick={() => onSort('age')}>
              나이 <SortIcon active={sortKey === 'age'} dir={sortDir} />
            </th>
            <th className={`${styles.th} ${styles.thOvr}`} onClick={() => onSort('overall')}>
              OVR <SortIcon active={sortKey === 'overall'} dir={sortDir} />
            </th>
            {statCols.map(col => (
              <th key={col.key} className={styles.thStat} onClick={() => onSort(col.key)}>
                {col.label} <SortIcon active={sortKey === col.key} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((player, i) => {
            const overall = getOverall(player);
            const grade = getGrade(overall);
            const isPitcher = getPositionGroup(player.position) === 'pitcher';
            const team = teamsMap[player.team_id];
            const displayColor = getTeamDisplayColor(team);
            return (
              <tr
                key={player.id}
                className={styles.row}
                onClick={() => onSelect(player)}
              >
                <td className={styles.tdNum}>{i + 1}</td>
                <td className={styles.tdName}>
                  <div className={styles.nameWrap}>
                    {team && (
                      <div
                        className={styles.teamStripe}
                        style={{ background: displayColor }}
                      />
                    )}
                    <div>
                      <div className={styles.nameKor}>{player.name_kor}</div>
                      {player.name_eng && (
                        <div className={styles.nameEng}>{player.name_eng}</div>
                      )}
                    </div>
                    {player.number && (
                      <span className={styles.jersey}>#{player.number}</span>
                    )}
                  </div>
                </td>
                <td className={styles.td}>
                  <span className={`${styles.pos} ${isPitcher ? styles.posPitcher : styles.posBatter}`}>
                    {POSITION_KOR[player.position] || player.position}
                  </span>
                </td>
                {showTeam && (
                  <td className={styles.td}>
                    {team && (
                      <span className={styles.teamName} style={{ color: displayColor }}>
                        {team.name_kor}
                      </span>
                    )}
                  </td>
                )}
                <td className={styles.tdCenter}>{player.age ?? '-'}</td>
                <td className={styles.tdOvr}>
                  {overall != null ? (
                    <span className={styles.ovrBadge} style={{ color: grade.color, borderColor: grade.color + '44' }}>
                      <span className={styles.ovrGrade}>{grade.label}</span>
                      <span className={styles.ovrNum}>{overall}</span>
                    </span>
                  ) : (
                    <span className={styles.noStat}>-</span>
                  )}
                </td>
                {statCols.map(col => (
                  <td key={col.key} className={styles.tdStat}>
                    <StatBar value={player[col.key]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
