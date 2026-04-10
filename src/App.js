import React, { useState, useMemo, useCallback } from 'react';
import TeamSelector from './components/TeamSelector';
import PlayerTable from './components/PlayerTable';
import PlayerDetail from './components/PlayerDetail';
import FilterBar from './components/FilterBar';
import ScoutingDemo from './components/ScoutingDemo';
import ConfidenceDemo from './components/ConfidenceDemo';
import GrowthSimDemo from './components/GrowthSimDemo';
import TradeDemo from './components/TradeDemo';
import PitchSimDemo from './components/PitchSimDemo';
import { matchPositionGroup, getOverall, getPositionGroup, getTeamDisplayColor, calcAge } from './utils';
import { useData } from './hooks/useData';
import styles from './App.module.css';

export default function App() {
  const { players, teams, teamsMap, leaguePitchStats, scoutingHints, attrOpinions, loading, error } = useData();

  const [selectedTeam, setSelectedTeam] = useState('ALL');
  const [playerType, setPlayerType] = useState('pitcher');
  const [positionGroup, setPositionGroup] = useState('ALL');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('overall');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [showScouting, setShowScouting] = useState(false);
  const [showConfidence, setShowConfidence] = useState(false);
  const [showGrowthSim, setShowGrowthSim] = useState(false);
  const [showTrade, setShowTrade] = useState(false);
  const [showPitchSim, setShowPitchSim] = useState(false);

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
        av = calcAge(a.birthdate) ?? 0;
        bv = calcAge(b.birthdate) ?? 0;
      } else if (sortKey === 'name') {
        return sortDir === 'asc'
          ? a.name_kor.localeCompare(b.name_kor, 'ko')
          : b.name_kor.localeCompare(a.name_kor, 'ko');
      } else if (['stuff', 'command', 'control', 'holding', 'stamina'].includes(sortKey)) {
        av = a.pitcherEval?.[sortKey] ?? -1;
        bv = b.pitcherEval?.[sortKey] ?? -1;
      } else {
        av = a.attributes?.[sortKey] ?? -1;
        bv = b.attributes?.[sortKey] ?? -1;
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

  // ── Player Detail Page ──
  if (selectedPlayer) {
    return (
      <PlayerDetail
        player={selectedPlayer}
        team={teamsMap[selectedPlayer.team_id]}
        leaguePitchStats={leaguePitchStats}
        onBack={() => setSelectedPlayer(null)}
      />
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
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button
              onClick={() => setShowScouting(true)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#1976D222', border: '1px solid #1976D244', color: '#1976D2', cursor: 'pointer', fontWeight: 600 }}
            >
              🌐 용병 스카우팅
            </button>
            <button
              onClick={() => setShowConfidence(true)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#9C27B022', border: '1px solid #9C27B044', color: '#9C27B0', cursor: 'pointer', fontWeight: 600 }}
            >
              📊 능력치 가시성
            </button>
            <button
              onClick={() => setShowGrowthSim(true)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#E6500022', border: '1px solid #E6500044', color: '#E65000', cursor: 'pointer', fontWeight: 600 }}
            >
              📈 성장 시뮬레이션
            </button>
            <button
              onClick={() => setShowTrade(true)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#00897B22', border: '1px solid #00897B44', color: '#00897B', cursor: 'pointer', fontWeight: 600 }}
            >
              🔄 트레이드
            </button>
            <button
              onClick={() => setShowPitchSim(true)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 8, background: '#F4431622', border: '1px solid #F4431644', color: '#F44316', cursor: 'pointer', fontWeight: 600 }}
            >
              ⚾ 투구 시뮬
            </button>
          </div>
        </div>
      </header>

      {showScouting && <ScoutingDemo onClose={() => setShowScouting(false)} scoutingHints={scoutingHints} attrOpinions={attrOpinions} />}
      {showConfidence && <ConfidenceDemo onClose={() => setShowConfidence(false)} />}
      {showGrowthSim && <GrowthSimDemo onClose={() => setShowGrowthSim(false)} />}
      {showTrade && <TradeDemo onClose={() => setShowTrade(false)} players={players} teams={teams} attrOpinions={attrOpinions} />}
      {showPitchSim && <PitchSimDemo onClose={() => setShowPitchSim(false)} players={players} teamsMap={teamsMap} />}

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

    </div>
  );
}
