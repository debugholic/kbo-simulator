import React from 'react';
import { getOverall, getGrade, getPositionGroup, POSITION_KOR, getBarColor } from '../utils';
import styles from './PlayerTable.module.css';

const SORT_COLS = [
  { key: 'name', label: '선수명' },
  { key: 'overall', label: 'OVR' },
];

function StatBar({ value, isPitcher, statKey }) {
  if (!value) return <span className={styles.noStat}>-</span>;
  const pct = ((value - 40) / 49) * 100;
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

export default function PlayerTable({ players, teamsMap, sortKey, sortDir, onSort, onSelect, showTeam }) {
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
            {/* Pitcher stats */}
            <th className={styles.thStat} onClick={() => onSort('control')}>
              제구 <SortIcon active={sortKey === 'control'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('stuff')}>
              구위 <SortIcon active={sortKey === 'stuff'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('stamina')}>
              체력 <SortIcon active={sortKey === 'stamina'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('command')}>
              커맨드 <SortIcon active={sortKey === 'command'} dir={sortDir} />
            </th>
            {/* Batter stats */}
            <th className={styles.thStat} onClick={() => onSort('contact')}>
              컨텍 <SortIcon active={sortKey === 'contact'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('discipline')}>
              선구 <SortIcon active={sortKey === 'discipline'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('power')}>
              파워 <SortIcon active={sortKey === 'power'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('speed')}>
              주력 <SortIcon active={sortKey === 'speed'} dir={sortDir} />
            </th>
            <th className={styles.thStat} onClick={() => onSort('eye')}>
              눈 <SortIcon active={sortKey === 'eye'} dir={sortDir} />
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((player, i) => {
            const overall = getOverall(player);
            const grade = getGrade(overall);
            const isPitcher = getPositionGroup(player.position) === 'pitcher';
            const team = teamsMap[player.team_id];
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
                        style={{ background: team.color }}
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
                      <span className={styles.teamName} style={{ color: team.color }}>
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
                {/* pitcher */}
                <td className={styles.tdStat}><StatBar value={isPitcher ? player.control : null} /></td>
                <td className={styles.tdStat}><StatBar value={isPitcher ? player.stuff : null} /></td>
                <td className={styles.tdStat}><StatBar value={isPitcher ? player.stamina : null} /></td>
                <td className={styles.tdStat}><StatBar value={isPitcher ? player.command : null} /></td>
                {/* batter */}
                <td className={styles.tdStat}><StatBar value={!isPitcher ? player.contact : null} /></td>
                <td className={styles.tdStat}><StatBar value={!isPitcher ? player.discipline : null} /></td>
                <td className={styles.tdStat}><StatBar value={!isPitcher ? player.power : null} /></td>
                <td className={styles.tdStat}><StatBar value={!isPitcher ? player.speed : null} /></td>
                <td className={styles.tdStat}><StatBar value={!isPitcher ? player.eye : null} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
