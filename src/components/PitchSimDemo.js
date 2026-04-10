import React, { useState, useCallback, useRef, useMemo } from 'react';
import { PitchSimulator, toPitcherProfile, PITCH_TYPE_LABELS, ZONE_X, ZONE_Y, BALL_R } from '../simulator/PitchSimulator';
import { getOverall, getPositionGroup, getTeamDisplayColor } from '../utils';
import styles from './PitchSimDemo.module.css';

// ── SVG 좌표계 설정 ──
// 스트라이크존 바깥 영역을 넉넉하게 표시
const SVG_W = 400;
const SVG_H = 460;
const SVG_CX = SVG_W / 2;  // 200
const SVG_CY = 220;         // 존 중앙 (아래쪽에 홈플레이트 여백)

// 1단위(홈플레이트 반폭) = 72px
const SCALE = 72; // px per unit
const ZONE_PX_W = ZONE_X * 2 * SCALE; // 144px
const ZONE_PX_H = ZONE_Y * 2 * SCALE; // 194.4px
const BALL_PX   = BALL_R * SCALE;     // 12.2px

function toSvg(x, y) {
  return {
    sx: SVG_CX + x * SCALE,
    sy: SVG_CY - y * SCALE,  // y 반전 (위가 양수)
  };
}

const zoneLeft = SVG_CX - ZONE_PX_W / 2;
const zoneTop  = SVG_CY - ZONE_PX_H / 2;

// 구종별 색상
const PITCH_COLORS = {
  '4seam':    '#EF5350',
  '2seam':    '#FF7043',
  'sinker':   '#FFA726',
  'cutter':   '#AB47BC',
  'slider':   '#42A5F5',
  'curve':    '#66BB6A',
  'changeup': '#FFCA28',
  'fork':     '#78909C',
  'knuckle':  '#8D6E63',
};

function resultLabel(result) {
  if (!result) return '-';
  switch (result) {
    case 'called_strike': return '스트라이크';
    case 'ball':          return '볼';
    case 'wild_pitch':    return '폭투';
    case 'hit_by_pitch':  return '몸맞공';
    case 'balk':          return '보크';
    default: return result;
  }
}

function resultColor(result) {
  if (result === 'called_strike') return '#EF5350';
  if (result === 'ball') return '#66BB6A';
  return '#FFA726';
}

// 20-80 스케일 → 등급 색상
function gradeColor(v) {
  if (v >= 70) return '#E53935';
  if (v >= 60) return '#FB8C00';
  if (v >= 50) return '#43A047';
  if (v >= 40) return '#1E88E5';
  return '#757575';
}

// ── 선수를 PitchSimulator 입력으로 변환 ──
// toPitcherProfile 은 playerData.eval 을 참조하지만 실제 데이터는 pitcherEval
function buildSimProfile(player) {
  // toPitcherProfile 내부 참조 키를 맞춰주기 위해 래핑
  const wrapped = {
    ...player,
    eval: player.pitcherEval || {},   // pitcherEval → eval 로 매핑
    pitchStats: player.pitchStats || {},
    attributes: player.attributes_obj
      ? player.attributes_obj
      : (player.attributes || {}),
  };
  return toPitcherProfile(wrapped);
}

// ── 선수 카드 (선택 패널용) ──
function PitcherCard({ player, team, selected, onSelect }) {
  const eval_ = player.pitcherEval || {};
  const color = team ? getTeamDisplayColor(team) : '#555';
  const overall = getOverall(player);

  return (
    <button
      className={`${styles.pitcherCard} ${selected ? styles.pitcherCardSelected : ''}`}
      style={selected ? { borderColor: color, background: `${color}18` } : {}}
      onClick={() => onSelect(player)}
    >
      <div className={styles.pitcherCardTop}>
        <span className={styles.pitcherCardName}>{player.name_kor}</span>
        <span className={styles.pitcherCardPos}>{player.position}</span>
        {overall != null && (
          <span className={styles.pitcherCardOvr} style={{ color: gradeColor(overall) }}>
            {overall}
          </span>
        )}
      </div>
      {team && (
        <div className={styles.pitcherCardTeam} style={{ color }}>
          {team.name_kor}
        </div>
      )}
      <div className={styles.pitcherCardStats}>
        {eval_.stuff   != null && <span>구위 <b style={{ color: gradeColor(eval_.stuff) }}>{Math.round(eval_.stuff)}</b></span>}
        {eval_.command != null && <span>제구 <b style={{ color: gradeColor(eval_.command) }}>{Math.round(eval_.command)}</b></span>}
        {eval_.control != null && <span>컨트 <b style={{ color: gradeColor(eval_.control) }}>{Math.round(eval_.control)}</b></span>}
        {eval_.stamina != null && <span>체력 <b style={{ color: gradeColor(eval_.stamina) }}>{Math.round(eval_.stamina)}</b></span>}
      </div>
    </button>
  );
}

// ── 구종 배지 ──
function PitchTypeBadge({ type, velo, pct }) {
  const color = PITCH_COLORS[type] || '#888';
  return (
    <div className={styles.ptBadge}>
      <div className={styles.ptBadgeDot} style={{ background: color }} />
      <span className={styles.ptBadgeLabel}>{PITCH_TYPE_LABELS[type] || type}</span>
      <span className={styles.ptBadgePct}>{Math.round(pct)}%</span>
      <span className={styles.ptBadgeVelo}>{velo}k</span>
    </div>
  );
}

// ── 메인 컴포넌트 ──
export default function PitchSimDemo({ onClose, players = [], teamsMap = {} }) {
  // 투수만 필터
  const pitchers = useMemo(() =>
    players
      .filter(p => getPositionGroup(p.position) === 'pitcher')
      .filter(p => p.pitcherEval != null)
      .sort((a, b) => (getOverall(b) ?? 0) - (getOverall(a) ?? 0)),
    [players]
  );

  const [search, setSearch] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState(null);

  // 검색 필터
  const filteredPitchers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pitchers.slice(0, 50); // 처음엔 상위 50명
    return pitchers.filter(p =>
      p.name_kor.toLowerCase().includes(q) ||
      (p.name_eng && p.name_eng.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [pitchers, search]);

  // 선택된 선수 프로필
  const simProfile = useMemo(() =>
    selectedPlayer ? buildSimProfile(selectedPlayer) : null,
    [selectedPlayer]
  );

  // 투구 시뮬레이터 인스턴스
  const simRef = useRef(null);

  // 카운트/게임 상태
  const [count, setCount] = useState({ balls: 0, strikes: 0 });
  const [outs, setOuts] = useState(0);
  const [lastResult, setLastResult] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [pitchLog, setPitchLog] = useState([]);
  const [showDebug, setShowDebug] = useState(false);

  // 선수 선택 시 리셋
  const handleSelectPlayer = useCallback((player) => {
    setSelectedPlayer(player);
    const profile = buildSimProfile(player);
    simRef.current = new PitchSimulator(profile);
    setCount({ balls: 0, strikes: 0 });
    setOuts(0);
    setLastResult(null);
    setFeedback(null);
    setPitchLog([]);
  }, []);

  const throwPitch = useCallback(() => {
    if (!simRef.current) return;
    const result = simRef.current.simulate(count, { outs }, feedback);

    setLastResult(result);
    setFeedback(result.feedback);
    setPitchLog(prev => [result, ...prev]);

    // 카운트 업데이트
    const r = result.result || result.type;
    if (r === 'called_strike' || r === 'swinging_strike') {
      if (count.strikes >= 2) {
        setOuts(o => (o + 1 >= 3 ? 0 : o + 1));
        setCount({ balls: 0, strikes: 0 });
        setFeedback(null);
      } else {
        setCount(c => ({ ...c, strikes: c.strikes + 1 }));
      }
    } else if (r === 'ball' || r === 'wild_pitch') {
      if (count.balls >= 3) {
        setCount({ balls: 0, strikes: 0 });
        setFeedback(null);
      } else {
        setCount(c => ({ ...c, balls: c.balls + 1 }));
      }
    } else if (r === 'balk' || r === 'hit_by_pitch') {
      setCount({ balls: 0, strikes: 0 });
      setFeedback(null);
    }
  }, [count, outs, feedback]);

  const resetPitching = useCallback(() => {
    if (!selectedPlayer) return;
    const profile = buildSimProfile(selectedPlayer);
    simRef.current = new PitchSimulator(profile);
    setCount({ balls: 0, strikes: 0 });
    setOuts(0);
    setLastResult(null);
    setFeedback(null);
    setPitchLog([]);
  }, [selectedPlayer]);

  // 최근 투구들 (존에 표시)
  const recentPitches = pitchLog.slice(0, 12);

  const pitchCount = simRef.current?.pitchCount ?? 0;
  const eval_ = selectedPlayer?.pitcherEval || {};
  const pitchTypes = simProfile?.pitchTypes || {};
  const hasPlayer = !!selectedPlayer;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.badge}>⚾ Pitch Simulator</span>
            {selectedPlayer && (
              <span className={styles.playerBadge}>{selectedPlayer.name_kor}</span>
            )}
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>

          {/* ── 왼쪽: 선수 선택 패널 ── */}
          <div className={styles.sidePanel}>
            <div className={styles.searchWrap}>
              <input
                className={styles.searchInput}
                placeholder="선수 검색..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className={styles.pitcherList}>
              {filteredPitchers.map(p => (
                <PitcherCard
                  key={p.id}
                  player={p}
                  team={teamsMap[p.team_id]}
                  selected={selectedPlayer?.id === p.id}
                  onSelect={handleSelectPlayer}
                />
              ))}
              {filteredPitchers.length === 0 && (
                <div className={styles.emptyMsg}>검색 결과 없음</div>
              )}
            </div>

            {/* 선택된 선수 구종 */}
            {hasPlayer && Object.keys(pitchTypes).length > 0 && (
              <div className={styles.pitchTypesWrap}>
                <div className={styles.sectionLabel}>보유 구종</div>
                {Object.entries(pitchTypes)
                  .sort((a, b) => b[1].pct - a[1].pct)
                  .map(([type, { velo, pct }]) => (
                    <PitchTypeBadge key={type} type={type} velo={velo} pct={pct} />
                  ))
                }
              </div>
            )}
          </div>

          {/* ── 가운데: 스트라이크존 ── */}
          <div className={styles.zoneWrap}>
            <svg
              className={styles.zoneSvg}
              viewBox={`0 0 ${SVG_W} ${SVG_H}`}
              width={SVG_W}
              height={SVG_H}
            >
              {/* 배경 */}
              <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#0a0e14" rx={10} />

              {/* 타석 바닥 영역 (존 바깥 하단) */}
              <rect
                x={SVG_CX - SCALE * 2.0}
                y={SVG_CY + ZONE_PX_H / 2 + 4}
                width={SCALE * 4.0}
                height={2}
                fill="#1e2a3a"
                rx={1}
                opacity={0.4}
              />

              {/* 볼 존 영역 (약간 밝게) */}
              <rect
                x={SVG_CX - SCALE * 2.2}
                y={SVG_CY - SCALE * 2.2}
                width={SCALE * 4.4}
                height={SCALE * 4.4}
                fill="#0e1620"
                rx={6}
              />

              {/* 스트라이크존 */}
              <rect
                x={zoneLeft} y={zoneTop}
                width={ZONE_PX_W} height={ZONE_PX_H}
                fill="#111a24"
                stroke="#3a5068"
                strokeWidth={2}
              />

              {/* 9분할 그리드 */}
              {[1, 2].map(i => (
                <React.Fragment key={`g${i}`}>
                  <line
                    x1={zoneLeft + (ZONE_PX_W / 3) * i} y1={zoneTop}
                    x2={zoneLeft + (ZONE_PX_W / 3) * i} y2={zoneTop + ZONE_PX_H}
                    stroke="#253545" strokeWidth={1}
                  />
                  <line
                    x1={zoneLeft} y1={zoneTop + (ZONE_PX_H / 3) * i}
                    x2={zoneLeft + ZONE_PX_W} y2={zoneTop + (ZONE_PX_H / 3) * i}
                    stroke="#253545" strokeWidth={1}
                  />
                </React.Fragment>
              ))}

              {/* 존 +BALL_R 확장선 (걸치면 스트라이크 영역) */}
              <rect
                x={zoneLeft - BALL_PX} y={zoneTop - BALL_PX}
                width={ZONE_PX_W + BALL_PX * 2} height={ZONE_PX_H + BALL_PX * 2}
                fill="none"
                stroke="#3a5068"
                strokeWidth={0.8}
                strokeDasharray="3 4"
                opacity={0.4}
              />

              {/* 이전 투구 잔상 */}
              {recentPitches.slice(1).map((p, i) => {
                if (!p.location) return null;
                const { sx, sy } = toSvg(p.location.x, p.location.y);
                const color = PITCH_COLORS[p.pitchType] || '#888';
                const opacity = Math.max(0.05, 0.28 - i * 0.022);
                return (
                  <circle key={`old-${i}`} cx={sx} cy={sy} r={BALL_PX} fill={color} opacity={opacity} />
                );
              })}

              {/* 최신 투구: 목표 위치 (×) */}
              {lastResult?.target && (() => {
                const { sx, sy } = toSvg(lastResult.target.x, lastResult.target.y);
                return (
                  <g opacity={0.45}>
                    <line x1={sx - 5} y1={sy - 5} x2={sx + 5} y2={sy + 5} stroke="#ccc" strokeWidth={1.5} />
                    <line x1={sx + 5} y1={sy - 5} x2={sx - 5} y2={sy + 5} stroke="#ccc" strokeWidth={1.5} />
                  </g>
                );
              })()}

              {/* 목표→실제 연결선 */}
              {lastResult?.target && lastResult?.location && (() => {
                const from = toSvg(lastResult.target.x, lastResult.target.y);
                const to   = toSvg(lastResult.location.x, lastResult.location.y);
                return (
                  <line
                    x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy}
                    stroke="#ffffff28" strokeWidth={1.2} strokeDasharray="3 3"
                  />
                );
              })()}

              {/* 최신 투구: 실제 위치 */}
              {lastResult?.location && (() => {
                const { sx, sy } = toSvg(lastResult.location.x, lastResult.location.y);
                const col = PITCH_COLORS[lastResult.pitchType] || '#fff';
                const r = lastResult.result || lastResult.type;
                const isStrike = r === 'called_strike';
                return (
                  <g>
                    <circle cx={sx} cy={sy} r={BALL_PX + 5} fill="none" stroke={col} strokeWidth={2} opacity={0.55} />
                    <circle cx={sx} cy={sy} r={BALL_PX} fill={col} stroke="#fff" strokeWidth={1.2} />
                    <text
                      x={sx} y={sy + BALL_PX + 16}
                      textAnchor="middle"
                      fill={isStrike ? '#EF5350' : '#66BB6A'}
                      fontSize={12} fontWeight={700}
                    >
                      {isStrike ? 'S' : 'B'}
                    </text>
                  </g>
                );
              })()}

              {/* 비정상 투구 (위치 없음) */}
              {lastResult && !lastResult.isNormal && !lastResult.location && (
                <text
                  x={SVG_CX} y={SVG_CY}
                  textAnchor="middle"
                  fill="#FFA726" fontSize={18} fontWeight={700}
                >
                  {lastResult.description || lastResult.type}
                </text>
              )}

              {/* 홈플레이트 */}
              {(() => {
                const px = SVG_CX;
                const py = SVG_CY + ZONE_PX_H / 2 + 38;
                const hw = SCALE * 1.0; // 홈플레이트 반폭
                const ht = 14;
                return (
                  <polygon
                    points={`${px},${py + ht} ${px - hw},${py} ${px - hw},${py - ht * 0.5} ${px + hw},${py - ht * 0.5} ${px + hw},${py}`}
                    fill="#1e2a3a" stroke="#4a5a6a" strokeWidth={1.2}
                  />
                );
              })()}

              {/* 좌우 레이블: 안쪽/바깥쪽 */}
              <text x={zoneLeft - 6} y={SVG_CY} textAnchor="end" fill="#3a5068" fontSize={9}>안쪽</text>
              <text x={zoneLeft + ZONE_PX_W + 6} y={SVG_CY} textAnchor="start" fill="#3a5068" fontSize={9}>바깥</text>

              {/* 선수 미선택 안내 */}
              {!hasPlayer && (
                <text x={SVG_CX} y={SVG_CY} textAnchor="middle" fill="#3a5068" fontSize={14} fontWeight={600}>
                  ← 투수를 선택하세요
                </text>
              )}
            </svg>

            {/* 구종 범례 */}
            <div className={styles.legend}>
              {Object.entries(PITCH_COLORS).map(([type, color]) => (
                <div key={type} className={styles.legendItem}>
                  <div className={styles.legendDot} style={{ background: color }} />
                  <span>{PITCH_TYPE_LABELS[type] || type}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── 오른쪽: 컨트롤 패널 ── */}
          <div className={styles.infoPanel}>

            {/* 투수 능력치 */}
            {hasPlayer && (
              <div className={styles.evalCard}>
                <div className={styles.sectionLabel}>투수 능력치</div>
                {[
                  { label: '구위', key: 'stuff' },
                  { label: '제구력', key: 'command' },
                  { label: '컨트롤', key: 'control' },
                  { label: '체력', key: 'stamina' },
                ].map(({ label, key }) => {
                  const v = eval_[key];
                  if (v == null) return null;
                  const pct = ((v - 20) / 60) * 100;
                  return (
                    <div key={key} className={styles.evalRow}>
                      <span className={styles.evalLabel}>{label}</span>
                      <div className={styles.evalBar}>
                        <div className={styles.evalFill} style={{ width: `${pct}%`, background: gradeColor(v) }} />
                      </div>
                      <span className={styles.evalVal} style={{ color: gradeColor(v) }}>{Math.round(v)}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 카운트 */}
            <div className={styles.countDisplay}>
              <span><span className={styles.countLabel}>B</span><span className={styles.countBalls}>{count.balls}</span></span>
              <span><span className={styles.countLabel}>S</span><span className={styles.countStrikes}>{count.strikes}</span></span>
              <span><span className={styles.countLabel}>O</span><span className={styles.countOuts}>{outs}</span></span>
              <span className={styles.pitchNum}>#{pitchCount}구</span>
            </div>

            {/* 투구 버튼 */}
            <button
              className={styles.pitchBtn}
              onClick={throwPitch}
              disabled={!hasPlayer}
            >
              {hasPlayer ? '투구' : '선수를 선택하세요'}
            </button>
            {hasPlayer && (
              <button className={styles.resetBtn} onClick={resetPitching}>리셋</button>
            )}

            {/* 최근 투구 결과 */}
            {lastResult && (
              <div className={styles.resultCard}>
                <div className={styles.sectionLabel}>최근 투구</div>
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>구종</span>
                  <span style={{ color: PITCH_COLORS[lastResult.pitchType], fontWeight: 700, fontSize: 13 }}>
                    {PITCH_TYPE_LABELS[lastResult.pitchType] || '-'}
                  </span>
                </div>
                {lastResult.velocity != null && (
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>구속</span>
                    <span className={styles.resultValue}>{lastResult.velocity} km/h</span>
                  </div>
                )}
                <div className={styles.resultRow}>
                  <span className={styles.resultLabel}>판정</span>
                  <span style={{ color: resultColor(lastResult.result || lastResult.type), fontWeight: 700, fontSize: 14 }}>
                    {resultLabel(lastResult.result || lastResult.type)}
                  </span>
                </div>
                {lastResult.description && (
                  <div className={styles.resultRow}>
                    <span className={styles.resultLabel}>상세</span>
                    <span className={styles.resultValue}>{lastResult.description}</span>
                  </div>
                )}
              </div>
            )}

            {/* 투구 의도 (Reasoning) */}
            {lastResult?.plan?.reasoning?.length > 0 && (
              <div className={styles.reasoningCard}>
                <div className={styles.sectionLabel}>💭 투수의 생각</div>
                {lastResult.plan.reasoning.map((line, i) => (
                  <div key={i} className={styles.reasoningLine}>
                    <span className={styles.reasoningBullet}>·</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 디버그 토글 */}
            {lastResult && (
              <label className={styles.debugToggle}>
                <input type="checkbox" checked={showDebug} onChange={() => setShowDebug(v => !v)} />
                디버그 정보
              </label>
            )}

            {/* 디버그 패널 */}
            {showDebug && lastResult && (
              <div className={styles.debugPanel}>
                <div><span className={styles.dk}>target:</span> <span className={styles.dv}>({lastResult.target?.x?.toFixed(2)}, {lastResult.target?.y?.toFixed(2)})</span></div>
                <div><span className={styles.dk}>actual:</span> <span className={styles.dv}>({lastResult.location?.x?.toFixed(2)}, {lastResult.location?.y?.toFixed(2)})</span></div>
                <div><span className={styles.dk}>offset:</span> <span className={styles.dv}>({((lastResult.location?.x ?? 0) - (lastResult.target?.x ?? 0)).toFixed(2)}, {((lastResult.location?.y ?? 0) - (lastResult.target?.y ?? 0)).toFixed(2)})</span></div>
                <div><span className={styles.dk}>plan:</span> <span className={styles.dv}>{lastResult.plan?.pitchType} @ {lastResult.plan?.targetVelo}km</span></div>
                <div><span className={styles.dk}>normal:</span> <span className={styles.dv}>{String(lastResult.isNormal)}</span></div>
                <div><span className={styles.dk}>#pitches:</span> <span className={styles.dv}>{pitchCount}</span></div>
              </div>
            )}

            {/* 투구 로그 */}
            {pitchLog.length > 0 && (
              <div className={styles.resultCard}>
                <div className={styles.sectionLabel}>투구 로그</div>
                <div className={styles.logWrap}>
                  {pitchLog.map((p, i) => {
                    const r = p.result || p.type;
                    return (
                      <div key={i} className={styles.logRow}>
                        <span className={styles.logNum}>{p.pitchNumber}</span>
                        <span style={{ color: PITCH_COLORS[p.pitchType] || '#888', fontWeight: 600, fontSize: 11, minWidth: 56 }}>
                          {PITCH_TYPE_LABELS[p.pitchType] || p.type || '-'}
                        </span>
                        <span className={styles.logVelo}>{p.velocity != null ? `${p.velocity}k` : '-'}</span>
                        <span style={{ color: resultColor(r), fontWeight: 600, fontSize: 11 }}>
                          {resultLabel(r)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
