import React, { useState, useMemo, useCallback, lazy, Suspense } from 'react';
import TeamSelector from './components/TeamSelector';
import PlayerTable from './components/PlayerTable';
import PlayerModal from './components/PlayerModal';
import FilterBar from './components/FilterBar';
import { matchPositionGroup, getOverall, getPositionGroup, getTeamDisplayColor } from './utils';
import { useData } from './hooks/useData';
import styles from './App.module.css';

const AdminPage = lazy(() => import('./pages/AdminPage'));

const isAdmin = new URLSearchParams(window.location.search).get('admin') === '1';

export default function App() {
  const { players, teams, teamsMap, loading, error } = useData();

  const [selectedTeam, setSelectedTeam] = useState('ALL');
  const [playerType, setPlayerType] = useState('pitcher');
  const [positionGroup, setPositionGroup] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('overall');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  const handlePlayerType = useCallback((type) => {
    setPlayerType(type);
    setPositionGroup('ALL');
  }, []);

  const filteredPlayers = useMemo(() => {
    let list = players;

    // 투수/타자 탭 필터
    list = list.filter(p => getPositionGroup(p.position) === playerType);

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
  }, [players, selectedTeam, playerType, positionGroup, search, sortKey, sortDir]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const currentTeam = selectedTeam !== 'ALL' ? teamsMap[selectedTeam] : null;

  // ── Admin Mode ──
  if (isAdmin) {
    return (
      <Suspense fallback={<div className={styles.loadingWrap}><div className={styles.spinner} /></div>}>
        <AdminPage players={players} teams={teams} teamsMap={teamsMap} loading={loading} />
      </Suspense>
    );
  }

  // ── Loading ──
  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <div className={styles.spinner} />
        <p className={styles.loadingText}>데이터 로딩 중...</p>
      </div>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <div className={styles.loadingWrap}>
        <p className={styles.errorText}>데이터를 불러오지 못했습니다.<br />{error}</p>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logo}>
            <span className={styles.logoMain}>KBO</span>
            <span className={styles.logoSub}>SIMULATOR</span>
          </div>
          <div className={styles.stats}>
            <span className={styles.statItem}>
              <strong>{filteredPlayers.length}</strong> 선수
            </span>
            <span className={styles.statItem}>
              <strong>{teams.length || 10}</strong> 구단
            </span>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <TeamSelector
          teams={teams}
          selected={selectedTeam}
          onSelect={setSelectedTeam}
        />

        <div className={styles.content}>
          {currentTeam && (() => {
            const displayColor = getTeamDisplayColor(currentTeam);
            return (
              <div
                className={styles.teamBanner}
                style={{
                  background: `linear-gradient(135deg, ${displayColor}33 0%, ${displayColor}11 100%)`,
                  borderColor: displayColor + '66',
                }}
              >
                <div className={styles.teamBannerDot} style={{ background: displayColor }} />
                <span className={styles.teamBannerName}>{currentTeam.name_kor}</span>
                <span className={styles.teamBannerCount}>{filteredPlayers.length}명</span>
              </div>
            );
          })()}

          <FilterBar
            playerType={playerType}
            onPlayerType={handlePlayerType}
            positionGroup={positionGroup}
            onPositionGroup={setPositionGroup}
            search={search}
            onSearch={setSearch}
          />

          <PlayerTable
            players={filteredPlayers}
            teamsMap={teamsMap}
            playerType={playerType}
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
