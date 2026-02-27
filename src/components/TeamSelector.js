import React from 'react';
import styles from './TeamSelector.module.css';

export default function TeamSelector({ teams, selected, onSelect }) {
  return (
    <div className={styles.wrap}>
      <button
        className={`${styles.btn} ${selected === 'ALL' ? styles.active : ''}`}
        onClick={() => onSelect('ALL')}
      >
        <span className={styles.dot} style={{ background: '#e8c84a' }} />
        전체
      </button>
      {teams.map(team => (
        <button
          key={team.id}
          className={`${styles.btn} ${selected === team.id ? styles.active : ''}`}
          onClick={() => onSelect(team.id)}
          style={selected === team.id ? {
            borderColor: team.color + '99',
            background: team.color + '22',
            color: '#fff',
          } : {}}
        >
          <span className={styles.dot} style={{ background: team.color }} />
          <span className={styles.teamName}>{team.name_kor}</span>
        </button>
      ))}
    </div>
  );
}
