import React, { useState } from 'react';
import {
  getOverall, getGrade, getPositionGroup, POSITION_KOR,
  getBarColor, getTeamDisplayColor,
  PITCH_TYPE_KOR, PITCH_TYPES, calcAge,
} from '../utils';
import { EVAL_CATEGORIES } from '../utils/pitcherEval';
import styles from './PlayerDetail.module.css';

const SUPABASE_URL = 'https://ruiismfjwipmluufmhoe.supabase.co';

/* ── Player Photo (로드 실패 시 숨김) ── */
function PlayerPhoto({ imageUrl }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (!imageUrl || error) return null;

  return (
    <img
      src={`${SUPABASE_URL}${imageUrl}`}
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
      <svg viewBox={`0 0 ${size} ${size}`} className={styles.radarSvg} style={{ overflow: 'visible' }}>
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
          const angle = startAngle + angleStep * i;
          const labelPoint = getPoint(i, maxVal + (range * 0.18));
          // 각도 방향 nudge + 좌우 라벨(|cos|이 클수록)은 아래로 추가 이동 (슬라이더 등 긴 글씨 겹침 방지)
          const nudgeX = Math.cos(angle) * 4;
          const nudgeY = Math.sin(angle) * 4 + Math.abs(Math.cos(angle)) * 10;
          const val = values[i];
          return (
            <g key={i}>
              <text
                x={labelPoint.x + nudgeX}
                y={labelPoint.y + nudgeY - 8}
                textAnchor="middle"
                dominantBaseline="middle"
                className={styles.radarLabel}
              >
                {item.label}
              </text>
              <text
                x={labelPoint.x + nudgeX}
                y={labelPoint.y + nudgeY + 8}
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

/* ── 슬라이더 → 스위퍼 자동 판별 ── */
// 패스트볼(포심/싱커) 대비 구속차, 절대 구속, 헛스윙률을 복합 스코어링
function classifySlider(sliderVelo, sliderWhiff, fastballVelo) {
  let score = 0;

  // (1) 패스트볼 대비 구속차 — 스위퍼는 15km+ 차이가 일반적
  if (fastballVelo != null && sliderVelo != null) {
    const gap = fastballVelo - sliderVelo;
    if (gap >= 20) score += 3;
    else if (gap >= 17) score += 2;
    else if (gap >= 14) score += 1;
    else if (gap <= 8) score -= 2;
    else if (gap <= 10) score -= 1;
  }

  // (2) 절대 구속 — 스위퍼 125~132km, 슬라이더 133km+
  if (sliderVelo != null) {
    const v = Number(sliderVelo);
    if (v <= 126) score += 3;
    else if (v <= 129) score += 2;
    else if (v <= 132) score += 1;
    else if (v >= 137) score -= 2;
    else if (v >= 135) score -= 1;
  }

  // (3) 헛스윙률 — 스위퍼는 수평 무브먼트로 높은 whiff 유도
  if (sliderWhiff != null) {
    const w = Number(sliderWhiff);
    if (w >= 38) score += 2;
    else if (w >= 33) score += 1;
    else if (w <= 20) score -= 1;
  }

  // score >= 3 → 스위퍼 확정
  return score >= 3 ? '스위퍼' : '슬라이더';
}

// 능력치 연도 가중치와 동일하게 최근 시즌 우선 블렌딩
const PITCH_YEAR_WEIGHTS = [12, 5, 3, 2, 1];

/* ── 구종별 연도 가중 val100 계산 ── */
function calcWeightedVal100(allPitchStats, type) {
  if (!Array.isArray(allPitchStats) || !allPitchStats.length) return null;
  const key = `val100_${type}`;
  let weightedSum = 0;
  let totalWeight = 0;
  allPitchStats.slice(0, 5).forEach((stats, i) => {
    const val = stats[key];
    if (val != null) {
      const w = PITCH_YEAR_WEIGHTS[i] ?? 0;
      weightedSum += Number(val) * w;
      totalWeight += w;
    }
  });
  return totalWeight > 0 ? weightedSum / totalWeight : null;
}

/* ── 구종 정보 추출 (사용하는 구종만) ── */
function getPitchItems(pitchStats, allPitchStats) {
  if (!pitchStats) return [];

  const items = PITCH_TYPES
    .filter(type => {
      const pct = pitchStats[`pct_${type}`];
      return pct != null && pct > 0;
    })
    .map(type => {
      const weightedVal100 = calcWeightedVal100(allPitchStats, type);
      return {
        type,
        label: PITCH_TYPE_KOR[type],
        val100Raw: weightedVal100,
        val100: weightedVal100 != null ? Math.round(weightedVal100) : null,
        velo:  pitchStats[`velo_${type}`]  != null ? Number(pitchStats[`velo_${type}`]).toFixed(1) : null,
        pct:   pitchStats[`pct_${type}`]   != null ? Number(pitchStats[`pct_${type}`]).toFixed(1) : null,
        whiff: pitchStats[`whiff_${type}`] != null ? Number(pitchStats[`whiff_${type}`]) : null,
        cnt:   pitchStats[`cnt_${type}`]   != null ? Number(pitchStats[`cnt_${type}`]) : null,
      };
    });

  // 슬라이더 → 스위퍼 재분류
  const sliderItem = items.find(i => i.type === 'slider');
  if (sliderItem) {
    const fbItem = items.find(i => i.type === '4seam') || items.find(i => i.type === 'sinker');
    const fbVelo = fbItem ? Number(fbItem.velo) : null;
    sliderItem.label = classifySlider(sliderItem.velo, sliderItem.whiff, fbVelo);
  }

  return items;
}

/* ── val100을 리그 평균 대비 z-score로 20~80 스케일 변환 ── */

// 구종별 구속 블렌드 비율 — 패스트볼은 구속이 핵심, 변화구는 결과(val100) 위주
// changeup/fork는 절대 구속보다 패스트볼과의 구속차가 중요하므로 블렌드 제외
const VELO_BLEND_RATIO = {
  '4seam':   0.35,
  '2seam':   0.25,
  sinker:    0.25,
  cutter:    0.20,
  slider:    0.10,
  curve:     0.05,
  changeup:  0.00,
  fork:      0.00,
  knuckle:   0.00,
  other:     0.10,
};

// 구속 기반 구종 등급 추정 벤치마크 (KBO 평균 구속, km/h)
const VELO_BENCHMARKS = {
  '4seam': { mean: 145, std: 3.5 },
  '2seam': { mean: 143, std: 3.5 },
  cutter:  { mean: 138, std: 3 },
  curve:   { mean: 125, std: 4 },
  slider:  { mean: 133, std: 4 },
  changeup:{ mean: 135, std: 3.5 },
  sinker:  { mean: 144, std: 3.5 },
  fork:    { mean: 135, std: 3.5 },
  knuckle: { mean: 125, std: 5 },
  other:   { mean: 135, std: 5 },
};

// 구종별 헛스윙률(whiff%) 벤치마크 (KBO 평균, %)
const WHIFF_BENCHMARKS = {
  '4seam': { mean: 18, std: 5 },
  '2seam': { mean: 15, std: 5 },
  cutter:  { mean: 22, std: 6 },
  curve:   { mean: 30, std: 8 },
  slider:  { mean: 32, std: 7 },
  changeup:{ mean: 28, std: 7 },
  sinker:  { mean: 16, std: 5 },
  fork:    { mean: 32, std: 7 },
  knuckle: { mean: 25, std: 8 },
  other:   { mean: 22, std: 7 },
};

function normalizeVal100(val100, type, leagueStats, velo, whiff, { isRookie = false, isForeign = false, cnt = null } = {}) {
  // 소표본 회귀: 투구수 300개 미만이면 리그 평균으로 부분 회귀
  // 36개짜리 val100=5.48 같은 극단치를 현실적 수준으로 보정
  const CNT_THRESHOLD = 300;
  if (val100 != null && cnt != null && leagueStats?.[type]) {
    const w = Math.min(1, cnt / CNT_THRESHOLD);
    val100 = val100 * w + leagueStats[type].mean * (1 - w);
  }

  let score = null;

  // whiff + velo 복합 추정
  const calcWhiffVelo = () => {
    let veloScore = null;
    let whiffScore = null;
    if (velo != null) {
      const bench = VELO_BENCHMARKS[type];
      if (bench) veloScore = 50 + ((Number(velo) - bench.mean) / bench.std) * 10;
    }
    if (whiff != null) {
      const bench = WHIFF_BENCHMARKS[type];
      if (bench) whiffScore = 50 + ((Number(whiff) - bench.mean) / bench.std) * 10;
    }
    if (whiffScore != null && veloScore != null) return whiffScore * 0.6 + veloScore * 0.4;
    if (whiffScore != null) return whiffScore;
    if (veloScore != null) return veloScore;
    return null;
  };

  // 외국 리그: val100 스케일이 KBO와 다르므로 whiff+velo 우선, val100 보조
  if (isForeign) {
    const wv = calcWhiffVelo();
    if (wv != null && val100 != null) {
      const league = leagueStats?.[type];
      const v100Score = league
        ? 50 + ((val100 - league.mean) / league.std) * 10
        : 50 + val100 * 10;
      score = wv * 0.6 + v100Score * 0.4; // whiff+velo 60%, val100 40%
    } else if (wv != null) {
      score = wv;
    } else if (val100 != null) {
      const league = leagueStats?.[type];
      score = league
        ? 50 + ((val100 - league.mean) / league.std) * 10
        : 50 + val100 * 10;
    }
  } else if (val100 != null) {
    // KBO: val100 리그 z-score 기반 (구종별 독립 분포) — *10으로 구종 완성도 표현
    const league = leagueStats?.[type];
    score = league
      ? 50 + ((val100 - league.mean) / league.std) * 10
      : 50 + val100 * 10;

    // 패스트볼 계열은 구속도 블렌딩 (구속이 구위의 핵심 요소)
    const veloBlend = VELO_BLEND_RATIO[type] ?? 0;
    if (veloBlend > 0 && velo != null) {
      const bench = VELO_BENCHMARKS[type];
      if (bench) {
        const veloScore = 50 + ((Number(velo) - bench.mean) / bench.std) * 10;
        score = score * (1 - veloBlend) + veloScore * veloBlend;
      }
    }
  } else {
    score = calcWhiffVelo();
  }

  if (score == null) return null;

  // 분포 확대: 50 기준 1.10배 stretch
  score = 50 + (score - 50) * 1.10;

  // 신인 페널티: 검증되지 않은 루키는 구종 점수 할인
  if (isRookie) {
    score = 38 + (score - 50) * 0.5;
  }

  return Math.max(20, Math.min(80, Math.round(score)));
}

export default function PlayerDetail({ player, team, leaguePitchStats, onBack }) {
  const overall = getOverall(player);
  const grade = getGrade(overall);
  const isPitcher = getPositionGroup(player.position) === 'pitcher';
  const displayColor = getTeamDisplayColor(team);
  const age = calcAge(player.birthdate);

  // 구종 데이터
  const pitchItems = isPitcher ? getPitchItems(player.pitchStats, player.allPitchStats) : [];
  const hasPitchData = pitchItems.length > 0;

  // 신인/외국 리그 판별
  const sourceLeague = player.pitcherEval?.sourceLeague || 'KBO';
  const isRookie = sourceLeague === 'ROOKIE';
  const isForeign = ['AAA', 'MLB', 'NPB', 'NPB_FARM'].includes(sourceLeague);

  // 레이더 차트용 데이터 (리그 평균 대비 z-score 정규화)
  const radarItems = pitchItems.map(item => ({
    label: item.label,
    value: normalizeVal100(item.val100Raw, item.type, leaguePitchStats, item.velo, item.whiff, { isRookie, isForeign, cnt: item.cnt }),
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
            <PlayerPhoto imageUrl={player.image_url} />
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
                <div className={styles.ovrCircle} style={{ borderColor: grade.color, background: grade.background || grade.color }}>
                  <span className={styles.ovrGrade} style={{ color: grade.textColor }}>
                    {grade.label}
                  </span>
                  <span className={styles.ovrNum} style={{ color: grade.textColor }}>{overall}</span>
                  <span className={styles.ovrLabel} style={{ color: grade.textColor + 'bb' }}>OVR</span>
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

        {/* 1. 투수 5대 능력치 */}
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

        {/* 2. 스카우팅 리포트 */}
        {player.attributes?.scouting_report && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>스카우팅 리포트</h2>
            <div className={styles.quoteBlock} style={{ '--team-color': displayColor }}>
              <div className={styles.reportText}>
                {player.attributes.scouting_report.split('\n').filter(s => s.trim() && !s.trim().startsWith('총평')).map((para, i) => (
                  <p key={i} className={styles.reportPara}>{para}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 3. 종합 평가 */}
        {player.attributes?.overall_comment && (
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>종합 평가</h2>
            <div className={styles.quoteBlock} style={{ '--team-color': displayColor }}>
              <p className={styles.summaryText}>{player.attributes.overall_comment}</p>
            </div>
          </div>
        )}

        {/* 4. 구종 */}
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
      </div>
    </div>
  );
}
