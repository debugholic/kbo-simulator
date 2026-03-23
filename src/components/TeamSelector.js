import React from 'react';
import { getTeamDisplayColor } from '../utils';
import styles from './TeamSelector.module.css';

export default function TeamSelector({ teams, selected, onSelect }) {
  return (
    <div className={styles.wrap}>
      <button
        className={`${styles.btn} ${selected === 'ALL' ? styles.active : ''}`}
        onClick={() => onSelect('ALL')}
        style={selected === 'ALL' ? {
          borderColor: '#e8c84a99',
          background: '#e8c84a22',
          color: 'var(--text)',
        } : {}}
      >
        <span className={styles.dot} style={{ background: '#e8c84a' }} />
        전체
      </button>
      {teams.map(team => {
        const displayColor = getTeamDisplayColor(team);
        return (
          <button
            key={team.id}
            className={`${styles.btn} ${selected === team.id ? styles.active : ''}`}
            onClick={() => onSelect(team.id)}
            style={selected === team.id ? {
              borderColor: displayColor + '99',
              background: displayColor + '22',
              color: '#1a1a1a',
            } : {}}
          >
            <span className={styles.dot} style={{ background: displayColor }} />
            <span className={styles.teamName}>{team.name_kor}</span>
          </button>
        );
      })}
    </div>
  );
}
