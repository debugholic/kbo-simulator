import React from 'react';
import { PITCHER_POSITION_GROUPS, BATTER_POSITION_GROUPS } from '../utils';
import styles from './FilterBar.module.css';

export default function FilterBar({ playerType, onPlayerType, positionGroup, onPositionGroup, search, onSearch }) {
  const posGroups = playerType === 'pitcher' ? PITCHER_POSITION_GROUPS : BATTER_POSITION_GROUPS;

  return (
    <div className={styles.wrap}>
      {/* 투수/타자 탭 */}
      <div className={styles.typeTabs}>
        <button
          className={`${styles.typeTab} ${playerType === 'pitcher' ? styles.typeActive : ''}`}
          onClick={() => onPlayerType('pitcher')}
        >
          투수
        </button>
        <button
          className={`${styles.typeTab} ${playerType === 'batter' ? styles.typeActive : ''}`}
          onClick={() => onPlayerType('batter')}
        >
          타자
        </button>
      </div>

      {/* 포지션 세부 필터 */}
      <div className={styles.positions}>
        {Object.entries(posGroups).map(([key, label]) => (
          <button
            key={key}
            className={`${styles.posBtn} ${positionGroup === key ? styles.active : ''}`}
            onClick={() => onPositionGroup(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 검색 */}
      <div className={styles.searchWrap}>
        <svg className={styles.searchIcon} viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M13 13l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <input
          className={styles.search}
          type="text"
          placeholder="선수 검색..."
          value={search}
          onChange={e => onSearch(e.target.value)}
        />
        {search && (
          <button className={styles.clearBtn} onClick={() => onSearch('')}>×</button>
        )}
      </div>
    </div>
  );
}
