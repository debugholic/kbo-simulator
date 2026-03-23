import React, { useState } from 'react';
import styles from './ConfidenceDemo.module.css';

// maxIP: 이 누적 이닝에 도달하면 신뢰도 100% (= 완전 파악)
// initialIP: 이미 보유한 기존 데이터(이닝) — 슬라이더 0에서도 반영됨
const DEMO_PLAYERS = [
  {
    name: '왕옌청',
    sub: 'Wang Yan-cheng',
    type: 'KBO 신인',
    typeColor: '#9C27B0',
    position: 'RP',
    // 신인: KBO 데이터 없음 → 처음부터 불확실, ~180 IP(3시즌)이면 완전 파악
    trueRating: { stuff: 64, command: 58, control: 55, holding: 52, stamina: 50 },
    priorMean:  { stuff: 50, command: 50, control: 50, holding: 50, stamina: 50 },
    priorWidth: { stuff: 20, command: 18, control: 18, holding: 16, stamina: 14 },
    initialIP: 0,
    maxIP: 360,   // 60 × 6시즌 — 신인은 성장 노이즈 많아 제일 오래 걸림
  },
  {
    name: '콜드웰',
    sub: 'Ryan Caldwell',
    type: '신규 외국인',
    typeColor: '#1976D2',
    position: 'SP',
    // 외국인: 해외 리그 데이터로 사전 범위를 어느정도 좁힘, ~350 IP(2.5시즌)이면 완전 파악
    trueRating: { stuff: 61, command: 49, control: 56, holding: 50, stamina: 62 },
    priorMean:  { stuff: 60, command: 53, control: 55, holding: 50, stamina: 58 },
    priorWidth: { stuff: 14, command: 16, control: 14, holding: 12, stamina: 10 },
    initialIP: 0,
    maxIP: 350,
  },
  {
    name: '류현진',
    sub: 'Ryu Hyun-jin',
    type: 'KBO 베테랑',
    typeColor: '#E65100',
    position: 'SP',
    // 베테랑: 3시즌(≈360 IP) 데이터 이미 보유 → 슬라이더 0에서도 완전 파악
    trueRating: { stuff: 51, command: 71, control: 79, holding: 62, stamina: 61 },
    priorMean:  { stuff: 52, command: 70, control: 78, holding: 60, stamina: 60 },
    priorWidth: { stuff: 6,  command: 5,  control: 5,  holding: 8,  stamina: 8  },
    initialIP: 360,  // 3시즌 × 120 IP
    maxIP: 180,
  },
];

const STAT_LABELS = [
  { key: 'stuff',    label: '구위',    color: '#4CAF50' },
  { key: 'command',  label: '제구',    color: '#2196F3' },
  { key: 'control',  label: '컨트롤',  color: '#26A69A' },
  { key: 'holding',  label: '주자억제', color: '#9C27B0' },
  { key: 'stamina',  label: '체력',    color: '#FF9800' },
];

/** 누적 이닝(IP) → 신뢰도 (0~1) */
function getConfidence(totalIP, maxIP) {
  return Math.min(totalIP / maxIP, 1);
}

/** 신뢰도에 따라 관측값 + 불확실 범위 계산 */
function getObserved(player, addedIP) {
  const totalIP = player.initialIP + addedIP;
  const conf = getConfidence(totalIP, player.maxIP);
  const result = {};
  for (const { key } of STAT_LABELS) {
    const true_ = player.trueRating[key];
    const mean  = player.priorMean[key];
    const width = player.priorWidth[key];
    const center = Math.round(mean + (true_ - mean) * conf);
    const half   = Math.round(width * (1 - conf));
    result[key] = { center, low: center - half, high: center + half, conf };
  }
  return result;
}

function ipLabel(ip) {
  if (ip === 0) return '계약 직후 (0 IP)';
  if (ip < 70)  return `초기 관찰 (${ip} IP)`;
  if (ip < 150) return `1시즌 전후 (${ip} IP)`;
  if (ip < 300) return `2시즌 전후 (${ip} IP)`;
  return `3시즌+ (${ip} IP)`;
}

function RangeBar({ center, low, high, trueVal, color, showTrue }) {
  const toX = v => Math.max(0, Math.min(100, ((v - 20) / 60) * 100));
  const lowX  = toX(low);
  const highX = toX(high);
  const cX    = toX(center);
  const trueX = toX(trueVal);
  const isExact = low === high;

  return (
    <div className={styles.barOuter}>
      <div className={styles.barTrack}>
        {!isExact && (
          <div className={styles.rangeZone} style={{
            left: `${lowX}%`, width: `${highX - lowX}%`,
            background: color + '33', border: `1px solid ${color}66`,
          }} />
        )}
        <div className={styles.centerBar}
          style={{ width: `${cX}%`, background: color, opacity: isExact ? 1 : 0.85 }} />
        {showTrue && (
          <div className={styles.trueMarker}
            style={{ left: `${trueX}%` }} title={`실제: ${trueVal}`} />
        )}
      </div>
      <span className={styles.barNum}>
        {isExact
          ? center
          : <span className={styles.rangeNum}>{low}<span className={styles.tilde}>~</span>{high}</span>}
      </span>
    </div>
  );
}

function PlayerCard({ player, addedIP, showTrue }) {
  const totalIP = player.initialIP + addedIP;
  const conf    = getConfidence(totalIP, player.maxIP);
  const confPct = Math.round(conf * 100);
  const observed = getObserved(player, addedIP);

  const confLabel =
    confPct >= 95 ? '완전 파악' :
    confPct >= 75 ? '대부분 파악' :
    confPct >= 50 ? '어느정도 파악' :
    confPct >= 25 ? '초기 관찰 중' : '데이터 부족';

  const confColor =
    confPct >= 95 ? '#4CAF50' :
    confPct >= 75 ? '#2196F3' :
    confPct >= 50 ? '#FF9800' : '#9E9E9E';

  return (
    <div className={styles.playerCard}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardName}>{player.name}</div>
          <div className={styles.cardSub}>{player.sub} · {player.position}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={styles.typeBadge}
            style={{ background: player.typeColor + '22', color: player.typeColor }}>
            {player.type}
          </span>
          <div className={styles.ipInfo}>
            {player.initialIP > 0
              ? `기존 ${player.initialIP} IP + 추가 ${addedIP} IP`
              : `누적 ${addedIP} IP`}
          </div>
        </div>
      </div>

      <div className={styles.confRow}>
        <div className={styles.confTrack}>
          <div className={styles.confFill}
            style={{ width: `${confPct}%`, background: confColor }} />
        </div>
        <span className={styles.confLabel} style={{ color: confColor }}>
          {confLabel} {confPct}%
        </span>
      </div>

      <div className={styles.stats}>
        {STAT_LABELS.map(({ key, label, color }) => (
          <div key={key} className={styles.statRow}>
            <span className={styles.statLabel}>{label}</span>
            <RangeBar
              {...observed[key]}
              trueVal={player.trueRating[key]}
              color={color}
              showTrue={showTrue}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// IP 마일스톤 버튼
const MILESTONES = [
  { ip: 0,   label: '0 IP' },
  { ip: 60,  label: '60 IP' },
  { ip: 140, label: '140 IP' },
  { ip: 280, label: '280 IP' },
  { ip: 420, label: '420 IP' },
];

export default function ConfidenceDemo({ onClose }) {
  const [addedIP, setAddedIP] = useState(0);
  const [showTrue, setShowTrue] = useState(true);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>

        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalTitle}>능력치 가시성 시스템</div>
            <div className={styles.modalSub}>
              이닝이 쌓일수록 선수를 더 정확히 파악 &nbsp;·&nbsp;
              신인 ~360 IP · 외국인 ~350 IP · KBO 베테랑은 처음부터 완전 파악
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* 추가 관찰 이닝 슬라이더 */}
        <div className={styles.sliderSection}>
          <div className={styles.sliderTop}>
            <span className={styles.sliderLabel}>추가 관찰 이닝 (IP)</span>
            <span className={styles.seasonLabel}>{ipLabel(addedIP)}</span>
          </div>
          <input
            type="range" min={0} max={500} step={10}
            value={addedIP}
            onChange={e => setAddedIP(Number(e.target.value))}
            className={styles.slider}
          />
          <div className={styles.milestones}>
            {MILESTONES.map(({ ip, label }) => (
              <button
                key={ip}
                className={`${styles.milestone} ${addedIP === ip ? styles.milestoneActive : ''}`}
                onClick={() => setAddedIP(ip)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 실제값 마커 토글 */}
        <div className={styles.toggleRow}>
          <button
            className={`${styles.toggleBtn} ${showTrue ? styles.toggleOn : ''}`}
            onClick={() => setShowTrue(v => !v)}
          >
            {showTrue ? '● 실제값 마커 표시 중' : '○ 실제값 마커 숨김'}
          </button>
          <span className={styles.toggleNote}>(게임에서는 숨겨짐)</span>
        </div>

        {/* 선수 카드 3개 */}
        <div className={styles.cards}>
          {DEMO_PLAYERS.map(player => (
            <PlayerCard
              key={player.name}
              player={player}
              addedIP={addedIP}
              showTrue={showTrue}
            />
          ))}
        </div>

      </div>
    </div>
  );
}
