import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { calcAllAbilities } from '../lib/genAbilities';
import { getTeamDisplayColor } from '../utils';
import styles from './AdminPage.module.css';

// ── 능력치 컬럼 정의 ──
const PITCHER_COLS = ['control', 'stuff', 'stamina', 'command'];
const BATTER_COLS  = ['contact', 'discipline', 'power', 'speed'];

const COL_LABEL = {
  control: '제구', stuff: '구위', stamina: '체력', command: '커맨드',
  contact: '컨택', discipline: '선구안', power: '파워', speed: '주력',
};

function isPitcher(position) {
  if (!position) return false;
  return position.split('/').some(p => ['P', 'SP', 'RP', 'CP'].includes(p.trim()));
}

function getAbilityCols(player) {
  return isPitcher(player.position) ? PITCHER_COLS : BATTER_COLS;
}

function abilityColor(val) {
  if (val == null) return '#999';
  if (val >= 80) return '#e53935';
  if (val >= 70) return '#FB8C00';
  if (val >= 60) return '#43A047';
  if (val >= 50) return '#1E88E5';
  return '#888';
}

function deltaColor(d) {
  if (!d) return 'var(--text3)';
  return d > 0 ? '#43A047' : '#e53935';
}

// ── 단일 편집 가능 셀 ──
function EditCell({ value, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const startEdit = () => {
    setDraft(String(value ?? ''));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!isNaN(n) && n >= 1 && n <= 100 && n !== value) onSave(n);
    setEditing(false);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setEditing(false);
  };

  if (editing) {
    return (
      <input ref={inputRef} className={styles.cellInput} value={draft}
        onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
        type="number" min="1" max="100" />
    );
  }
  return (
    <span className={styles.cellVal} style={{ color: abilityColor(value) }}
      onClick={startEdit} title="클릭하여 편집">{value ?? '—'}</span>
  );
}

// ── AI 보정치 읽기 전용 표시 ──
function AdjDisplay({ delta }) {
  const d = delta || 0;
  const display = d > 0 ? `+${d}` : d === 0 ? '·' : `${d}`;
  return (
    <span className={styles.deltaVal} style={{ color: deltaColor(d), cursor: 'default' }}>
      {display}
    </span>
  );
}

// ── 메인 컴포넌트 ──
export default function AdminPage({ players: initialPlayers, teams, teamsMap, loading }) {
  const [players, setPlayers] = useState(initialPlayers);
  // player_id → { col: newVal } — 개별 능력치 직접 편집 (임시)
  const [dirtyMap, setDirtyMap] = useState({});
  // player_id → player_ai_adjustments row (읽기 전용 - Claude AI가 설정)
  const [adjMap, setAdjMap] = useState({});

  const [saving, setSaving] = useState(null);
  const [savedSet, setSavedSet] = useState(new Set());
  const [filterTeam, setFilterTeam] = useState('ALL');
  const [filterType, setFilterType] = useState('ALL');
  const [search, setSearch] = useState('');
  const [recalcStatus, setRecalcStatus] = useState('');
  const fileInputRef = useRef(null);

  // initialPlayers prop 동기화
  const prevInitial = useRef(null);
  if (initialPlayers !== prevInitial.current) {
    prevInitial.current = initialPlayers;
    setPlayers(initialPlayers);
  }

  // ── AI 보정치 초기 로드 ──
  useEffect(() => {
    supabase.from('player_ai_adjustments').select('*').then(({ data }) => {
      if (!data) return;
      const m = {};
      data.forEach(r => { m[String(r.player_id)] = r; });
      setAdjMap(m);
    });
  }, []);

  // ── 필터링 ──
  const filtered = useMemo(() => {
    let list = players;
    if (filterTeam !== 'ALL') list = list.filter(p => p.team_id === filterTeam);
    if (filterType === 'pitcher') list = list.filter(p => isPitcher(p.position));
    if (filterType === 'batter')  list = list.filter(p => !isPitcher(p.position));
    if (filterType === 'adj')     list = list.filter(p => {
      const a = adjMap[String(p.id)];
      return a && getAbilityCols(p).some(col => a[`${col}_adj`]);
    });
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(p =>
        p.name_kor?.toLowerCase().includes(q) ||
        (p.name_eng && p.name_eng.toLowerCase().includes(q))
      );
    }
    return list;
  }, [players, filterTeam, filterType, search, adjMap]);

  // ── 개별 능력치 직접 편집 ──
  const handleEdit = useCallback((playerId, col, val) => {
    setDirtyMap(prev => ({ ...prev, [playerId]: { ...(prev[playerId] || {}), [col]: val } }));
    setPlayers(prev => prev.map(p =>
      String(p.id) === String(playerId) ? { ...p, [col]: val } : p
    ));
  }, []);

  // ── 개별 능력치 저장 ──
  const handleSave = useCallback(async (player) => {
    const id = String(player.id);
    const dirty = dirtyMap[id];
    if (!dirty || !Object.keys(dirty).length) return;

    setSaving(id);
    try {
      const { error } = await supabase.from('player_abilities').upsert(
        { player_id: id, ...dirty, is_manual: true, source: 'manual', updated_at: new Date().toISOString() },
        { onConflict: 'player_id' }
      );
      if (error) throw error;
      setPlayers(prev => prev.map(p => String(p.id) === id ? { ...p, is_manual: true } : p));
      setDirtyMap(prev => { const n = { ...prev }; delete n[id]; return n; });
      setSavedSet(prev => new Set([...prev, id]));
      setTimeout(() => setSavedSet(prev => { const n = new Set(prev); n.delete(id); return n; }), 2000);
    } catch (err) { alert(`저장 실패: ${err.message}`); }
    setSaving(null);
  }, [dirtyMap]);

  // ── 능력치 재계산 ──
  const handleRecalc = useCallback(async () => {
    if (!window.confirm(
      'player_season_stats + AI 보정치를 합산해 전체 능력치를 재계산합니다.\n' +
      '모든 선수 능력치가 덮어씌워집니다. 진행할까요?'
    )) return;

    setRecalcStatus('📥 시즌 스탯 불러오는 중...');
    try {
      // 1. player_season_stats 전체 (페이지네이션)
      let allStats = [];
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from('player_season_stats').select('*').range(from, from + PAGE - 1);
        if (error) throw error;
        allStats = allStats.concat(data || []);
        if (!data || data.length < PAGE) break;
        from += PAGE;
        setRecalcStatus(`📥 시즌 스탯 불러오는 중... ${allStats.length}행`);
      }

      // 2. AI 보정치 전체
      setRecalcStatus('📥 AI 보정치 불러오는 중...');
      const { data: adjRows, error: adjErr } = await supabase
        .from('player_ai_adjustments').select('*');
      if (adjErr) throw adjErr;

      // 보정치 로컬 상태 갱신
      const newAdjMap = {};
      (adjRows || []).forEach(r => { newAdjMap[String(r.player_id)] = r; });
      setAdjMap(newAdjMap);

      setRecalcStatus(`⚙️ 능력치 계산 중... (${allStats.length}행)`);

      // 3. 계산 (adj 포함, 전체 선수 무조건 재계산)
      const results = calcAllAbilities(players, allStats, adjRows || []);

      // 4. _base 제거 후 upsert
      const batch = results.map(({ _base, ...rest }) => rest);

      const BATCH_SIZE = 100;
      let done = 0;
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const chunk = batch.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from('player_abilities')
          .upsert(chunk, { onConflict: 'player_id' });
        if (error) throw error;
        done += chunk.length;
        setRecalcStatus(`💾 저장 중... ${done} / ${batch.length}`);
      }

      setRecalcStatus(`✅ 완료 — ${batch.length}명 재계산`);

      // 5. 로컬 상태 갱신
      setPlayers(prev => {
        const map = {};
        batch.forEach(r => { map[r.player_id] = r; });
        return prev.map(p => {
          const upd = map[String(p.id)];
          return upd ? { ...p, ...upd } : p;
        });
      });
    } catch (err) {
      setRecalcStatus(`❌ 오류: ${err.message}`);
    }
  }, [players]);

  // ── Bulk JSON Import ──
  const handleImportFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setRecalcStatus('📂 파일 읽는 중...');
    try {
      const data = JSON.parse(await file.text());
      const allPlayers = [];
      Object.values(data).forEach(team => (team.players || []).forEach(p => allPlayers.push(p)));
      if (!allPlayers.length) { setRecalcStatus('❌ 선수 데이터 없음'); return; }

      const batch = allPlayers
        .filter(p => p.abilities)
        .map(p => {
          const ab = p.abilities;
          return {
            player_id: String(p.id),
            control: ab.control ?? null, stuff: ab.stuff ?? null,
            stamina: ab.stamina ?? null, command: ab.command ?? null,
            contact: ab.contact ?? null, discipline: ab.discipline ?? null,
            power: ab.power ?? null, speed: ab.speed ?? null,
            source: 'generated', is_manual: false,
            updated_at: new Date().toISOString(),
          };
        });

      const BATCH_SIZE = 100;
      let done = 0;
      for (let i = 0; i < batch.length; i += BATCH_SIZE) {
        const { error } = await supabase.from('player_abilities')
          .upsert(batch.slice(i, i + BATCH_SIZE), { onConflict: 'player_id' });
        if (error) throw error;
        done += BATCH_SIZE;
        setRecalcStatus(`📦 업데이트 중... ${Math.min(done, batch.length)} / ${batch.length}`);
      }
      setRecalcStatus(`✅ 완료 — ${batch.length}명 업데이트`);
      setPlayers(prev => {
        const map = {};
        batch.forEach(r => { map[r.player_id] = r; });
        return prev.map(p => { const u = map[String(p.id)]; return u ? { ...p, ...u } : p; });
      });
    } catch (err) { setRecalcStatus(`❌ 오류: ${err.message}`); }
  }, []);

  // ── UI ──
  const adjCount = Object.keys(adjMap).length;

  return (
    <div className={styles.wrap}>
      {/* ── 헤더 ── */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.adminBadge}>ADMIN</span>
          <h1 className={styles.title}>관리자 콘솔</h1>
          <span className={styles.subInfo}>AI 보정: {adjCount}명</span>
        </div>
        <a className={styles.backBtn} href={window.location.pathname}>← 메인으로</a>
      </header>

      {/* ── 툴바 ── */}
      <div className={styles.toolbar}>
        <select className={styles.select} value={filterTeam} onChange={e => setFilterTeam(e.target.value)}>
          <option value="ALL">전체 팀</option>
          {teams.map(t => <option key={t.id} value={t.id}>{t.name_kor}</option>)}
        </select>
        <select className={styles.select} value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="ALL">전체</option>
          <option value="pitcher">투수</option>
          <option value="batter">타자</option>
          <option value="adj">AI 보정만</option>
        </select>
        <input className={styles.searchInput} placeholder="선수 이름 검색..."
          value={search} onChange={e => setSearch(e.target.value)} />

        <div className={styles.spacer} />

        <div className={styles.importArea}>
          <button className={styles.recalcBtn} onClick={handleRecalc}>⚡ 능력치 재계산</button>
          <div className={styles.divider} />
          <button className={styles.importBtn} onClick={() => fileInputRef.current?.click()}>
            📂 JSON Import
          </button>
          <input ref={fileInputRef} type="file" accept=".json"
            style={{ display: 'none' }} onChange={handleImportFile} />
          {recalcStatus && <span className={styles.importStatus}>{recalcStatus}</span>}
        </div>
      </div>

      {/* ── 테이블 ── */}
      {loading
        ? <div className={styles.loadingMsg}>로딩 중...</div>
        : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.th}>팀</th>
                  <th className={styles.th}>이름</th>
                  <th className={styles.th}>포지션</th>
                  <th className={`${styles.th} ${styles.abilityHead}`}>
                    능력치<br /><span style={{ fontWeight: 400, fontSize: 10, opacity: 0.7 }}>클릭하여 편집</span>
                  </th>
                  <th className={`${styles.th} ${styles.abilityHead}`}>
                    AI 보정치<br /><span style={{ fontWeight: 400, fontSize: 10, opacity: 0.7 }}>Claude AI 설정</span>
                  </th>
                  <th className={styles.th}>액션</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(player => {
                  const id = String(player.id);
                  const team = teamsMap[player.team_id];
                  const teamColor = getTeamDisplayColor(team);
                  const cols = getAbilityCols(player);
                  const isDirty = !!(dirtyMap[id] && Object.keys(dirtyMap[id]).length);
                  const isSaving = saving === id;
                  const isSaved = savedSet.has(id);
                  const adj = adjMap[id];
                  const hasAdj = adj && cols.some(col => adj[`${col}_adj`]);

                  return (
                    <tr key={id} className={`${styles.row} ${hasAdj ? styles.rowAdj : ''}`}>
                      {/* 팀 */}
                      <td className={styles.td}>
                        <span className={styles.teamDot} style={{ background: teamColor }} />
                      </td>

                      {/* 이름 */}
                      <td className={styles.td}>
                        <div className={styles.nameKor}>{player.name_kor}</div>
                        {player.name_eng && <div className={styles.nameEng}>{player.name_eng}</div>}
                      </td>

                      {/* 포지션 */}
                      <td className={styles.td}>
                        <span className={`${styles.posBadge} ${isPitcher(player.position) ? styles.posPitcher : styles.posBatter}`}>
                          {player.position || '—'}
                        </span>
                      </td>

                      {/* 능력치 */}
                      <td className={styles.td}>
                        <div className={styles.abilityCells}>
                          {cols.map(col => (
                            <div key={col} className={styles.abilityItem}>
                              <span className={styles.abilityLabel}>{COL_LABEL[col]}</span>
                              <EditCell value={player[col]} onSave={val => handleEdit(id, col, val)} />
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* AI 보정치 (읽기 전용) */}
                      <td className={styles.td}>
                        {hasAdj ? (
                          <>
                            <div className={styles.abilityCells}>
                              {cols.map(col => {
                                const delta = adj[`${col}_adj`] ?? 0;
                                return (
                                  <div key={col} className={styles.abilityItem}>
                                    <span className={styles.abilityLabel}>{COL_LABEL[col]}</span>
                                    <AdjDisplay delta={delta} />
                                  </div>
                                );
                              })}
                            </div>
                            {adj.notes && (
                              <div className={styles.adjNotes} title={adj.notes}>
                                📝 {adj.notes.slice(0, 40)}{adj.notes.length > 40 ? '…' : ''}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className={styles.adjNone}>—</span>
                        )}
                      </td>

                      {/* 액션 */}
                      <td className={styles.td}>
                        <div className={styles.actions}>
                          {isDirty && (
                            <button className={styles.saveBtn} disabled={isSaving}
                              onClick={() => handleSave(player)}>
                              {isSaving ? '저장…' : '저장'}
                            </button>
                          )}
                          {isSaved && <span className={styles.savedBadge}>저장됨 ✓</span>}
                          {player.is_manual && !isDirty && (
                            <span className={styles.manualBadge}>수동</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className={styles.emptyMsg}>검색 결과가 없습니다.</div>
            )}
          </div>
        )
      }

      <div className={styles.footer}>
        총 {filtered.length}명 표시 중 (전체 {players.length}명)
      </div>
    </div>
  );
}
