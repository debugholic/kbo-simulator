import React from 'react';
import { POSITION_GROUPS } from '../utils';
import styles from './FilterBar.module.css';

export default function FilterBar({ positionGroup, onPositionGroup, search, onSearch }) {
  return (
    <div className={styles.wrap}>
      <div className={styles.positions}>
        {Object.entries(POSITION_GROUPS).map(([key, label]) => (
          <button
            key={key}
            className={`${styles.posBtn} ${positionGroup === key ? styles.active : ''}`}
            onClick={() => onPositionGroup(key)}
          >
            {label}
          </button>
        ))}
      </div>
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
