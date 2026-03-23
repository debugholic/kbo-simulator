import React, { useState, useCallback } from 'react';
import {
  POTENTIAL_CEILING,
  formatIP,
  simulateCareer,
  runDistribution,
} from '../utils/careerSimulator';
import styles from './GrowthSimDemo.module.css';

// ── 선수 목록 ──
const PLAYERS = [
  {
    name: '김서현', sub: 'Kim Seo-hyeon',
    team: '한화 이글스', position: 'RP', sourceLeague: 'KBO',
    currentAge: 21, currentYear: 2026, tag: '국내 신인',
    currentAbility: { stuff: 68, command: 52, control: 55, holding: 50, stamina: 52 },
    attributes: { work_ethic: 62, resilience: 58, focus: 60, durability: 55, adaptability: 55, competitiveness: 65, leadership: 48 },
    defaultPotential: 9,
  },
  {
    name: '문동주', sub: 'Mun Dong-ju',
    team: '한화 이글스', position: 'SP', sourceLeague: 'KBO',
    currentAge: 23, currentYear: 2026, tag: '국내 성장주',
    currentAbility: { stuff: 72, command: 55, control: 58, holding: 50, stamina: 65 },
    attributes: { work_ethic: 70, resilience: 60, focus: 55, durability: 58, adaptability: 60, competitiveness: 68, leadership: 50 },
    defaultPotential: 10,
  },
  {
    name: '류현진', sub: 'Ryu Hyun-jin',
    team: '한화 이글스', position: 'SP', sourceLeague: 'KBO',
    currentAge: 38, currentYear: 2026, tag: '베테랑 (하락기)',
    currentAbility: { stuff: 58, command: 74, control: 72, holding: 62, stamina: 61 },
    attributes: { work_ethic: 75, resilience: 65, focus: 72, durability: 42, adaptability: 65, competitiveness: 72, leadership: 70 },
    defaultPotential: 10,
  },
  {
    name: 'Cody Ponce', sub: '코디 폰세',
    team: '두산 베어스', position: 'SP', sourceLeague: 'MLB',
    currentAge: 31, currentYear: 2026, tag: 'MLB 출신 용병',
    currentAbility: { stuff: 76, command: 68, control: 70, holding: 65, stamina: 72 },
    attributes: { work_ethic: 65, resilience: 60, focus: 63, durability: 62, adaptability: 55, competitiveness: 68, leadership: 55 },
    defaultPotential: 7,
  },
  {
    name: '다무라 이치로', sub: 'Tamura Ichiro',
    team: '두산 베어스', position: 'RP', sourceLeague: 'NPB',
    currentAge: 27, currentYear: 2026, tag: 'NPB 출신 용병',
    currentAbility: { stuff: 60, command: 62, control: 65, holding: 58, stamina: 52 },
    attributes: { work_ethic: 68, resilience: 62, focus: 60, durability: 60, adaptability: 65, competitiveness: 62, leadership: 52 },
    defaultPotential: 6,
  },
  {
    name: '정현우', sub: 'Jung Hyun-woo',
    team: '한화 이글스', position: 'SP', sourceLeague: 'KBO_ROOKIE',
    currentAge: 19, currentYear: 2026, tag: 'KBO 신인',
    currentAbility: { stuff: 63, command: 38, control: 42, holding: 42, stamina: 50 },
    attributes: { work_ethic: 68, resilience: 60, focus: 52, durability: 62, adaptability: 63, competitiveness: 66, leadership: 42 },
    defaultPotential: 9,
  },
];

const STAT_DEFS = [
  { key: 'stuff',   label: '구위',    color: '#4CAF50' },
  { key: 'command', label: '제구',    color: '#2196F3' },
  { key: 'control', label: '컨트롤',  color: '#26A69A' },
  { key: 'holding', label: '주자억제', color: '#9C27B0' },
  { key: 'stamina', label: '체력',    color: '#FF9800' },
];

const INJURY_STYLE = {
  minor:    { color: '#FF9800', label: '경상' },
  moderate: { color: '#E57373', label: '중상' },
  severe:   { color: '#E53935', label: '중증' },
  career:   { color: '#B71C1C', label: '커리어' },
};

const LEAGUE_TAG_COLOR = {
  KBO:        { bg: '#1565C0', text: '#fff' },
  KBO_ROOKIE: { bg: '#4527A0', text: '#fff' },
  MLB:        { bg: '#B71C1C', text: '#fff' },
  NPB:        { bg: '#1B5E20', text: '#fff' },
  AAA:        { bg: '#E65100', text: '#fff' },
};

// ── OVR 분포 팬 차트 (100회 시뮬 결과) ──
function OvrFanChart({ distribution, runOvrs }) {
  const W = 700, H = 200, PL = 42, PR = 20, PT = 14, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const n = distribution.length;
  const ovrMin = 25, ovrMax = 82;

  const sx = i => PL + (i / Math.max(1, n - 1)) * cW;
  const sy = v => PT + cH * (1 - (v - ovrMin) / (ovrMax - ovrMin));

  // 채워진 밴드 경로 (위→아래 폴리곤)
  const areaPath = (hi, lo) => {
    const fwd = distribution.map((d, i) =>
      `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(d[hi]).toFixed(1)}`).join(' ');
    const bwd = [...distribution].reverse().map((d, i) =>
      `L${sx(n - 1 - i).toFixed(1)},${sy(d[lo]).toFixed(1)}`).join(' ');
    return fwd + ' ' + bwd + ' Z';
  };

  const linePath = vals =>
    vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');

  const yGrids = [30, 40, 50, 60, 70, 80];

  // ── 은퇴 페이드 구간 계산 ──
  // activePct < 0.85: 은퇴자 발생 시작 → 페이드 시작점
  // activePct < 0.05: 거의 전원 은퇴 → 페이드 끝점
  const retireStartIdx = distribution.findIndex(d => d.activePct < 0.85);
  const retireHalfIdx  = distribution.findIndex(d => d.activePct < 0.50);
  const retireFullIdx  = distribution.findIndex(d => d.activePct < 0.05);

  const fadeStartX = retireStartIdx >= 0 ? sx(retireStartIdx) : W + 100;
  const fadeEndX   = retireFullIdx  >= 0 ? sx(Math.min(retireFullIdx, n - 1)) : W + 100;

  // 마스크: fadeStartX까지 완전 불투명, 이후 서서히 투명
  const useMask = retireStartIdx >= 0;

  // 이번 단일 롤: distribution 길이 이하로만 그림 (은퇴 시 일찍 끝남)
  const runOvrsClipped = runOvrs ? runOvrs.slice(0, n) : null;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} className={styles.svg}>
      <defs>
        {useMask && (
          <>
            <linearGradient id="retireFadeGrad"
              x1={fadeStartX} y1="0" x2={Math.max(fadeStartX + 1, fadeEndX)} y2="0"
              gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="white" stopOpacity="1" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
            <mask id="retireFadeMask">
              {/* 은퇴 시작 전: 완전 불투명 */}
              <rect x={PL} y="0" width={Math.max(0, fadeStartX - PL)} height={H} fill="white" />
              {/* 은퇴 구간: 그라데이션 페이드 */}
              <rect x={fadeStartX} y="0" width={Math.max(1, fadeEndX - fadeStartX + 60)} height={H}
                fill="url(#retireFadeGrad)" />
            </mask>
          </>
        )}
      </defs>

      {/* Y 격자 */}
      {yGrids.map(v => (
        <g key={v}>
          <line x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)} stroke="var(--border)" strokeWidth="1" />
          <text x={PL - 4} y={sy(v) + 4} textAnchor="end" fontSize="9" fill="var(--text2)">{v}</text>
        </g>
      ))}

      {/* X 축 나이 레이블 */}
      {distribution.map((d, i) => (i % 2 === 0 || i === n - 1) && (
        <text key={i} x={sx(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--text2)">{d.age}세</text>
      ))}

      {/* 밴드 + 중앙값: 은퇴 구간 페이드 */}
      <g mask={useMask ? 'url(#retireFadeMask)' : undefined}>
        <path d={areaPath('p90', 'p10')} fill="#4CAF50" opacity="0.12" />
        <path d={areaPath('p75', 'p25')} fill="#4CAF50" opacity="0.26" />
        <path d={linePath(distribution.map(d => d.median))}
          fill="none" stroke="#4CAF50" strokeWidth="2.5" />
      </g>

      {/* 은퇴 50% 수직선 */}
      {retireHalfIdx >= 0 && retireHalfIdx < n && (() => {
        const rx = sx(retireHalfIdx);
        return (
          <g>
            <line x1={rx} x2={rx} y1={PT} y2={H - PB}
              stroke="#9E9E9E" strokeWidth="1.2" strokeDasharray="4,3" opacity="0.75" />
            <text x={rx + 3} y={PT + 11}
              fontSize="8.5" fill="var(--text2)" opacity="0.85">
              은퇴↑50%
            </text>
            <text x={rx + 3} y={PT + 22}
              fontSize="8.5" fill="var(--text2)" opacity="0.75">
              {distribution[retireHalfIdx].age}세
            </text>
          </g>
        );
      })()}

      {/* 이번 단일 롤 (은퇴까지만 그림) */}
      {runOvrsClipped && runOvrsClipped.length > 0 && (
        <path d={linePath(runOvrsClipped)}
          fill="none" stroke="#FF9800" strokeWidth="1.5" strokeDasharray="5,3" opacity="0.9" />
      )}

      {/* 범례 */}
      <g transform={`translate(${PL + 8},${PT + 5})`}>
        <rect x="0" y="-7" width="14" height="9" fill="#4CAF50" opacity="0.35" />
        <text x="18" y="1" fontSize="9" fill="var(--text2)">예측 범위 (100회 시뮬)</text>
        <line x1="135" x2="151" y1="-2" y2="-2" stroke="#4CAF50" strokeWidth="2.5" />
        <text x="155" y="1" fontSize="9" fill="var(--text2)">중앙값</text>
        <line x1="202" x2="218" y1="-2" y2="-2" stroke="#FF9800" strokeWidth="1.5" strokeDasharray="5,3" />
        <text x="222" y="1" fontSize="9" fill="var(--text2)">이번 시뮬</text>
        {retireHalfIdx >= 0 && (
          <>
            <line x1="275" x2="275" y1="-7" y2="4" stroke="#9E9E9E" strokeWidth="1.2" strokeDasharray="3,2" />
            <text x="279" y="1" fontSize="9" fill="var(--text2)">은퇴 50%</text>
          </>
        )}
      </g>
    </svg>
  );
}

function OvrBar({ value, prev }) {
  const pct = ((value - 20) / 60) * 100;
  const delta = (prev != null && !isNaN(prev)) ? value - prev : 0;
  const color = value >= 70 ? '#D4A017' : value >= 63 ? '#4CAF50' : value >= 55 ? '#2196F3' : '#9E9E9E';
  return (
    <div className={styles.ovrRow}>
      <div className={styles.ovrBarTrack}>
        <div className={styles.ovrBarFill} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.ovrNum} style={{ color }}>{value}</span>
      {delta !== 0 && (
        <span className={styles.ovrDelta} style={{ color: delta > 0 ? '#4CAF50' : '#E53935' }}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </div>
  );
}

export default function GrowthSimDemo({ onClose }) {
  const [playerIdx, setPlayerIdx] = useState(0);
  const player = PLAYERS[playerIdx];
  const [potential, setPotential] = useState(player.defaultPotential);
  const [result, setResult] = useState(() => simulateCareer(PLAYERS[0], PLAYERS[0].defaultPotential));
  const [distribution, setDistribution] = useState(() => runDistribution(PLAYERS[0], PLAYERS[0].defaultPotential));

  const rerun = useCallback(() => {
    setResult(simulateCareer(player, potential));
  }, [player, potential]);

  const selectPlayer = (idx) => {
    setPlayerIdx(idx);
    const p = PLAYERS[idx];
    setPotential(p.defaultPotential);
    setResult(simulateCareer(p, p.defaultPotential));
    setDistribution(runDistribution(p, p.defaultPotential));
  };

  const changePotential = (n) => {
    setPotential(n);
    setResult(simulateCareer(player, n));
    setDistribution(runDistribution(player, n));
  };

  const { seasons, growthProfile, isForeign, isAdaptNeeded, targetPeak, ceilMin, ceilMax, declineStart, alreadyInDecline, startOvr, retiredAge } = result;
  const leagueColor = LEAGUE_TAG_COLOR[player.sourceLeague] ?? { bg: '#555', text: '#fff' };

  // 분포에서 은퇴 중앙값 나이 추출 (activePct < 0.5인 첫 항목)
  const medianRetireEntry = distribution.find(d => d.activePct < 0.50);
  const medianRetireAge = medianRetireEntry?.age ?? null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <div className={styles.header}>
          <div>
            <div className={styles.title}>성장 시뮬레이션</div>
            <div className={styles.sub}>
              {player.name} ({player.sub}) · {player.team} · {player.position}
              &nbsp;· 전성기 <strong>{growthProfile.peakAge}~{declineStart}세</strong>
              {alreadyInDecline
                ? <>&nbsp;· 현재 OVR <strong>{startOvr}</strong> (하락기 앵커)</>
                : <>&nbsp;· OVR 천장 <strong>{ceilMin}~{ceilMax}</strong>&nbsp;(이번 롤: <strong>{targetPeak}</strong>)</>
              }
              {medianRetireAge && <>&nbsp;· 은퇴 예상 <strong>~{medianRetireAge}세</strong></>}
              {retiredAge && <>&nbsp;· <span style={{ color: '#9E9E9E' }}>이번 롤 은퇴: {retiredAge}세</span></>}
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* 선수 탭 */}
        <div className={styles.playerTabs}>
          {PLAYERS.map((p, i) => (
            <button
              key={i}
              className={`${styles.playerTab} ${i === playerIdx ? styles.playerTabActive : ''}`}
              onClick={() => selectPlayer(i)}
            >
              <span className={styles.leagueTag}
                style={{ background: LEAGUE_TAG_COLOR[p.sourceLeague]?.bg, color: LEAGUE_TAG_COLOR[p.sourceLeague]?.text }}>
                {p.sourceLeague === 'KBO_ROOKIE' ? 'ROOKIE' : p.sourceLeague}
              </span>
              <span className={styles.playerTabName}>{p.name}</span>
              <span className={styles.playerTabSub}>{p.tag}</span>
            </button>
          ))}
        </div>

        {/* 컨트롤 */}
        <div className={styles.controls}>
          <div className={styles.controlGroup}>
            <label className={styles.controlLabel}>포텐셜</label>
            <div className={styles.potentialDots}>
              {[1,2,3,4,5,6,7,8,9,10].map(n => (
                <button key={n}
                  className={`${styles.dot} ${n <= potential ? styles.dotFilled : ''}`}
                  onClick={() => changePotential(n)} />
              ))}
              <span className={styles.potentialNum}>{potential}/10</span>
            </div>
          </div>
          <button className={styles.rerunBtn} onClick={rerun}>다시 굴리기 🎲</button>
        </div>

        {/* OVR 분포 팬 차트 */}
        <div className={styles.chartSection}>
          <div className={styles.chartTitle}>
            OVR 예측 분포&nbsp;
            <span style={{ fontWeight: 400, fontSize: '0.82em', color: 'var(--text2)' }}>
              (100회 시뮬레이션 · 주황 점선 = 이번 롤)
            </span>
          </div>
          <OvrFanChart distribution={distribution} runOvrs={seasons.map(s => s.ovr)} />
        </div>

        {/* 시뮬 테이블 */}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>연도</th><th>나이</th><th>OVR</th>
                {STAT_DEFS.map(s => <th key={s.key} style={{ color: s.color }}>{s.label}</th>)}
                <th style={{ color: '#FF7043' }}>ERA</th>
                <th style={{ color: '#4CAF50' }}>K/9</th>
                <th style={{ color: '#2196F3' }}>BB/9</th>
                <th>IP</th>
                <th style={{ color: '#FF9800' }}>적응</th>
                <th>이벤트</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s, i) => {
                const prevOvr = i > 0 ? seasons[i-1].ovr : null;
                const isPeak = s.age >= growthProfile.peakAge && s.age <= declineStart;
                const isRetired = !!s.retired;
                return (
                  <tr key={s.year} className={`${styles.row} ${isPeak ? styles.peakRow : ''} ${isRetired ? styles.retiredRow : ''}`}>
                    <td className={styles.tdYear}>
                      {s.year}
                      {s.age === growthProfile.peakAge && <span className={styles.peakTag}>전성기</span>}
                    </td>
                    <td>{s.age}</td>
                    <td><OvrBar value={s.ovr} prev={prevOvr} /></td>
                    {STAT_DEFS.map(d => (
                      <td key={d.key} className={styles.tdStat} style={{ color: d.color }}>
                        {s.abilities[d.key]}
                      </td>
                    ))}
                    <td className={styles.tdStat} style={{ color: '#FF7043' }}>{s.stats.era.toFixed(2)}</td>
                    <td className={styles.tdStat} style={{ color: '#4CAF50' }}>{s.stats.k9.toFixed(1)}</td>
                    <td className={styles.tdStat} style={{ color: '#2196F3' }}>{s.stats.bb9.toFixed(1)}</td>
                    <td className={styles.tdFactor}>{formatIP(s.stats.ip)}</td>
                    <td className={styles.tdFactor} style={{
                      color: s.adaptFactor >= 1.0 ? 'var(--text2)' : s.adaptFactor >= 0.90 ? '#FF9800' : '#E53935'
                    }}>
                      {(s.adaptFactor * 100).toFixed(0)}%
                    </td>
                    <td className={styles.tdEvent}>
                      {isRetired
                        ? <span className={styles.retiredTag}>🏁 은퇴</span>
                        : s.injury
                          ? <span style={{ color: INJURY_STYLE[s.injury.id]?.color }}>
                              🩹 {INJURY_STYLE[s.injury.id]?.label}
                            </span>
                          : <span className={styles.noEvent}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
