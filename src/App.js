import React, { useState, useMemo, useCallback } from 'react';
import playersData from './data/players.json';
import teamsData from './data/teams.json';
import TeamSelector from './components/TeamSelector';
import PlayerTable from './components/PlayerTable';
import PlayerModal from './components/PlayerModal';
import FilterBar from './components/FilterBar';
import { matchPositionGroup, getOverall } from './utils';
import styles from './App.module.css';

export default function App() {
  const [selectedTeam, setSelectedTeam] = useState('ALL');
  const [positionGroup, setPositionGroup] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('overall');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const teamsMap = useMemo(() => {
    const m = {};
    teamsData.forEach(t => m[t.id] = t);
    return m;
  }, []);

  const filteredPlayers = useMemo(() => {
    let list = playersData;

    if (selectedTeam !== 'ALL') {
      list = list.filter(p => p.team_id === selectedTeam);
    }
    if (positionGroup !== 'ALL') {
      list = list.filter(p => matchPositionGroup(p, positionGroup));
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name_kor.toLowerCase().includes(q) ||
        (p.name_eng && p.name_eng.toLowerCase().includes(q))
      );
    }

    // sort
    list = [...list].sort((a, b) => {
      let av, bv;
      if (sortKey === 'overall') {
        av = getOverall(a) ?? -1;
        bv = getOverall(b) ?? -1;
      } else if (sortKey === 'age') {
        av = a.age ?? 0;
        bv = b.age ?? 0;
      } else if (sortKey === 'name') {
        return sortDir === 'asc'
          ? a.name_kor.localeCompare(b.name_kor, 'ko')
          : b.name_kor.localeCompare(a.name_kor, 'ko');
      } else {
        av = a[sortKey] ?? -1;
        bv = b[sortKey] ?? -1;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });

    return list;
  }, [selectedTeam, positionGroup, search, sortKey, sortDir]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const currentTeam = selectedTeam !== 'ALL' ? teamsMap[selectedTeam] : null;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoMain}>KBO</span>
            <span className={styles.logoSub}>ROSTER</span>
          </div>
          <div className={styles.stats}>
            <span className={styles.statItem}>
              <strong>{filteredPlayers.length}</strong> 선수
            </span>
            <span className={styles.statItem}>
              <strong>10</strong> 구단
            </span>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <TeamSelector
          teams={teamsData}
          selected={selectedTeam}
          onSelect={setSelectedTeam}
        />

        <div className={styles.content}>
          {currentTeam && (
            <div
              className={styles.teamBanner}
              style={{
                background: `linear-gradient(135deg, ${currentTeam.color}33 0%, ${currentTeam.accent}22 100%)`,
                borderColor: currentTeam.color + '66',
              }}
            >
              <div className={styles.teamBannerDot} style={{ background: currentTeam.color }} />
              <span className={styles.teamBannerName}>{currentTeam.name_kor}</span>
              <span className={styles.teamBannerCount}>{filteredPlayers.length}명</span>
            </div>
          )}

          <FilterBar
            positionGroup={positionGroup}
            onPositionGroup={setPositionGroup}
            search={search}
            onSearch={setSearch}
          />

          <PlayerTable
            players={filteredPlayers}
            teamsMap={teamsMap}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            onSelect={setSelectedPlayer}
            showTeam={selectedTeam === 'ALL'}
          />
        </div>
      </main>

      {selectedPlayer && (
        <PlayerModal
          player={selectedPlayer}
          team={teamsMap[selectedPlayer.team_id]}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}
