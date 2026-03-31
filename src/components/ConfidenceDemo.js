import React, { useState } from 'react';
import { AbilityVisibilityCard } from './AbilityVisibilityCard';
import styles from './ConfidenceDemo.module.css';

const DEMO_PLAYERS = [
  {
    name: '왕옌청',
    sub: 'Wang Yan-cheng',
    type: 'KBO 신인',
    typeColor: '#9C27B0',
    position: 'RP',
    trueRating: { stuff: 64, command: 58, control: 55, holding: 52, stamina: 50 },
    priorMean:  { stuff: 50, command: 50, control: 50, holding: 50, stamina: 50 },
    priorWidth: { stuff: 20, command: 18, control: 18, holding: 16, stamina: 14 },
    initialIP: 0,
    maxIP: 360,
  },
  {
    name: '콜드웰',
    sub: 'Ryan Caldwell',
    type: '신규 외국인',
    typeColor: '#1976D2',
    position: 'SP',
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
    trueRating: { stuff: 51, command: 71, control: 79, holding: 62, stamina: 61 },
    priorMean:  { stuff: 52, command: 70, control: 78, holding: 60, stamina: 60 },
    priorWidth: { stuff: 6,  command: 5,  control: 5,  holding: 8,  stamina: 8  },
    initialIP: 360,
    maxIP: 180,
  },
];

const STAT_LABELS = [
  { key: 'stuff',   label: '구위',    color: '#4CAF50' },
  { key: 'command', label: '커맨드',  color: '#2196F3' },
  { key: 'control', label: '컨트롤',  color: '#26A69A' },
  { key: 'holding', label: '주자억제', color: '#9C27B0' },
  { key: 'stamina', label: '체력',    color: '#FF9800' },
];

function getConfidence(totalIP, maxIP) {
  return Math.min(totalIP / maxIP, 1);
}

function buildStats(player, addedIP, showTrue) {
  const totalIP = player.initialIP + addedIP;
  const conf    = getConfidence(totalIP, player.maxIP);

  return STAT_LABELS.map(({ key, label, color }) => {
    const true_ = player.trueRating[key];
    const mean  = player.priorMean[key];
    const width = player.priorWidth[key];
    const center = Math.round(mean + (true_ - mean) * conf);
    const half   = Math.round(width * (1 - conf));
    return {
      label,
      color,
      center,
      low:  center - half,
      high: center + half,
      trueVal: showTrue ? true_ : undefined,
    };
  });
}

function ipLabel(ip) {
  if (ip === 0) return '계약 직후 (0 IP)';
  if (ip < 70)  return `초기 관찰 (${ip} IP)`;
  if (ip < 150) return `1시즌 전후 (${ip} IP)`;
  if (ip < 300) return `2시즌 전후 (${ip} IP)`;
  return `3시즌+ (${ip} IP)`;
}

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

        <div className={styles.toggleRow}>
          <button
            className={`${styles.toggleBtn} ${showTrue ? styles.toggleOn : ''}`}
            onClick={() => setShowTrue(v => !v)}
          >
            {showTrue ? '● 실제값 마커 표시 중' : '○ 실제값 마커 숨김'}
          </button>
          <span className={styles.toggleNote}>(게임에서는 숨겨짐)</span>
        </div>

        <div className={styles.cards}>
          {DEMO_PLAYERS.map(player => {
            const totalIP = player.initialIP + addedIP;
            const conf    = getConfidence(totalIP, player.maxIP);
            const ipInfo  = player.initialIP > 0
              ? `기존 ${player.initialIP} IP + 추가 ${addedIP} IP`
              : `누적 ${addedIP} IP`;

            return (
              <AbilityVisibilityCard
                key={player.name}
                name={player.name}
                nameSub={player.sub}
                position={player.position}
                typeBadge={{ label: player.type, color: player.typeColor }}
                ipInfo={ipInfo}
                confidence={conf}
                stats={buildStats(player, addedIP, showTrue)}
                showTrue={showTrue}
              />
            );
          })}
        </div>

      </div>
    </div>
  );
}
