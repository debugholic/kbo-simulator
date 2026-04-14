import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { PitchSimulator, toPitcherProfile, PITCH_TYPE_LABELS, ZONE_X, ZONE_Y, BALL_R } from '../simulator/PitchSimulator';
import { BattingSimulator, BATTED_BALL_LABELS, DEFAULT_PITCHER_PROFILE, DEFAULT_BATTER_PROFILE } from '../simulator/BattingSimulator';
import {
  createGameState, createDefaultLineup,
  judgeInPlay, processAtBat,
  getAttackingSide, getDefendingSide, inningLabel,
} from '../simulator/gameEngine';
import { getOverall, getPositionGroup, getTeamDisplayColor } from '../utils';
import styles from './GamePlaySimDemo.module.css';

// ── SVG 좌표계 ──────────────────────────────────────────────────
const SVG_W   = 380;
const SVG_H   = 420;
const SVG_CX  = SVG_W / 2;
const SVG_CY  = 200;
const SCALE   = 66;
const ZONE_PX_W = ZONE_X * 2 * SCALE;
const ZONE_PX_H = ZONE_Y * 2 * SCALE;
const BALL_PX   = BALL_R * SCALE;
const zoneLeft  = SVG_CX - ZONE_PX_W / 2;
const zoneTop   = SVG_CY - ZONE_PX_H / 2;

function toSvg(x, y) { return { sx: SVG_CX + x * SCALE, sy: SVG_CY - y * SCALE }; }

// ── 야구장 필드 ──────────────────────────────────────────────────
const FIELD_W = 340;
const FIELD_H = 220;
const FHX = 170; const FHY = 200; const FS = 1.3;

function fieldPos(direction, distM) {
  const angRad = ((direction - 90) / 2) * Math.PI / 180;
  return { fx: FHX + distM * FS * Math.sin(angRad), fy: FHY - distM * FS * Math.cos(angRad) };
}
function calcLandingDist(bat) {
  if (!bat || bat.action !== 'swing' || bat.result !== 'contact') return null;
  const t = bat.type;
  const v = bat.exitVelo / 3.6;
  const rad = (bat.launchAngle || 0) * Math.PI / 180;
  if (t === 'grounder')  return Math.min(95, 15 + v * 1.4);
  if (t === 'popup')     return Math.min(50, 10 + v * 0.6);
  if (t === 'foul')      return Math.min(60, 8 + v * 0.9);
  if (t === 'foul_back') return Math.min(20, 4 + v * 0.4);
  return Math.min(160, Math.max(20, v * v * Math.sin(2 * rad) / 9.8 * 0.62));
}

const WALL_R = 118 * FS;
const BASE_D = 27;
const B1 = fieldPos(180, BASE_D); const B2 = fieldPos(90, BASE_D * Math.SQRT2);
const B3 = fieldPos(0, BASE_D);   const MOUND = fieldPos(90, 18.4);
const FL3 = fieldPos(0, 118);     const FL1 = fieldPos(180, 118);

const BATTED_BALL_COLORS = {
  grounder: '#FFA726', line_drive: '#66BB6A',
  fly_ball: '#42A5F5', deep_fly: '#1565C0', popup: '#9E9E9E', home_run: '#FF6F00',
};
const PITCH_COLORS = {
  '4seam': '#EF5350', '2seam': '#FF7043', sinker: '#FFA726', cutter: '#AB47BC',
  slider: '#42A5F5', curve: '#66BB6A', changeup: '#FFCA28', fork: '#78909C', knuckle: '#8D6E63',
};

// ── 유틸 함수 ───────────────────────────────────────────────────
function gradeColor(v) {
  if (v >= 70) return '#E53935';
  if (v >= 60) return '#FB8C00';
  if (v >= 50) return '#43A047';
  if (v >= 40) return '#1E88E5';
  return '#757575';
}
function resultLabel(r) {
  return { called_strike: '스트라이크', ball: '볼', wild_pitch: '폭투', hit_by_pitch: '몸맞공', balk: '보크' }[r] || r || '-';
}
function resultColor(r) {
  if (r === 'called_strike') return '#EF5350';
  if (r === 'ball') return '#66BB6A';
  return '#FFA726';
}
function swingTypeLabel(t) {
  return { check_swing: '체크스윙', check_swing_held: '체크(멈춤)', late_swing: '늦은스윙', normal_swing: '일반스윙', full_swing: '풀스윙' }[t] || t || '-';
}

function buildSimProfile(player) {
  return toPitcherProfile({
    ...player,
    eval: player.pitcherEval || {},
    pitchStats: player.pitchStats || {},
    attributes: player.attributes_obj || player.attributes || {},
  });
}

// ── 서브 컴포넌트: 투수 카드 ────────────────────────────────────
function PitcherCard({ player, team, selected, onSelect }) {
  const ev = player.pitcherEval || {};
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
        {overall != null && <span className={styles.pitcherCardOvr} style={{ color: gradeColor(overall) }}>{overall}</span>}
      </div>
      {team && <div className={styles.pitcherCardTeam} style={{ color }}>{team.name_kor}</div>}
      <div className={styles.pitcherCardStats}>
        {ev.stuff   != null && <span>구위 <b style={{ color: gradeColor(ev.stuff) }}>{Math.round(ev.stuff)}</b></span>}
        {ev.command != null && <span>제구 <b style={{ color: gradeColor(ev.command) }}>{Math.round(ev.command)}</b></span>}
        {ev.control != null && <span>컨트 <b style={{ color: gradeColor(ev.control) }}>{Math.round(ev.control)}</b></span>}
        {ev.stamina != null && <span>체력 <b style={{ color: gradeColor(ev.stamina) }}>{Math.round(ev.stamina)}</b></span>}
      </div>
    </button>
  );
}

// ── 서브 컴포넌트: 스코어보드 ───────────────────────────────────
function Scoreboard({ gs, awayName, homeName, awayPitcher, homePitcher, count, outs, pitchCount }) {
  const bases = gs.bases;
  const bSize = 10;
  return (
    <div style={{ background: '#0d1520', border: '1px solid #2a3a50', borderRadius: 10, padding: '8px 12px', marginBottom: 6 }}>
      {/* 이닝 + 점수 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#42A5F5', minWidth: 70 }}>{inningLabel(gs)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ fontSize: 13, color: '#ccd6f6', fontWeight: 600 }}>{awayName}</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#fff', minWidth: 28, textAlign: 'right' }}>{gs.score.away}</span>
          <span style={{ color: '#4a5a6a', fontSize: 14 }}>-</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: '#fff', minWidth: 28 }}>{gs.score.home}</span>
          <span style={{ fontSize: 13, color: '#ccd6f6', fontWeight: 600 }}>{homeName}</span>
        </div>
        {/* 베이스 다이아몬드 */}
        <svg width={42} height={42} viewBox="0 0 42 42">
          {/* 연결선 */}
          <polyline points="21,5 37,21 21,37 5,21 21,5" fill="none" stroke="#2a3a50" strokeWidth={1.2}/>
          {/* 3루 (left) */}
          <rect x={2} y={18} width={6} height={6} transform="rotate(45 5 21)"
            fill={bases[2] ? '#FFA726' : '#1e2a3a'} stroke="#3a5068" strokeWidth={1}/>
          {/* 2루 (top) */}
          <rect x={18} y={2} width={6} height={6} transform="rotate(45 21 5)"
            fill={bases[1] ? '#FFA726' : '#1e2a3a'} stroke="#3a5068" strokeWidth={1}/>
          {/* 1루 (right) */}
          <rect x={34} y={18} width={6} height={6} transform="rotate(45 37 21)"
            fill={bases[0] ? '#FFA726' : '#1e2a3a'} stroke="#3a5068" strokeWidth={1}/>
          {/* 홈플레이트 */}
          <polygon points="21,40 17,36 17,32 25,32 25,36" fill="#bbb" stroke="#888" strokeWidth={0.5}/>
        </svg>
      </div>
      {/* 카운트 + 아웃 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {/* 볼 3개 */}
        <div style={{ display: 'flex', gap: 3 }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: i < count.balls ? '#66BB6A' : '#1e2a3a', border: '1px solid #3a5068' }} />
          ))}
        </div>
        <span style={{ color: '#2a3a50', fontSize: 10 }}>│</span>
        {/* 스트라이크 2개 (노란색) */}
        <div style={{ display: 'flex', gap: 3 }}>
          {[0,1].map(i => (
            <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: i < count.strikes ? '#FFCA28' : '#1e2a3a', border: '1px solid #3a5068' }} />
          ))}
        </div>
        <span style={{ color: '#2a3a50', fontSize: 10 }}>│</span>
        {/* 아웃 2개 (빨간색) */}
        <div style={{ display: 'flex', gap: 3 }}>
          {[0,1].map(i => (
            <div key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: i < outs ? '#EF5350' : '#1e2a3a', border: '1px solid #3a5068' }} />
          ))}
        </div>
        {/* 투구 수 */}
        {pitchCount > 0 && (
          <>
            <span style={{ color: '#2a3a50', fontSize: 10 }}>│</span>
            <span style={{ fontSize: 10, color: '#8892b0' }}>
              <b style={{ color: '#ccd6f6' }}>{pitchCount}</b>구
              <span style={{ color: '#FFCA28', marginLeft: 4 }}>{count.strikes}S</span>
              <span style={{ color: '#66BB6A', marginLeft: 3 }}>{count.balls}B</span>
            </span>
          </>
        )}
        {/* 현재 매치업 */}
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#4a5a6a' }}>
          {awayPitcher?.name_kor || '디폴트'} vs {homePitcher?.name_kor || '디폴트'}
        </span>
      </div>
    </div>
  );
}

// ── 서브 컴포넌트: 팀 기록 ──────────────────────────────────────
function TeamStats({ gs }) {
  const sides = ['away', 'home'];
  const labels = ['원정', '홈'];
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
      {sides.map((side, si) => {
        const s = gs.stats[side];
        const ps = gs.pitcherStats[side === 'away' ? 'home' : 'away'];
        return (
          <div key={side} style={{ flex: 1, background: '#0d1520', border: '1px solid #1e2a3a', borderRadius: 8, padding: '5px 8px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#42A5F5', marginBottom: 3 }}>{labels[si]} 팀</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 10, color: '#8892b0' }}>
              <span>타수 <b style={{ color: '#ccd6f6' }}>{s.ab}</b></span>
              <span>안타 <b style={{ color: '#66BB6A' }}>{s.h}</b></span>
              <span>홈런 <b style={{ color: '#FF6F00' }}>{s.hr}</b></span>
              <span>타점 <b style={{ color: '#FFA726' }}>{s.rbi || 0}</b></span>
              <span>볼넷 <b style={{ color: '#ccd6f6' }}>{s.bb}</b></span>
              <span>삼진 <b style={{ color: '#EF5350' }}>{s.so}</b></span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 서브 컴포넌트: 경기 로그 ────────────────────────────────────
function GameLog({ log }) {
  if (!log.length) return null;
  return (
    <div style={{ background: '#0a0e14', border: '1px solid #1e2a3a', borderRadius: 8, padding: '6px 8px', maxHeight: 160, overflowY: 'auto' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#4a5a6a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>경기 기록</div>
      {log.slice(0, 40).map((line, i) => (
        <div key={i} style={{
          fontSize: 11, padding: '2px 2px', color: '#8892b0', borderBottom: '1px solid #ffffff08',
          color: line.includes('홈런') ? '#FF6F00' : line.includes('2루타') || line.includes('3루타') ? '#66BB6A' : line.includes('안타') ? '#FFCA28' : line.includes('볼넷') ? '#42A5F5' : line.includes('삼진') ? '#EF5350' : '#8892b0',
        }}>
          {line}
        </div>
      ))}
    </div>
  );
}

// ── 서브 컴포넌트: 야구장 필드 ──────────────────────────────────
function FieldView({ battedBalls, lastBatting }) {
  const [ballPos, setBallPos] = useState(null);
  const rafRef      = useRef(null);
  const startRef    = useRef(null);
  const phaseRef    = useRef('idle'); // 'flight' | 'rolling'
  const rollTimeRef = useRef(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    phaseRef.current = 'idle';
    rollTimeRef.current = null;

    if (!lastBatting || lastBatting.result !== 'contact') { setBallPos(null); return; }
    const dist = calcLandingDist(lastBatting);
    if (!dist) { setBallPos(null); return; }

    const isGrounder = lastBatting.type === 'grounder';

    let toX, toY;
    if (lastBatting.type === 'foul_back') {
      toX = FHX; toY = FHY + 14;
    } else {
      const p = fieldPos(lastBatting.direction, dist);
      toX = p.fx; toY = p.fy;
    }

    const arcH = lastBatting.type === 'home_run'  ? 85
               : lastBatting.type === 'deep_fly'   ? 65
               : lastBatting.type === 'fly_ball'   ? 50
               : lastBatting.type === 'popup'      ? 40
               : lastBatting.type === 'line_drive' ? 20
               : lastBatting.type === 'foul'       ? 25
               : lastBatting.type === 'foul_back'  ? 10
               : 4; // grounder — 낮은 바운드

    const midX = (FHX + toX) / 2;
    const midY = (FHY + toY) / 2 - arcH;
    const FLIGHT_DUR = isGrounder ? 380 : 700;

    // 굴러가는 방향 단위벡터 (타구 방향과 동일)
    const dx = toX - FHX;
    const dy = toY - FHY;
    const mag = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / mag;
    const uy = dy / mag;
    const ROLL_EXTRA = 50; // SVG px 추가 구름 거리
    const ROLL_DUR   = 2800;

    startRef.current = null;
    phaseRef.current = 'flight';

    const animate = (now) => {
      if (!startRef.current) startRef.current = now;

      if (phaseRef.current === 'flight') {
        const t   = Math.min((now - startRef.current) / FLIGHT_DUR, 1);
        const inv = 1 - t;
        const cx  = inv * inv * FHX + 2 * inv * t * midX + t * t * toX;
        const cy  = inv * inv * FHY + 2 * inv * t * midY + t * t * toY;
        setBallPos({ cx, cy });

        if (t < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else if (isGrounder) {
          // 첫 바운드 후 구름 페이즈 시작
          phaseRef.current = 'rolling';
          rollTimeRef.current = now;
          rafRef.current = requestAnimationFrame(animate);
        } else {
          rafRef.current = null;
          // 비땅볼: 착지점에서 0.5초 후 사라짐
          setTimeout(() => setBallPos(null), 500);
        }
      } else {
        // 구름 페이즈: quadratic ease-out 감속
        const rollT    = Math.min((now - rollTimeRef.current) / ROLL_DUR, 1);
        const progress = 1 - Math.pow(1 - rollT, 2);
        setBallPos({ cx: toX + ux * ROLL_EXTRA * progress, cy: toY + uy * ROLL_EXTRA * progress });

        if (rollT < 1) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          rafRef.current = null;
          // 수비수 픽업 전까지 공 위치 유지 (사라지지 않음)
        }
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [lastBatting]);

  const lastBall = useMemo(() => {
    if (!lastBatting) return null;
    const dist = calcLandingDist(lastBatting);
    if (!dist) return null;
    if (lastBatting.type === 'foul_back') {
      return { fx: FHX, fy: FHY + 14, type: lastBatting.type, dist };
    }
    return { ...fieldPos(lastBatting.direction, dist), type: lastBatting.type, dist };
  }, [lastBatting]);

  return (
    <svg viewBox={`0 0 ${FIELD_W} ${FIELD_H}`} width={FIELD_W} height={FIELD_H} style={{ borderRadius: 8, display: 'block' }}>
      <rect x={0} y={0} width={FIELD_W} height={FIELD_H} fill="#0a0e14" rx={8} />
      {/* Fair territory fan */}
      <path d={`M ${FHX},${FHY} L ${FL3.fx},${FL3.fy} A ${WALL_R},${WALL_R} 0 0,1 ${FL1.fx},${FL1.fy} Z`} fill="#0d1f0d" />
      <circle cx={FHX} cy={FHY - 38 * FS} r={28 * FS} fill="#1a1408" opacity={0.6} />
      <path d={`M ${FL3.fx},${FL3.fy} A ${WALL_R},${WALL_R} 0 0,1 ${FL1.fx},${FL1.fy}`} fill="none" stroke="#3a5068" strokeWidth={1.5} strokeDasharray="5 3" />
      <line x1={FHX} y1={FHY} x2={FL3.fx} y2={FL3.fy} stroke="#3a506888" strokeWidth={1} />
      <line x1={FHX} y1={FHY} x2={FL1.fx} y2={FL1.fy} stroke="#3a506888" strokeWidth={1} />
      <polygon points={`${FHX},${FHY} ${B1.fx},${B1.fy} ${B2.fx},${B2.fy} ${B3.fx},${B3.fy}`} fill="none" stroke="#4a5a6a55" strokeWidth={1} />
      <circle cx={MOUND.fx} cy={MOUND.fy} r={3.5} fill="#2a1e14" stroke="#4a5a6a" strokeWidth={0.8} />
      {[B1, B2, B3].map((b, i) => (
        <rect key={i} x={b.fx - 3} y={b.fy - 3} width={6} height={6} fill="#ddd" transform={`rotate(45 ${b.fx} ${b.fy})`} />
      ))}
      <polygon points={`${FHX},${FHY + 4} ${FHX - 4},${FHY} ${FHX - 4},${FHY - 2.5} ${FHX + 4},${FHY - 2.5} ${FHX + 4},${FHY}`} fill="#ddd" />
      {[55, 85, 115].map(d => {
        const r2 = d * FS;
        const lp = fieldPos(90, d);
        return (
          <g key={d} opacity={0.2}>
            <path d={`M ${FHX - r2 * 0.71},${FHY - r2 * 0.71} A ${r2},${r2} 0 0,1 ${FHX + r2 * 0.71},${FHY - r2 * 0.71}`} fill="none" stroke="#4a5a6a" strokeWidth={0.5} strokeDasharray="2 4" />
            <text x={lp.fx + 12} y={lp.fy + 3} fill="#4a5a6a" fontSize={7}>{d}m</text>
          </g>
        );
      })}
      {/* Previous balls (history dots) */}
      {battedBalls.slice(1, 20).map((b, i) => (
        <circle key={i} cx={b.fx} cy={b.fy} r={3.5} fill={BATTED_BALL_COLORS[b.type] || '#888'} opacity={Math.max(0.06, 0.30 - i * 0.015)} />
      ))}
      {/* Landing marker */}
      {lastBall && (
        <g>
          <circle cx={lastBall.fx} cy={lastBall.fy} r={7} fill="none" stroke="#ffffff" strokeWidth={1.8} opacity={0.5} />
          <circle cx={lastBall.fx} cy={lastBall.fy} r={4.5} fill={BATTED_BALL_COLORS[lastBall.type] || '#fff'} stroke="#fff" strokeWidth={1} />
          <text x={lastBall.fx} y={lastBall.fy - 10} textAnchor="middle" fill="#fff" fontSize={9} fontWeight={700}>{BATTED_BALL_LABELS[lastBall.type] || ''}</text>
          <text x={lastBall.fx} y={lastBall.fy + 15} textAnchor="middle" fill="#8892b0" fontSize={7}>{Math.round(lastBall.dist)}m</text>
        </g>
      )}
      {/* Ball flight / roll animation — 항상 흰색 */}
      {ballPos && (
        <circle cx={ballPos.cx} cy={ballPos.cy} r={5} fill="#ffffff" opacity={0.92} stroke="#cccccc" strokeWidth={0.8} />
      )}
      <text x={FL3.fx - 3} y={FL3.fy + 12} textAnchor="end" fill="#4a5a6a" fontSize={8}>LF</text>
      <text x={FHX} y={FHY - WALL_R - 4} textAnchor="middle" fill="#4a5a6a" fontSize={8}>CF</text>
      <text x={FL1.fx + 3} y={FL1.fy + 12} textAnchor="start" fill="#4a5a6a" fontSize={8}>RF</text>
    </svg>
  );
}

// ── 서브 컴포넌트: 단계별 알고리즘 디버그 패널 ──────────────────────
function NarrativeBar({ pitchSrc, batSrc, pitchReveal, batReveal }) {
  if (!pitchSrc && !batSrc) return null;

  const PT = PITCH_TYPE_LABELS;
  const BL = BATTED_BALL_LABELS;

  // 단계 행 렌더
  const Step = ({ tag, tagColor, children }) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0', borderBottom: '1px solid #0e1824' }}>
      <span style={{
        fontSize: 9, fontWeight: 800, color: tagColor,
        background: `${tagColor}22`, border: `1px solid ${tagColor}44`,
        borderRadius: 4, padding: '1px 5px', flexShrink: 0, letterSpacing: '0.05em',
      }}>{tag}</span>
      <span style={{ fontSize: 11, color: '#ccd6f6', lineHeight: 1.6, flexWrap: 'wrap', display: 'flex', gap: '0 6px', alignItems: 'baseline' }}>
        {children}
      </span>
    </div>
  );
  const Kv = ({ k, v, vc }) => (
    <span><span style={{ color: '#4a6a8a', fontSize: 10 }}>{k} </span><b style={{ color: vc || '#ccd6f6' }}>{v}</b></span>
  );
  const Sep = () => <span style={{ color: '#2a3a50' }}>·</span>;

  const steps = [];

  // ① 투수 계획
  if (pitchReveal.plan && pitchSrc?.plan) {
    const p = pitchSrc.plan;
    const pColor = PITCH_COLORS[pitchSrc.pitchType] || '#ccc';
    steps.push(
      <Step key="p-plan" tag="투수 계획" tagColor="#4a8aaa">
        <Kv k="구종" v={PT[pitchSrc.pitchType] || pitchSrc.pitchType} vc={pColor} />
        <Sep/>
        <Kv k="목표구속" v={`${p.targetVelo}km`} />
        {p.locationZone && <><Sep/><Kv k="목표존" v={p.locationZone} /></>}
        {p.reasoning?.slice(0, 2).map((r, i) => <><Sep/><span key={i} style={{ color: '#4a6a7a', fontSize: 10 }}>{r}</span></>)}
      </Step>
    );
  }

  // ② 투수 실행 + 판정
  if (pitchReveal.exec && pitchSrc?.pitchQuality != null) {
    const q = pitchSrc.pitchQuality;
    const qColor = q >= 70 ? '#66BB6A' : q >= 40 ? '#FFCA28' : '#EF5350';
    const r = pitchSrc.result || pitchSrc.type;
    steps.push(
      <Step key="p-exec" tag="투수 실행" tagColor="#3a7090">
        <Kv k="실제구속" v={`${pitchSrc.velocity}km/h`} />
        <Sep/>
        <Kv k="퀄리티" v={q} vc={qColor} />
        {pitchSrc.qualityDetail?.isMistake && <><Sep/><span style={{ color: '#EF5350', fontWeight: 700 }}>실수!</span></>}
        {pitchSrc.location && <><Sep/><Kv k="착점" v={`(${pitchSrc.location.x?.toFixed(2)}, ${pitchSrc.location.y?.toFixed(2)})`} /></>}
        {pitchReveal.judge && <><Sep/><Kv k="판정" v={resultLabel(r)} vc={resultColor(r)} /></>}
      </Step>
    );
  }

  // ③ 타자 계획
  if (batReveal.plan && batSrc?.plan) {
    const bp = batSrc.plan;
    const tacticLabel = bp.tactic === 'take' ? '테이크' : bp.tactic === 'contact' ? '컨택' : '풀스윙';
    const tacticColor = bp.tactic === 'take' ? '#546E7A' : bp.tactic === 'contact' ? '#42A5F5' : '#AB47BC';
    const biasStr = bp.biasStrength != null ? `${bp.biasStrength > 0 ? '+' : ''}${Math.round(bp.biasStrength * 100)}%` : null;
    steps.push(
      <Step key="b-plan" tag="타자 계획" tagColor="#8a4aaa">
        <Kv k="전략" v={tacticLabel} vc={tacticColor} />
        <Sep/>
        <Kv k="예측구종" v={bp.predictedPitchType ? (PT[bp.predictedPitchType] || bp.predictedPitchType) : '없음'} vc={bp.predictedPitchType ? (PITCH_COLORS[bp.predictedPitchType] || '#ccc') : '#546E7A'} />
        {biasStr && <><Sep/><Kv k="예측신뢰도" v={biasStr} vc={parseFloat(biasStr) >= 0 ? '#66BB6A' : '#EF5350'} /></>}
        <Sep/>
        <Kv k="목표스윙Lv" v={bp.targetSwingLevel} />
        {bp.targetBallResult && <><Sep/><Kv k="목표타구" v={bp.targetBallResult} /></>}
      </Step>
    );
  }

  // ④ 타자 판단
  if (batReveal.judgment && batSrc?.judgment) {
    const j = batSrc.judgment;
    const jtColor = j.judgmentType === 'bias_confirmed' ? '#66BB6A'
                  : j.judgmentType === 'accurate_neutral' ? '#81C784'
                  : j.judgmentType === 'bias_interfered'  ? '#FFA726'
                  : j.judgmentType === 'category_confused' ? '#EF5350'
                  : '#90A4AE';
    const jtLabel = j.judgmentType === 'bias_confirmed'  ? '선입견강화'
                  : j.judgmentType === 'accurate_neutral' ? '정확판단'
                  : j.judgmentType === 'neutral'          ? '중립'
                  : j.judgmentType === 'bias_interfered'  ? '선입견방해'
                  : '계열혼동';
    steps.push(
      <Step key="b-judge" tag="타자 판단" tagColor="#aa7a2a">
        <Kv k="실제구종" v={PT[j.actualPitchType] || j.actualPitchType || '-'} vc={PITCH_COLORS[j.actualPitchType] || '#ccc'} />
        <Sep/>
        <Kv k="인식구종" v={PT[j.judgedPitchType] || j.judgedPitchType || '-'} vc={j.judgedPitchType !== j.actualPitchType ? '#FFA726' : '#ccd6f6'} />
        <Sep/>
        <Kv k="판단" v={jtLabel} vc={jtColor} />
        <Sep/>
        <Kv k="swingMod" v={`×${j.swingMod}`} vc={j.swingMod >= 1.05 ? '#66BB6A' : j.swingMod <= 0.75 ? '#EF5350' : '#FFA726'} />
        <Sep/>
        <Kv k="예측적중" v={j.predictedCorrect ? '✓' : '✗'} vc={j.predictedCorrect ? '#66BB6A' : '#EF5350'} />
        {j.locationBias !== 0 && <><Sep/><Kv k="위치편향" v={j.locationBias > 0 ? `+${j.locationBias}` : j.locationBias} vc={j.locationBias > 0.05 ? '#FFA726' : '#8892b0'} /></>}
      </Step>
    );
  }

  // ⑤ 스윙 결정
  if (batReveal.judgment && batSrc?.overlap != null) {
    const didSwing = batSrc.action === 'swing';
    steps.push(
      <Step key="b-swing" tag="스윙 결정" tagColor="#2a7aaa">
        <Kv k="오버랩" v={batSrc.overlap} vc="#42A5F5" />
        <Sep/>
        <Kv k="기준" v={batSrc.threshold} />
        <Sep/>
        <span style={{ fontWeight: 700, color: didSwing ? '#66BB6A' : '#546E7A' }}>{didSwing ? '▶ 스윙' : '— 노스윙'}</span>
        {didSwing && batSrc.swingLevel != null && <>
          <Sep/>
          <Kv k="스윙Lv" v={batSrc.swingLevel} vc="#42A5F5" />
          <Sep/>
          <Kv k="타입" v={swingTypeLabel(batSrc.swingType)} vc="#ccd6f6" />
        </>}
      </Step>
    );
  }

  // ⑥ 결과
  if (batReveal.result && batSrc) {
    let resultContent;
    if (batSrc.action === 'take') {
      resultContent = <span style={{ color: '#546E7A', fontWeight: 600 }}>노스윙 (볼데드)</span>;
    } else if (batSrc.result === 'whiff') {
      resultContent = <>
        <span style={{ color: '#EF5350', fontWeight: 700 }}>헛스윙</span>
        <Sep/>
        <Kv k="헛스윙확률" v={`${Math.round((batSrc.whiffProb ?? 0) * 100)}%`} vc="#EF5350" />
        <Sep/>
        <Kv k="위치오차" v={batSrc.locationError} />
      </>;
    } else if (batSrc.result === 'contact') {
      const t = batSrc.type;
      const isFoul = t === 'foul' || t === 'foul_back';
      resultContent = <>
        <Kv k="타구" v={BL[t] || t} vc={BATTED_BALL_COLORS[t] || '#90A4AE'} />
        <Sep/>
        <Kv k="컨택퀄리티" v={batSrc.quality} vc={batSrc.quality >= 60 ? '#66BB6A' : batSrc.quality >= 35 ? '#FFCA28' : '#EF5350'} />
        {!isFoul && <>
          <Sep/><Kv k="타구속도" v={`${batSrc.exitVelo}km/h`} />
          <Sep/><Kv k="발사각" v={`${batSrc.launchAngle}°`} />
          <Sep/><Kv k="방향" v={`${batSrc.direction}°`} />
          {batSrc.estDist && <><Sep/><Kv k="거리" v={`${batSrc.estDist}m`} vc="#FFA726" /></>}
        </>}
      </>;
    }
    if (resultContent) {
      steps.push(<Step key="b-result" tag="결과" tagColor="#2a9a4a">{resultContent}</Step>);
    }
  }

  // 빈 행 채우기 (6개 고정)
  const TOTAL_ROWS = 6;
  while (steps.length < TOTAL_ROWS) {
    steps.push(
      <div key={`empty-${steps.length}`} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '2px 0', borderBottom: '1px solid #0e1824', minHeight: 22,
      }}>
        <span style={{ fontSize: 9, color: '#1e2a3a', padding: '1px 5px' }}>—</span>
      </div>
    );
  }

  return (
    <div style={{
      borderTop: '2px solid #1e2a3a', background: '#060a10',
      padding: '4px 20px 4px', flexShrink: 0,
    }}>
      {steps}
    </div>
  );
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────
export default function GamePlaySimDemo({ onClose, players = [], teamsMap = {} }) {
  const pitchers = useMemo(() =>
    players
      .filter(p => getPositionGroup(p.position) === 'pitcher' && p.pitcherEval != null)
      .sort((a, b) => (getOverall(b) ?? 0) - (getOverall(a) ?? 0)),
    [players]
  );

  // ── 팀 설정 ──────────────────────────────────────────────────
  const [activeTeamTab, setActiveTeamTab] = useState('away'); // 좌측 패널 탭
  const [searchAway, setSearchAway] = useState('');
  const [searchHome, setSearchHome]  = useState('');
  const [awayPitcher, setAwayPitcher] = useState(null);
  const [homePitcher, setHomePitcher]  = useState(null);

  const filteredPitchersAway = useMemo(() => {
    const q = searchAway.trim().toLowerCase();
    return (q ? pitchers.filter(p => p.name_kor.toLowerCase().includes(q) || (p.name_eng && p.name_eng.toLowerCase().includes(q))) : pitchers).slice(0, 40);
  }, [pitchers, searchAway]);

  const filteredPitchersHome = useMemo(() => {
    const q = searchHome.trim().toLowerCase();
    return (q ? pitchers.filter(p => p.name_kor.toLowerCase().includes(q) || (p.name_eng && p.name_eng.toLowerCase().includes(q))) : pitchers).slice(0, 40);
  }, [pitchers, searchHome]);

  // ── 라인업 ────────────────────────────────────────────────────
  const [lineupAway] = useState(() => createDefaultLineup('away'));
  const [lineupHome] = useState(() => createDefaultLineup('home'));

  // ── 시뮬레이터 refs ──────────────────────────────────────────
  const simAwayRef = useRef(null); // 홈팀 투수 (원정 공격 시 상대)
  const simHomeRef = useRef(null); // 원정팀 투수 (홈 공격 시 상대)
  const batRef     = useRef(null);
  const [simReady, setSimReady] = useState(false);

  // ── 게임 상태 ──────────────────────────────────────────────────
  const [gs, setGs]               = useState(() => createGameState());
  const [feedback, setFeedback]   = useState(null);
  const [lastResult, setLastResult]   = useState(null);
  const [lastBatting, setLastBatting] = useState(null);
  const [pitchLog, setPitchLog]   = useState([]);

  // 단계별 실행 상태
  // null → 'p_plan' → 'b_plan' → 'pitching' → 'judging' → 'batting' → 'done'
  const [simStep, setSimStep]           = useState(null);
  const [pendingPitch, setPendingPitch] = useState(null);
  const [pendingBat,   setPendingBat]   = useState(null);
  const [arrivedPitch, setArrivedPitch] = useState(null);
  const gsRef = useRef(null);
  useEffect(() => { gsRef.current = gs; }, [gs]);
  const feedbackRef = useRef(null);
  useEffect(() => { feedbackRef.current = feedback; }, [feedback]);

  // 타석 상태: 볼/스트라이크 누적 (gs.count 와 별개로 실시간 관리)
  const countRef = useRef({ balls: 0, strikes: 0 });

  // ── 초기화 ────────────────────────────────────────────────────
  useEffect(() => {
    simAwayRef.current = new PitchSimulator(DEFAULT_PITCHER_PROFILE);
    simHomeRef.current = new PitchSimulator(DEFAULT_PITCHER_PROFILE);
    batRef.current     = new BattingSimulator(DEFAULT_BATTER_PROFILE);
    countRef.current   = { balls: 0, strikes: 0 };
    setSimReady(true);
  }, []);

  const getCurrentPitcherSim = useCallback((curGs) => {
    // 원정 공격 시 → 홈팀 투수(simHomeRef), 홈 공격 시 → 원정팀 투수(simAwayRef)
    return curGs.topBottom === 'top' ? simHomeRef.current : simAwayRef.current;
  }, []);

  const getCurrentBatter = useCallback((curGs) => {
    const side = getAttackingSide(curGs);
    const lineup = side === 'away' ? lineupAway : lineupHome;
    const idx = curGs.lineupIdx[side];
    return lineup[idx % lineup.length];
  }, [lineupAway, lineupHome]);

  // 투수 선택
  const handleSelectPitcher = useCallback((player, side) => {
    const profile = buildSimProfile(player);
    if (side === 'away') {
      setAwayPitcher(player);
      simAwayRef.current = new PitchSimulator(profile);
    } else {
      setHomePitcher(player);
      simHomeRef.current = new PitchSimulator(profile);
    }
  }, []);

  // ── 단계별 실행 ───────────────────────────────────────────────
  const advanceStep = useCallback(() => {
    if (!simReady || gs.isGameOver) return;

    // ① 투구 계획 수립: 모든 시뮬레이션을 계산하고 투수 계획만 공개
    if (simStep === null || simStep === 'done') {
      const curGs      = gsRef.current;
      const pitcherSim = getCurrentPitcherSim(curGs);
      if (!pitcherSim) return;
      const count  = { ...countRef.current };
      const batter = getCurrentBatter(curGs);

      if (!batRef.current || batRef.current._batterId !== batter.id) {
        batRef.current = new BattingSimulator({ ...batter });
        batRef.current._batterId = batter.id;
      }

      const pitchResult = pitcherSim.simulate(count, { outs: curGs.outs }, feedbackRef.current);
      let batResult = null;
      if (pitchResult.isNormal && pitchResult.location) {
        const knownPitchTypes = pitcherSim.pitchTypes?.map(p => p.type) ?? [];
        batResult = batRef.current.simulate(pitchResult, count, 'R', knownPitchTypes);
      }

      setPendingPitch(pitchResult);
      setPendingBat(batResult);
      setArrivedPitch(null);
      setLastBatting(null);
      setSimStep('p_plan');
      return;
    }

    // ② 타자 계획 수립
    if (simStep === 'p_plan') { setSimStep('b_plan'); return; }

    // ③ 투구 실행
    if (simStep === 'b_plan') {
      setArrivedPitch(pendingPitch);
      setLastResult(pendingPitch);
      setFeedback(pendingPitch?.feedback ?? null);
      setSimStep('pitching');
      return;
    }

    // ④ 타자 투구 판단
    if (simStep === 'pitching') { setSimStep('judging'); return; }

    // ⑤ 타격 실행 (스윙 or 테이크 + 볼 애니메이션 시작)
    if (simStep === 'judging') {
      setLastBatting(pendingBat);
      setSimStep('batting');
      return;
    }

    // ⑥ 결과 확인: 게임 상태 갱신
    if (simStep === 'batting') {
      const curGs  = gsRef.current;
      const batter = getCurrentBatter(curGs);
      const pitcherSim = getCurrentPitcherSim(curGs);

      if (pendingPitch?.isNormal) pitcherSim?.applyBattingFeedback(pendingPitch, pendingBat);
      if (pendingBat) batRef.current?.applyBallDeadFeedback(pendingBat);

      setPitchLog(prev => [{ ...pendingPitch, batting: pendingBat }, ...prev]);
      setPendingBat(null);

      const nextGs = updateGameState(curGs, pendingPitch, pendingBat, batter.name);
      countRef.current = { ...nextGs.count };
      setGs(nextGs);

      if (nextGs.lineupIdx[getAttackingSide(nextGs)] !== curGs.lineupIdx[getAttackingSide(curGs)] ||
          nextGs.topBottom !== curGs.topBottom) {
        batRef.current = null;
      }

      setSimStep('done');
      return;
    }
  }, [simStep, gs, simReady, getCurrentPitcherSim, getCurrentBatter, pendingPitch, pendingBat]);

  // ── 카운트 + 게임 상태 갱신 (순수 함수) ──────────────────────
  function updateGameState(curGs, pitchResult, batResult, batterName) {
    let newGs = { ...curGs, count: { ...curGs.count } };
    const side = getAttackingSide(curGs);

    // 비정상 투구
    if (!pitchResult.isNormal) {
      const r = pitchResult.result || pitchResult.type;
      if (r === 'hit_by_pitch' || r === 'balk') {
        return processAtBat(newGs, side, { type: 'walk', batterName });
      }
      if (r === 'wild_pitch') {
        if (newGs.count.balls >= 3) return processAtBat(newGs, side, { type: 'walk', batterName });
        newGs.count.balls++;
        return newGs;
      }
      return newGs;
    }

    const pitchR = pitchResult.result;

    // 타자 행동 처리
    if (batResult) {
      const { action, result, type } = batResult;

      if (action === 'swing') {
        if (result === 'whiff') {
          if (newGs.count.strikes >= 2) {
            return processAtBat(newGs, side, { type: 'strikeout', batterName });
          }
          newGs.count.strikes++;
          return newGs;
        }
        if (result === 'contact') {
          if (type === 'foul' || type === 'foul_back') {
            if (newGs.count.strikes < 2) newGs.count.strikes++;
            return newGs;
          }
          // 인플레이
          const pj = judgeInPlay(batResult, curGs.bases, curGs.outs);
          const ng = processAtBat(newGs, side, { type: 'in_play', playJudge: pj, batterName });
          // 타순 전진 (아웃/안타 등 타석 소화 시)
          if (pj.result !== 'foul') {
            ng.lineupIdx = { ...ng.lineupIdx, [side]: (curGs.lineupIdx[side] + 1) % 9 };
          }
          return ng;
        }
      }

      if (action === 'take') {
        // 노스윙 → 심판 판정
        if (pitchR === 'called_strike') {
          if (newGs.count.strikes >= 2) {
            return processAtBat(newGs, side, { type: 'strikeout_looking', batterName });
          }
          newGs.count.strikes++;
          return newGs;
        }
        if (pitchR === 'ball') {
          if (newGs.count.balls >= 3) {
            const ng = processAtBat(newGs, side, { type: 'walk', batterName });
            ng.lineupIdx = { ...ng.lineupIdx, [side]: (curGs.lineupIdx[side] + 1) % 9 };
            return ng;
          }
          newGs.count.balls++;
          return newGs;
        }
      }
    } else {
      // 타격 없음 (비정상 아님 but 타자 없음)
      if (pitchR === 'called_strike') {
        if (newGs.count.strikes >= 2) return processAtBat(newGs, side, { type: 'strikeout_looking', batterName });
        newGs.count.strikes++;
      } else if (pitchR === 'ball') {
        if (newGs.count.balls >= 3) {
          const ng = processAtBat(newGs, side, { type: 'walk', batterName });
          ng.lineupIdx = { ...ng.lineupIdx, [side]: (curGs.lineupIdx[side] + 1) % 9 };
          return ng;
        }
        newGs.count.balls++;
      }
    }
    return newGs;
  }

  // ── 리셋 ──────────────────────────────────────────────────────
  const resetGame = useCallback(() => {
    simAwayRef.current = new PitchSimulator(awayPitcher ? buildSimProfile(awayPitcher) : DEFAULT_PITCHER_PROFILE);
    simHomeRef.current = new PitchSimulator(homePitcher ? buildSimProfile(homePitcher) : DEFAULT_PITCHER_PROFILE);
    batRef.current     = null;
    setGs(createGameState());
    setFeedback(null);
    setLastResult(null);
    setLastBatting(null);
    setPitchLog([]);
    setSimStep(null);
    setPendingPitch(null);
    setPendingBat(null);
    setArrivedPitch(null);
    countRef.current = { balls: 0, strikes: 0 };
    setSimReady(true);
  }, [awayPitcher, homePitcher]);

  // ── 파생 데이터 ───────────────────────────────────────────────
  const battedBalls = useMemo(() =>
    pitchLog
      .filter(p => p.batting?.result === 'contact')
      .map(p => {
        const bat = p.batting;
        const dist = calcLandingDist(bat);
        if (!dist) return null;
        if (bat.type === 'foul_back') return { fx: FHX, fy: FHY + 14, type: bat.type, dist };
        return { ...fieldPos(bat.direction, dist), type: bat.type, dist };
      })
      .filter(Boolean),
    [pitchLog]
  );

  const recentPitches    = pitchLog.slice(0, 12);
  const currentBatter    = getCurrentBatter(gs);
  const attackingSide    = getAttackingSide(gs);
  const currentPitcherPlayer = gs.topBottom === 'top' ? homePitcher : awayPitcher;
  const count            = countRef.current;

  // ── 단계별 표시 범위 ──────────────────────────────────────────
  const AFTER_PITCH  = ['pitching','judging','batting','done'];
  const AFTER_JUDGE  = ['judging','batting','done'];
  const AFTER_BAT    = ['batting','done'];

  const pitchSrc = arrivedPitch || pendingPitch || lastResult;
  const pitchReveal = {
    plan:  simStep != null,
    exec:  AFTER_PITCH.includes(simStep),
    judge: AFTER_PITCH.includes(simStep),
  };
  const batSrc = AFTER_BAT.includes(simStep) ? lastBatting : pendingBat;
  const batReveal = {
    plan:     simStep != null && simStep !== 'p_plan',
    judgment: AFTER_JUDGE.includes(simStep),
    result:   AFTER_BAT.includes(simStep),
  };

  // ── 렌더 ──────────────────────────────────────────────────────
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.badge}>⚾ 경기 시뮬레이터</span>
            <span className={styles.playerBadge}>
              {gs.isGameOver ? '경기 종료' : `${attackingSide === 'away' ? '원정' : '홈'}팀 공격 · ${currentBatter.name}`}
            </span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={styles.body}>

          {/* ── 왼쪽: 팀 설정 ── */}
          <div className={styles.sidePanel}>
            {/* 탭 */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              {['away', 'home'].map(side => (
                <button key={side}
                  onClick={() => setActiveTeamTab(side)}
                  style={{
                    flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: activeTeamTab === side ? '#1976D222' : 'none',
                    border: 'none', borderBottom: activeTeamTab === side ? '2px solid #42A5F5' : '2px solid transparent',
                    color: activeTeamTab === side ? '#42A5F5' : 'var(--text2)',
                  }}
                >
                  {side === 'away' ? '원정 투수' : '홈 투수'}
                </button>
              ))}
            </div>

            {/* 선택된 투수 표시 */}
            <div style={{ padding: '6px 10px', flexShrink: 0, fontSize: 11, color: 'var(--text2)' }}>
              원정: <b style={{ color: '#42A5F5' }}>{awayPitcher?.name_kor || '디폴트'}</b>
              {' / '}홈: <b style={{ color: '#FFA726' }}>{homePitcher?.name_kor || '디폴트'}</b>
            </div>

            {/* 검색 + 목록 */}
            <div className={styles.searchWrap}>
              <input
                className={styles.searchInput}
                placeholder="선수 검색..."
                value={activeTeamTab === 'away' ? searchAway : searchHome}
                onChange={e => activeTeamTab === 'away' ? setSearchAway(e.target.value) : setSearchHome(e.target.value)}
              />
            </div>
            <div className={styles.pitcherList}>
              {(activeTeamTab === 'away' ? filteredPitchersAway : filteredPitchersHome).map(p => (
                <PitcherCard
                  key={p.id}
                  player={p}
                  team={teamsMap[p.team_id]}
                  selected={activeTeamTab === 'away' ? awayPitcher?.id === p.id : homePitcher?.id === p.id}
                  onSelect={pl => handleSelectPitcher(pl, activeTeamTab)}
                />
              ))}
            </div>

            {/* 타순 표시 */}
            <div style={{ borderTop: '1px solid var(--border)', padding: '6px 8px', flexShrink: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>
                {attackingSide === 'away' ? '원정' : '홈'} 타순
              </div>
              {(attackingSide === 'away' ? lineupAway : lineupHome).map((b, i) => {
                const isCurrent = i === gs.lineupIdx[attackingSide] % 9;
                return (
                  <div key={b.id} style={{
                    display: 'flex', gap: 4, alignItems: 'center', padding: '1px 3px',
                    background: isCurrent ? '#1976D222' : 'none',
                    borderRadius: 4, fontSize: 10,
                  }}>
                    <span style={{ color: 'var(--text2)', minWidth: 14 }}>{i + 1}</span>
                    <span style={{ color: isCurrent ? '#42A5F5' : 'var(--text1)', fontWeight: isCurrent ? 700 : 400 }}>{b.name}</span>
                    <span style={{ marginLeft: 'auto', color: 'var(--text2)' }}>{b.contact_r}/{b.power}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 가운데: 스코어보드 + 존 + 필드 ── */}
          <div className={styles.zoneWrap}>

            {/* 스코어보드 */}
            <Scoreboard
              gs={gs}
              awayName={awayPitcher ? `${awayPitcher.name_kor}팀` : '원정'}
              homeName={homePitcher ? `${homePitcher.name_kor}팀` : '홈'}
              awayPitcher={awayPitcher}
              homePitcher={homePitcher}
              count={count}
              outs={gs.outs}
              pitchCount={pitchLog.length}
            />

            {/* 스트라이크존 SVG */}
            <svg className={styles.zoneSvg} viewBox={`0 0 ${SVG_W} ${SVG_H}`} width={SVG_W} height={SVG_H}>
              <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#0a0e14" rx={10} />
              <rect x={SVG_CX - SCALE * 2.0} y={SVG_CY + ZONE_PX_H / 2 + 4} width={SCALE * 4.0} height={2} fill="#1e2a3a" rx={1} opacity={0.4} />
              <rect x={SVG_CX - SCALE * 2.2} y={SVG_CY - SCALE * 2.2} width={SCALE * 4.4} height={SCALE * 4.4} fill="#0e1620" rx={6} />
              <rect x={zoneLeft} y={zoneTop} width={ZONE_PX_W} height={ZONE_PX_H} fill="#111a24" stroke="#3a5068" strokeWidth={2} />
              {[1, 2].map(i => (
                <React.Fragment key={i}>
                  <line x1={zoneLeft + (ZONE_PX_W / 3) * i} y1={zoneTop} x2={zoneLeft + (ZONE_PX_W / 3) * i} y2={zoneTop + ZONE_PX_H} stroke="#253545" strokeWidth={1} />
                  <line x1={zoneLeft} y1={zoneTop + (ZONE_PX_H / 3) * i} x2={zoneLeft + ZONE_PX_W} y2={zoneTop + (ZONE_PX_H / 3) * i} stroke="#253545" strokeWidth={1} />
                </React.Fragment>
              ))}
              <rect x={zoneLeft - BALL_PX} y={zoneTop - BALL_PX} width={ZONE_PX_W + BALL_PX * 2} height={ZONE_PX_H + BALL_PX * 2} fill="none" stroke="#3a5068" strokeWidth={0.8} strokeDasharray="3 4" opacity={0.4} />

              {/* 이전 투구 잔상 */}
              {recentPitches.slice(1).map((p, i) => {
                if (!p.location) return null;
                const { sx, sy } = toSvg(p.location.x, p.location.y);
                return <circle key={i} cx={sx} cy={sy} r={BALL_PX} fill={PITCH_COLORS[p.pitchType] || '#888'} opacity={Math.max(0.05, 0.25 - i * 0.02)} />;
              })}

              {/* planning: 목표 위치 */}
              {pendingPitch?.target && (() => {
                const { sx, sy } = toSvg(pendingPitch.target.x, pendingPitch.target.y);
                const col = PITCH_COLORS[pendingPitch.pitchType] || '#ccc';
                return (
                  <g opacity={0.85}>
                    <circle cx={sx} cy={sy} r={BALL_PX + 6} fill="none" stroke={col} strokeWidth={1.5} strokeDasharray="3 2" />
                    <line x1={sx - 6} y1={sy - 6} x2={sx + 6} y2={sy + 6} stroke={col} strokeWidth={2} />
                    <line x1={sx + 6} y1={sy - 6} x2={sx - 6} y2={sy + 6} stroke={col} strokeWidth={2} />
                  </g>
                );
              })()}

              {/* pitching: 경로선 */}
              {arrivedPitch?.target && arrivedPitch?.location && (() => {
                const from = toSvg(arrivedPitch.target.x, arrivedPitch.target.y);
                const to   = toSvg(arrivedPitch.location.x, arrivedPitch.location.y);
                return <line x1={from.sx} y1={from.sy} x2={to.sx} y2={to.sy} stroke="#ffffff28" strokeWidth={1.2} strokeDasharray="3 3" />;
              })()}

              {/* pitching: 실제 공 */}
              {arrivedPitch?.location && (() => {
                const { sx, sy } = toSvg(arrivedPitch.location.x, arrivedPitch.location.y);
                const col = PITCH_COLORS[arrivedPitch.pitchType] || '#fff';
                const r   = arrivedPitch.result || arrivedPitch.type;
                const isStrike = r === 'called_strike';
                const showBat  = simStep === 'done' || simStep === null || AFTER_BAT.includes(simStep);
                const batAction = showBat ? lastBatting?.action : null;
                const batResult = showBat ? lastBatting?.result : null;
                let label = isStrike ? 'S' : 'B';
                let labelColor = isStrike ? '#EF5350' : '#66BB6A';
                if (batAction === 'swing') {
                  if (batResult === 'whiff') { label = '헛'; labelColor = '#EF5350'; }
                  else if (batResult === 'contact') {
                    label = BATTED_BALL_LABELS[lastBatting.type]?.charAt(0) || 'C';
                    labelColor = BATTED_BALL_COLORS[lastBatting.type] || '#42A5F5';
                  }
                }
                return (
                  <g>
                    <circle cx={sx} cy={sy} r={BALL_PX + 5} fill="none" stroke={col} strokeWidth={2} opacity={0.55} />
                    <circle cx={sx} cy={sy} r={BALL_PX} fill={col} stroke="#fff" strokeWidth={1.2} />
                    <text x={sx} y={sy + BALL_PX + 15} textAnchor="middle" fill={labelColor} fontSize={11} fontWeight={700}>{label}</text>
                  </g>
                );
              })()}

              {arrivedPitch && !arrivedPitch.isNormal && !arrivedPitch.location && (
                <text x={SVG_CX} y={SVG_CY} textAnchor="middle" fill="#FFA726" fontSize={18} fontWeight={700}>{arrivedPitch.description || arrivedPitch.type}</text>
              )}

              {simStep === 'p_plan' && pendingPitch && (
                <text x={SVG_CX} y={zoneTop - 14} textAnchor="middle" fill="#FFCA28" fontSize={11} fontWeight={600}>
                  {PITCH_TYPE_LABELS[pendingPitch.pitchType] || pendingPitch.pitchType} {pendingPitch.plan?.targetVelo}km
                </text>
              )}

              {/* 홈플레이트 */}
              {(() => {
                const px = SVG_CX, py = SVG_CY + ZONE_PX_H / 2 + 34;
                const hw = SCALE * 1.0, ht = 13;
                return <polygon points={`${px},${py + ht} ${px - hw},${py} ${px - hw},${py - ht * 0.5} ${px + hw},${py - ht * 0.5} ${px + hw},${py}`} fill="#1e2a3a" stroke="#4a5a6a" strokeWidth={1.2} />;
              })()}
              <text x={zoneLeft - 5} y={SVG_CY} textAnchor="end" fill="#3a5068" fontSize={9}>안쪽</text>
              <text x={zoneLeft + ZONE_PX_W + 5} y={SVG_CY} textAnchor="start" fill="#3a5068" fontSize={9}>바깥</text>
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

            {/* 필드 뷰 */}
            <div className={styles.fieldCard}>
              <div className={styles.sectionLabel}>필드 뷰</div>
              <FieldView
                battedBalls={battedBalls}
                lastBatting={AFTER_BAT.includes(simStep) && lastBatting?.result === 'contact' ? lastBatting : null}
              />
              <div className={styles.fieldLegend}>
                {Object.entries(BATTED_BALL_COLORS).map(([type, color]) => (
                  <div key={type} className={styles.legendItem}>
                    <div className={styles.legendDot} style={{ background: color }} />
                    <span>{BATTED_BALL_LABELS[type]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── 3번째: 투구/타격 메커니즘 ── */}
          <div className={styles.mechPanel}>

            {/* 능력치 요약 */}
            <div className={styles.evalCompact}>
              <div className={styles.evalCompactSection}>
                <span className={styles.evalCompactTitle}>투수</span>
                {currentPitcherPlayer ? (
                  [['구위','stuff'],['제구','command'],['컨트','control'],['체력','stamina']].map(([label, key]) => {
                    const v = currentPitcherPlayer.pitcherEval?.[key];
                    if (v == null) return null;
                    return <span key={key} className={styles.evalCompactItem}><span className={styles.evalCompactLabel}>{label}</span><b style={{ color: gradeColor(v) }}>{Math.round(v)}</b></span>;
                  })
                ) : (
                  <span style={{ fontSize: 10, color: 'var(--text2)' }}>디폴트 (50)</span>
                )}
              </div>
              <div className={styles.evalCompactSection}>
                <span className={styles.evalCompactTitle}>타자</span>
                {[['컨택','contact_r'],['파워','power'],['선구','eye']].map(([label, key]) => (
                  <span key={key} className={styles.evalCompactItem}>
                    <span className={styles.evalCompactLabel}>{label}</span>
                    <b style={{ color: gradeColor(currentBatter[key] || 50) }}>{currentBatter[key] || 50}</b>
                  </span>
                ))}
              </div>
            </div>

            {/* 단계별 실행 버튼 */}
            {(() => {
              const stepLabel = gs.isGameOver ? '경기 종료'
                : simStep === null   ? '① 투구 계획 수립'
                : simStep === 'p_plan'  ? '② 타자 계획 수립'
                : simStep === 'b_plan'  ? '③ 투구 실행'
                : simStep === 'pitching' ? '④ 타자 투구 판단'
                : simStep === 'judging'  ? '⑤ 타격 실행'
                : simStep === 'batting'  ? '⑥ 결과 확인'
                : '다음 투구 →';
              return (
                <div className={styles.controlRow}>
                  <div className={styles.btnRow}>
                    <button className={styles.pitchBtn} onClick={advanceStep} disabled={!simReady || gs.isGameOver}>
                      {stepLabel}
                    </button>
                    <button className={styles.resetBtn} onClick={resetGame}>리셋</button>
                  </div>
                </div>
              );
            })()}

            {/* 투구 메커니즘 (항상 표시) */}
            <div className={styles.mechCard}>
              <div className={styles.sectionLabel}>투구 메커니즘</div>
              {!pitchSrc ? (
                <div className={styles.mechRow}><span className={styles.mechLabel} style={{ color: 'var(--text2)' }}>—</span></div>
              ) : (
                <>
                  {pitchReveal.plan && pitchSrc.gameState && (
                    <div className={styles.mechStateRow}>
                      <span className={styles.mechStateBadge} style={{ color: pitchSrc.gameState.condition >= 70 ? '#66BB6A' : pitchSrc.gameState.condition >= 40 ? '#FFA726' : '#EF5350' }}>컨디션 {pitchSrc.gameState.condition}</span>
                      <span className={styles.mechStateBadge} style={{ color: pitchSrc.gameState.physique >= 50 ? '#66BB6A' : '#EF5350' }}>체력 {pitchSrc.gameState.physique}{pitchSrc.gameState.isExhausted ? '(지침)' : ''}</span>
                      <span className={styles.mechStateBadge} style={{ color: pitchSrc.gameState.negFactor <= 65 && pitchSrc.gameState.negFactor >= 20 ? '#66BB6A' : '#FFA726' }}>부정요인 {pitchSrc.gameState.negFactor}</span>
                      <span className={styles.mechStateBadge} style={{ color: pitchSrc.gameState.pitchTypeCondition >= 70 ? '#66BB6A' : '#FFCA28' }}>구종컨디션 {pitchSrc.gameState.pitchTypeCondition}</span>
                    </div>
                  )}
                  {pitchReveal.plan && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>1</span>
                      <span className={styles.mechLabel}>계획</span>
                      <span className={styles.mechValue}>
                        <span style={{ color: PITCH_COLORS[pitchSrc.plan?.pitchType], fontWeight: 700 }}>{PITCH_TYPE_LABELS[pitchSrc.plan?.pitchType] || '-'}</span>
                        {' '}{pitchSrc.plan?.targetVelo}km
                        {pitchSrc.target && <span className={styles.mechSub}> → ({pitchSrc.target.x?.toFixed(2)}, {pitchSrc.target.y?.toFixed(2)})</span>}
                      </span>
                    </div>
                  )}
                  {pitchReveal.exec && pitchSrc.pitchQuality != null && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>2</span>
                      <span className={styles.mechLabel}>퀄리티</span>
                      <span className={styles.mechValue}>
                        <b style={{ color: pitchSrc.pitchQuality >= 70 ? '#66BB6A' : pitchSrc.pitchQuality >= 40 ? '#FFCA28' : '#EF5350' }}>{pitchSrc.pitchQuality}</b>
                        {pitchSrc.qualityDetail && <span className={styles.mechSub}> 체력×{pitchSrc.qualityDetail.physiqueMod} 부정×{pitchSrc.qualityDetail.tensionFactor}{pitchSrc.qualityDetail.isMistake && <span style={{ color: '#EF5350' }}> [실수!]</span>}</span>}
                      </span>
                    </div>
                  )}
                  {pitchReveal.exec && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>3</span>
                      <span className={styles.mechLabel}>실행</span>
                      <span className={styles.mechValue}>
                        {pitchSrc.velocity != null ? `${pitchSrc.velocity}km/h` : '-'}
                        {pitchSrc.location && <span className={styles.mechSub}> → ({pitchSrc.location.x?.toFixed(2)}, {pitchSrc.location.y?.toFixed(2)})</span>}
                        {pitchSrc.controlRadius != null && <span className={styles.mechSub}> | 반경 {pitchSrc.controlRadius} 인력 {pitchSrc.pullStrength}</span>}
                      </span>
                    </div>
                  )}
                  {pitchReveal.judge && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>4</span>
                      <span className={styles.mechLabel}>판정</span>
                      <span className={styles.mechValue}>
                        <span style={{ color: resultColor(pitchSrc.result || pitchSrc.type), fontWeight: 700 }}>{resultLabel(pitchSrc.result || pitchSrc.type)}</span>
                        {pitchSrc.description && <span className={styles.mechSub}> — {pitchSrc.description}</span>}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* 타격 메커니즘 (항상 표시) */}
            <div className={styles.mechCard}>
              <div className={styles.sectionLabel}>타격 메커니즘</div>
              {!batSrc ? (
                <div className={styles.mechRow}><span className={styles.mechLabel} style={{ color: 'var(--text2)' }}>—</span></div>
              ) : (
                <>
                  {batReveal.plan && batSrc.gameState && (
                    <div className={styles.mechStateRow}>
                      <span className={styles.mechStateBadge} style={{ color: batSrc.gameState.condition >= 70 ? '#66BB6A' : '#FFA726' }}>컨디션 {batSrc.gameState.condition}</span>
                      <span className={styles.mechStateBadge} style={{ color: batSrc.gameState.negFactor <= 65 && batSrc.gameState.negFactor >= 20 ? '#66BB6A' : '#FFA726' }}>부정요인 {batSrc.gameState.negFactor}</span>
                    </div>
                  )}
                  {batReveal.plan && batSrc.plan && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>1</span>
                      <span className={styles.mechLabel}>계획</span>
                      <span className={styles.mechValue}>
                        <span style={{ color: '#AB47BC', fontWeight: 600 }}>{batSrc.plan.tactic === 'take' ? '테이크' : batSrc.plan.tactic === 'contact' ? '컨택' : '풀스윙'}</span>
                        {batSrc.plan.targetBallResult && <span className={styles.mechSub}> | {batSrc.plan.targetBallResult}</span>}
                        <span className={styles.mechSub}> | 예측: {batSrc.plan.predictedPitchType ? (PITCH_TYPE_LABELS[batSrc.plan.predictedPitchType] || batSrc.plan.predictedPitchType) : '없음'}</span>
                      </span>
                    </div>
                  )}
                  {batReveal.judgment && batSrc.judgment && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>2</span>
                      <span className={styles.mechLabel}>판단</span>
                      <span className={styles.mechValue}>
                        {(() => {
                          const j = batSrc.judgment;
                          const tc = j.judgmentType === 'bias_confirmed' ? '#66BB6A' : j.judgmentType === 'accurate_neutral' ? '#81C784' : j.judgmentType === 'neutral' ? '#90A4AE' : j.judgmentType === 'bias_interfered' ? '#FFA726' : '#EF5350';
                          const tl = j.judgmentType === 'bias_confirmed' ? '선입견강화' : j.judgmentType === 'accurate_neutral' ? '정확' : j.judgmentType === 'neutral' ? '중립' : j.judgmentType === 'bias_interfered' ? '선입견방해' : '계열혼동';
                          return <><span style={{ color: tc, fontWeight: 700 }}>{tl}</span><span className={styles.mechSub}> ×{j.swingMod}</span></>;
                        })()}
                      </span>
                    </div>
                  )}
                  {batReveal.judgment && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>3</span>
                      <span className={styles.mechLabel}>스윙</span>
                      <span className={styles.mechValue}>
                        오버랩 <b>{batSrc.overlap ?? '-'}</b>
                        {batSrc.threshold != null && <span className={styles.mechSub}> / 기준 {batSrc.threshold}{batSrc.overlap >= batSrc.threshold ? <span style={{ color: '#66BB6A' }}> 스윙</span> : <span style={{ color: '#78909C' }}> 노스윙</span>}</span>}
                        {batSrc.action === 'swing' && <span style={{ color: '#42A5F5', fontWeight: 700 }}> → {swingTypeLabel(batSrc.swingType)} Lv.{batSrc.swingLevel}</span>}
                      </span>
                    </div>
                  )}
                  {batReveal.result && batSrc.action === 'swing' && batSrc.result === 'whiff' && (
                    <div className={styles.mechRow}>
                      <span className={styles.mechStep}>4</span>
                      <span className={styles.mechLabel}>결과</span>
                      <span className={styles.mechValue}>
                        <span style={{ color: '#EF5350', fontWeight: 700 }}>헛스윙</span>
                        <span className={styles.mechSub}> {Math.round((batSrc.whiffProb ?? 0) * 100)}% | 오차 {batSrc.locationError}</span>
                      </span>
                    </div>
                  )}
                  {batReveal.result && batSrc.action === 'swing' && batSrc.result === 'contact' && (
                    <>
                      <div className={styles.mechRow}>
                        <span className={styles.mechStep}>4</span>
                        <span className={styles.mechLabel}>컨택</span>
                        <span className={styles.mechValue}>
                          퀄리티 <b style={{ color: batSrc.quality >= 60 ? '#66BB6A' : batSrc.quality >= 35 ? '#FFCA28' : '#EF5350' }}>{batSrc.quality}</b>
                          <span className={styles.mechSub}>{batSrc.tensionFactor != null && ` 부정×${batSrc.tensionFactor}`}</span>
                        </span>
                      </div>
                      <div className={styles.mechRow}>
                        <span className={styles.mechStep}>5</span>
                        <span className={styles.mechLabel}>타구</span>
                        <span className={styles.mechValue}>
                          <span style={{ color: BATTED_BALL_COLORS[batSrc.type] || '#90A4AE', fontWeight: 700 }}>{BATTED_BALL_LABELS[batSrc.type] || batSrc.type}</span>
                          {batSrc.type !== 'foul' && batSrc.type !== 'foul_back' && (
                            <span className={styles.mechSub}> {batSrc.exitVelo}km/h | {batSrc.launchAngle}° | {batSrc.direction}°</span>
                          )}
                        </span>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ── 4번째: 경기 기록 패널 ── */}
          <div className={styles.logPanel}>

            {/* 경기 기록 (상단, 넓게) */}
            <div style={{ background: '#0a0e14', border: '1px solid #1e2a3a', borderRadius: 8, flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#4a5a6a', padding: '6px 8px 4px', textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>경기 기록</div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px' }}>
                {gs.gameLog.length === 0
                  ? <div style={{ fontSize: 11, color: '#4a5a6a', padding: '4px 0' }}>—</div>
                  : gs.gameLog.slice(0, 80).map((line, i) => (
                    <div key={i} style={{
                      fontSize: 11, padding: '3px 2px', borderBottom: '1px solid #ffffff08',
                      color: line.includes('홈런') ? '#FF6F00' : line.includes('2루타') || line.includes('3루타') ? '#66BB6A' : line.includes('안타') ? '#FFCA28' : line.includes('볼넷') ? '#42A5F5' : line.includes('삼진') ? '#EF5350' : '#8892b0',
                    }}>{line}</div>
                  ))
                }
              </div>
            </div>

            {/* 팀 기록 */}
            <TeamStats gs={gs} />

            {/* 투구 로그 */}
            {pitchLog.length > 0 && (
              <div className={styles.resultCard}>
                <div className={styles.sectionLabel}>투구 로그</div>
                <div className={styles.logWrap}>
                  {pitchLog.slice(0, 20).map((p, i) => {
                    const bat = p.batting;
                    const batLabel = bat ? (bat.action === 'swing' ? (BATTED_BALL_LABELS[bat.result === 'whiff' ? 'whiff' : bat.type] || bat.result) : '노스윙') : '-';
                    const batColor = bat?.action === 'swing' ? (bat.result === 'whiff' ? '#EF5350' : BATTED_BALL_COLORS[bat.type] || '#90A4AE') : '#78909C';
                    return (
                      <div key={i} className={styles.logRow}>
                        <span className={styles.logNum}>{p.pitchNumber}</span>
                        <span style={{ color: PITCH_COLORS[p.pitchType] || '#888', fontWeight: 600, fontSize: 11, minWidth: 46 }}>{PITCH_TYPE_LABELS[p.pitchType] || '-'}</span>
                        <span className={styles.logVelo}>{p.velocity != null ? `${p.velocity}k` : '-'}</span>
                        <span style={{ fontWeight: 600, fontSize: 11, color: batColor, minWidth: 40 }}>{batLabel}</span>
                        {bat?.result === 'contact' && bat.type !== 'foul' && bat.type !== 'foul_back' && (
                          <span style={{ fontSize: 10, color: '#8892b0' }}>{bat.exitVelo}k {bat.launchAngle}°</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <NarrativeBar
          pitchSrc={pitchSrc}
          batSrc={batSrc}
          pitchReveal={pitchReveal}
          batReveal={batReveal}
        />
      </div>
    </div>
  );
}
