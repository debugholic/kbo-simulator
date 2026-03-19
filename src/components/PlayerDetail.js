import React, { useState } from 'react';
import {
  getOverall, getGrade, getPositionGroup, POSITION_KOR,
  getBarColor, getTeamDisplayColor, ATTRIBUTE_DEFS,
  PITCH_TYPE_KOR, PITCH_TYPES, calcAge,
} from '../utils';
import { EVAL_CATEGORIES } from '../utils/pitcherEval';
import styles from './PlayerDetail.module.css';

const STORAGE_URL = 'https://ruiismfjwipmluufmhoe.supabase.co/storage/v1/object/public/player-images';

/* ── Player Photo (로드 실패 시 숨김) ── */
function PlayerPhoto({ playerId }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) return null;

  return (
    <img
      src={`${STORAGE_URL}/${playerId}.png`}
      alt=""
      className={styles.playerPhoto}
      style={{ opacity: loaded ? 1 : 0 }}
      onLoad={() => setLoaded(true)}
      onError={() => setError(true)}
    />
  );
}

/* ── SVG Radar Chart (다각형 능력치 차트) ── */
function RadarChart({ items, teamColor, minVal = 0, maxVal = 100 }) {
  const size = 280;
  const cx = size / 2;
  const cy = size / 2;
  const range = maxVal - minVal;
  const maxR = range;
  const scale = (size - 80) / 2 / maxR;

  const n = items.length;
  if (n < 3) return null;

  const angleStep = (2 * Math.PI) / n;
  const startAngle = -Math.PI / 2;

  const getPoint = (index, value) => {
    const angle = startAngle + angleStep * index;
    const r = (value - minVal) * scale;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  const levelCount = 5;
  const levels = Array.from({ length: levelCount }, (_, i) => minVal + (range / levelCount) * (i + 1));
  const values = items.map(item => Math.max(minVal, Math.min(maxVal, item.value ?? minVal)));
  const dataPoints = values.map((v, i) => getPoint(i, v));
  const fillColor = teamColor || '#e8c84a';

  return (
    <div className={styles.radarWrap}>
      <svg viewBox={`0 0 ${size} ${size}`} className={styles.radarSvg}>
        {/* Grid polygons */}
        {levels.map(level => {
          const pts = items.map((_, i) => {
            const p = getPoint(i, level);
            return `${p.x},${p.y}`;
          }).join(' ');
          return (
            <polygon
              key={level}
              points={pts}
              fill="none"
              stroke="var(--border)"
              strokeWidth={level === maxVal ? 1.5 : 0.8}
              opacity={level === maxVal ? 0.6 : 0.4}
            />
          );
        })}

        {/* Axis lines */}
        {items.map((_, i) => {
          const p = getPoint(i, maxVal);
          return (
            <line
              key={i}
              x1={cx} y1={cy} x2={p.x} y2={p.y}
              stroke="var(--border)"
              strokeWidth={0.8}
              opacity={0.4}
            />
          );
        })}

        {/* Data polygon */}
        <polygon
          points={dataPoints.map(p => `${p.x},${p.y}`).join(' ')}
          fill={fillColor}
          fillOpacity={0.2}
          stroke={fillColor}
          strokeWidth={2.5}
          strokeLinejoin="round"
        />

        {/* Data points */}
        {dataPoints.map((p, i) => (
          <circle
            key={i}
            cx={p.x} cy={p.y} r={4}
            fill={fillColor}
            stroke="#fff"
            strokeWidth={1.5}
          />
        ))}

        {/* Labels */}
        {items.map((item, i) => {
          const labelPoint = getPoint(i, maxVal + (range * 0.2));
          const val = values[i];
          return (
            <g key={i}>
              <text
                x={labelPoint.x}
                y={labelPoint.y - 6}
                textAnchor="middle"
                dominantBaseline="middle"
                className={styles.radarLabel}
              >
                {item.label}
              </text>
              <text
                x={labelPoint.x}
                y={labelPoint.y + 10}
                textAnchor="middle"
                dominantBaseline="middle"
                className={styles.radarValue}
                fill={getBarColor(val)}
              >
                {val || '-'}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ── Stat Bar ── */
function StatRow({ label, desc, value, suffix, min = 0, max = 100 }) {
  if (value == null) return null;
  const color = getBarColor(value);
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return (
    <div className={styles.statRow}>
      <div className={styles.statLabel}>
        <span>{label}</span>
        {desc && <span className={styles.statDesc}>{desc}</span>}
      </div>
      <div className={styles.barWrap}>
        <div className={styles.bar} style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className={styles.statVal} style={{ color }}>{value}{suffix || ''}</span>
    </div>
  );
}

/* ── 구종 정보 추출 (사용하는 구종만) ── */
function getPitchItems(pitchStats) {
  if (!pitchStats) return [];
  return PITCH_TYPES
    .filter(type => {
      const pct = pitchStats[`pct_${type}`];
      return pct != null && pct > 0;
    })
    .map(type => ({
      type,
      label: PITCH_TYPE_KOR[type],
      val100Raw: pitchStats[`val100_${type}`] != null ? Number(pitchStats[`val100_${type}`]) : null,
      val100: pitchStats[`val100_${type}`] != null ? Math.round(Number(pitchStats[`val100_${type}`])) : null,
      velo: pitchStats[`velo_${type}`] != null ? Number(pitchStats[`velo_${type}`]).toFixed(1) : null,
      pct: pitchStats[`pct_${type}`] != null ? Number(pitchStats[`pct_${type}`]).toFixed(1) : null,
    }));
}

/* ── val100을 리그 평균 대비 z-score로 20~80 스케일 변환 ── */
function normalizeVal100(val100, type, leagueStats) {
  if (val100 == null) return 20;
  const league = leagueStats?.[type];
  if (league) {
    // z-score 기반: 50 + z * 10, clamped 20~80
    const z = (val100 - league.mean) / league.std;
    return Math.max(20, Math.min(80, Math.round(50 + z * 10)));
  }
  // 리그 데이터 없으면 단순 매핑
  return Math.max(20, Math.min(80, Math.round(50 + val100 * 8)));
}

export default function PlayerDetail({ player, team, leaguePitchStats, onBack }) {
  const overall = getOverall(player);
  const grade = getGrade(overall);
  const isPitcher = getPositionGroup(player.position) === 'pitcher';
  const displayColor = getTeamDisplayColor(team);
  const age = calcAge(player.birthdate);

  // 구종 데이터
  const pitchItems = isPitcher ? getPitchItems(player.pitchStats) : [];
  const hasPitchData = pitchItems.length > 0;

  // 레이더 차트용 데이터 (리그 평균 대비 z-score 정규화)
  const radarItems = pitchItems.map(item => ({
    label: item.label,
    value: normalizeVal100(item.val100Raw, item.type, leaguePitchStats),
  }));

  // 특성 레이더 차트용 데이터
  const attrItems = ATTRIBUTE_DEFS
    .filter(def => player.attributes?.[def.key] != null)
    .map(def => ({
      label: def.label,
      value: player.attributes[def.key],
    }));

  // 투수 5대 능력치
  const pitcherEval = player.pitcherEval || null;
  const evalItems = pitcherEval
    ? EVAL_CATEGORIES
        .filter(cat => pitcherEval[cat.key] != null)
        .map(cat => ({ label: cat.labelKor, value: pitcherEval[cat.key] }))
    : [];

  return (
    <div className={styles.page}>
      {/* Top Bar */}
      <div className={styles.topBar}>
        <button className={styles.backBtn} onClick={onBack}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          목록
        </button>
        <div className={styles.topBarTitle}>선수 정보</div>
        <div style={{ width: 60 }} />
      </div>

      <div className={styles.container}>
        {/* Player Header Card */}
        <div
          className={styles.headerCard}
          style={{
            background: team
              ? `linear-gradient(135deg, ${displayColor}44 0%, ${displayColor}11 60%, var(--bg2) 100%)`
              : 'var(--bg2)',
            borderColor: team ? displayColor + '33' : 'var(--border)',
          }}
        >
          <div className={styles.headerTop}>
            <PlayerPhoto playerId={player.id} />
            <div className={styles.headerInfo}>
              {team && (
                <div className={styles.teamTag} style={{ background: displayColor }}>
                  {team.name_kor}
                </div>
              )}
              <h1 className={styles.playerName}>{player.name_kor}</h1>
              {player.name_eng && (
                <p className={styles.playerNameEng}>{player.name_eng}</p>
              )}
            </div>

            <div className={styles.headerRight}>
              {overall != null && (
                <div className={styles.ovrCircle} style={{ borderColor: grade.color + '88' }}>
                  <span className={styles.ovrGrade} style={{ color: grade.color }}>
                    {grade.label}
                  </span>
                  <span className={styles.ovrNum}>{overall}</span>
                  <span className={styles.ovrLabel}>OVR</span>
                </div>
              )}
              {player.number && (
                <div className={styles.jersey}>#{player.number}</div>
              )}
            </div>
          </div>

          {/* Meta row */}
          <div className={styles.meta}>
            <div className={styles.metaChip}>
              <span className={styles.metaKey}>포지션</span>
              <span className={styles.metaVal}>{POSITION_KOR[player.position] || player.position}</span>
            </div>
            {age != null && (
              <div className={styles.metaChip}>
                <span className={styles.metaKey}>나이</span>
                <span className={styles.metaVal}>{age}</span>
              </div>
            )}
            {player.bats_throws && (
              <div className={styles.metaChip}>
                <span className={styles.metaKey}>타/투</span>
                <span className={styles.metaVal}>{player.bats_throws}</span>
              </div>
            )}
            {player.height && (
              <div className={styles.metaChip}>
                <span className={styles.metaKey}>신장</span>
                <span className={styles.metaVal}>{player.height}</span>
              </div>
            )}
            {player.weight && (
              <div className={styles.metaChip}>
                <span className={styles.metaKey}>체중</span>
                <span className={styles.metaVal}>{player.weight}</span>
              </div>
            )}
          </div>
        </div>

        {/* 투수 5대 능력치 (Stuff, Command, Control, Holding, Stamina) */}
        {isPitcher && evalItems.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>투수 평가</h2>
            <div className={styles.statList}>
              {EVAL_CATEGORIES.map(cat => {
                const val = pitcherEval?.[cat.key];
                if (val == null) return null;
                return (
                  <StatRow
                    key={cat.key}
                    label={cat.labelKor}
                    desc={cat.label}
                    value={val}
                    min={20}
                    max={80}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* 선수 특성 (투수 능력치) */}
        {attrItems.length > 0 && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>
              {isPitcher ? '투수 능력치' : '타자 능력치'}
            </h2>
            <RadarChart items={attrItems} teamColor={displayColor} />
            <div className={styles.statList}>
              {ATTRIBUTE_DEFS.map(def => {
                const val = player.attributes?.[def.key];
                if (val == null) return null;
                return (
                  <StatRow
                    key={def.key}
                    label={def.label}
                    desc={def.desc}
                    value={val}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* 구종 (투수만) - 좌: 레이더, 우: 데이터 */}
        {isPitcher && hasPitchData && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>구종</h2>
            <div className={styles.pitchLayout}>
              <div className={styles.pitchLeft}>
                <RadarChart items={radarItems} teamColor="#E05050" minVal={20} maxVal={80} />
              </div>
              <div className={styles.pitchRight}>
                <div className={styles.pitchGrid}>
                  <div className={styles.pitchGridHeader}>
                    <span>구종</span>
                    <span>구속</span>
                    <span>비율</span>
                  </div>
                  {pitchItems.map(item => (
                    <div key={item.type} className={styles.pitchGridRow}>
                      <span className={styles.pitchName}>{item.label}</span>
                      <span className={styles.pitchVelo}>{item.velo ? `${item.velo}km` : '-'}</span>
                      <span className={styles.pitchPct}>{item.pct ? `${item.pct}%` : '-'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {isPitcher && !hasPitchData && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>구종</h2>
            <p className={styles.emptyText}>구종 데이터가 없습니다</p>
          </div>
        )}

        {/* 스카우팅 리포트 */}
        {player.attributes?.scouting_report && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>스카우팅 리포트</h2>
            <p className={styles.summaryText}>{player.attributes.scouting_report}</p>
          </div>
        )}

        {/* 종합 코멘트 */}
        {player.attributes?.overall_comment && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>종합 평가</h2>
            <p className={styles.summaryText}>{player.attributes.overall_comment}</p>
          </div>
        )}
      </div>
    </div>
  );
}
