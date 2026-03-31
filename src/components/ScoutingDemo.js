import React, { useState, useMemo } from 'react';
import { generateForeignPitcher, buildHintPool } from '../utils/foreignPlayerGen';
import { generateSeasonStats, formatIP } from '../utils/careerSimulator';
import { generateAdaptationProfile, calcAdaptationFactor } from '../utils/playerGrowth';
import styles from './ScoutingDemo.module.css';

// 데모용 고정 선수
const DEMO_PLAYER = {
  name_kor: '라이언 콜드웰',
  name_eng: 'Ryan Caldwell',
  age: 29,
  nationality: '🇺🇸 미국',
  position: 'SP',
  number: 47,
  prevTeam: 'Memphis Redbirds (AAA)',
};

const HINT_ICONS = { positive: '✓', neutral: '·', negative: '!' };
const HINT_COLORS = { positive: '#4CAF50', neutral: '#9E9E9E', negative: '#E57373' };

// KBO 적합도 숫자 → 등급 + 설명 + 색상
function kboFitGrade(fit) {
  if (fit >= 74) return { grade: 'S', label: '최적합',   color: '#D4A017' };
  if (fit >= 65) return { grade: 'A', label: '적합',     color: '#4CAF50' };
  if (fit >= 50) return { grade: 'B', label: '보통',     color: '#2196F3' };
  if (fit >= 35) return { grade: 'C', label: '불확실',   color: '#9E9E9E' };
  if (fit >= 25) return { grade: 'D', label: '부적합',   color: '#CC6ED9' };
  return           { grade: 'E', label: '고위험',   color: '#E53935' };
}

function StatRow({ label, value, sub }) {
  return (
    <div className={styles.statRow}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

// N회 시뮬 → 중앙값 시즌 반환
function runSeasonSim(simPlayer, adaptationType, N = 9) {
  const rawAdaptProfile = generateAdaptationProfile(simPlayer.sourceLeague);
  const adaptProfile = simPlayer.sourceLeague === 'KBO'
    ? { ...rawAdaptProfile, ipThreshold: 60, speed: 12, floor: 0.88, ceiling: 1.00 }
    : rawAdaptProfile;
  // 1년차: threshold 0에서 시작 (신규 입국)
  const adaptFactor = calcAdaptationFactor(0, adaptProfile) * adaptationType.curve[0];

  const results = Array.from({ length: N }, () =>
    generateSeasonStats(simPlayer.currentAbility, simPlayer.position, adaptFactor, 1.0, 1.0)
  );
  results.sort((a, b) => a.era - b.era);
  return results[Math.floor(N / 2)]; // 중앙값
}

const ATTR_KOR = {
  competitiveness: '승부욕',
  resilience: '회복력',
  focus: '집중력',
  adaptability: '적응력',
  work_ethic: '훈련태도',
  durability: '내구성',
  leadership: '리더십',
};

function pickAttrDesc(opinions, attribute, value) {
  const matches = opinions.filter(
    o => o.attribute === attribute && value >= o.range_min && value <= o.range_max
  );
  if (!matches.length) return null;
  return matches[Math.floor(Math.random() * matches.length)].description;
}

function calcAttrStrengthsWeaknesses(attributes, opinions) {
  let bestKey = null, bestVal = 55;
  let worstKey = null, worstVal = 46;
  for (const [key, value] of Object.entries(attributes)) {
    if (value > bestVal) { bestVal = value; bestKey = key; }
    if (value < worstVal) { worstVal = value; worstKey = key; }
  }
  const strengths = bestKey ? [pickAttrDesc(opinions, bestKey, bestVal)].filter(Boolean) : [];
  const weaknesses = worstKey ? [pickAttrDesc(opinions, worstKey, worstVal)].filter(Boolean) : [];
  return { strengths, weaknesses };
}

export default function ScoutingDemo({ onClose, scoutingHints = [], attrOpinions = [] }) {
  const hintPool = useMemo(() => buildHintPool(scoutingHints), [scoutingHints]);
  const [data, setData] = useState(() => generateForeignPitcher('AAA', 'SP', hintPool));
  const [signed, setSigned] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [scouted, setScouted] = useState(false);

  const { visible, hidden, simPlayer } = data;
  const { strengths, weaknesses } = useMemo(
    () => calcAttrStrengthsWeaknesses(hidden.attributes, attrOpinions),
    [hidden.attributes, attrOpinions]
  );

  // 계약 후 리빌 시 시뮬레이션 (메모이즈)
  const simResult = useMemo(() => {
    if (!signed) return null;
    return runSeasonSim(simPlayer, hidden.adaptationType);
  }, [signed, simPlayer, hidden.adaptationType]);

  function reroll() {
    setData(generateForeignPitcher('AAA', 'SP', hintPool));
    setSigned(false);
    setRevealed(false);
    setScouted(false);
  }

  const eraWidth = Math.max(0, Math.min(100,
    (7.5 - visible.projectedERA.low) / (7.5 - 2.0) * 100
  ));
  const eraHighWidth = Math.max(0, Math.min(100,
    (7.5 - visible.projectedERA.high) / (7.5 - 2.0) * 100
  ));

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.badge}>스카우팅 리포트</div>
            <div className={styles.leagueBadge}>{visible.sourceLeague}</div>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* 선수 기본 정보 */}
        <div className={styles.playerInfo}>
          <div className={styles.avatar}>
            <span className={styles.avatarText}>{DEMO_PLAYER.name_eng.split(' ').map(n => n[0]).join('')}</span>
          </div>
          <div>
            <div className={styles.nameKor}>{DEMO_PLAYER.name_kor}</div>
            <div className={styles.nameEng}>{DEMO_PLAYER.name_eng}</div>
            <div className={styles.meta}>
              {DEMO_PLAYER.nationality} &nbsp;·&nbsp;
              {DEMO_PLAYER.age}세 &nbsp;·&nbsp;
              {DEMO_PLAYER.position} &nbsp;·&nbsp;
              #{DEMO_PLAYER.number}
            </div>
            <div className={styles.prevTeam}>{DEMO_PLAYER.prevTeam}</div>
          </div>
        </div>

        <div className={styles.body}>

          {/* 직전 리그 성적 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>직전 시즌 성적 <span className={styles.leagueTag}>{visible.sourceLeague}</span></div>
            <div className={styles.statsGrid}>
              <StatRow label="ERA"  value={visible.prevStats.era.toFixed(2)} />
              <StatRow label="K/9"  value={visible.prevStats.k9.toFixed(1)} />
              <StatRow label="BB/9" value={visible.prevStats.bb9.toFixed(1)} />
              <StatRow label="WHIP" value={visible.prevStats.whip.toFixed(2)} />
              <StatRow label="IP"   value={visible.prevStats.ip} />
            </div>
          </div>

          {/* KBO 예상 ERA */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>KBO 1년차 예상 ERA</div>
            <div className={styles.eraRange}>
              <span className={styles.eraLow}>{visible.projectedERA.low.toFixed(2)}</span>
              <div className={styles.eraBarWrap}>
                <div className={styles.eraBar}>
                  <div
                    className={styles.eraFill}
                    style={{
                      left: `${100 - eraWidth}%`,
                      right: `${eraHighWidth}%`,
                    }}
                  />
                </div>
                <div className={styles.eraAxisLabels}>
                  <span>2.00</span><span>4.75</span><span>7.50+</span>
                </div>
              </div>
              <span className={styles.eraHigh}>{visible.projectedERA.high.toFixed(2)}</span>
            </div>
            <div className={styles.eraNote}>
              * 적응 속도, 부상 여부에 따라 크게 달라질 수 있음
            </div>
          </div>

          {/* 구종 레퍼토리 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>구종 레퍼토리</div>
            <div className={styles.pitchGrid}>
              <div className={styles.pitchHeader}>
                <span>구종</span>
                <span style={{ textAlign: 'center' }}>구속</span>
                <span style={{ textAlign: 'right' }}>비율</span>
              </div>
              {visible.pitches.map((p, i) => (
                <div key={i} className={styles.pitchRow}>
                  <span className={styles.pitchName}>{p.name}</span>
                  <span className={styles.pitchVelo}>{p.velo} km/h</span>
                  <div className={styles.pitchPctWrap}>
                    <div className={styles.pitchPctBar}>
                      <div className={styles.pitchPctFill} style={{ width: `${p.pct}%` }} />
                    </div>
                    <span className={styles.pitchPct}>{p.pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* KBO 적합도 — 계약 전: 등급만 / 계약 후: 신뢰도 추가 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>KBO 적합도</div>
            {(() => {
              const { grade, label, color } = kboFitGrade(visible.kboFit);
              const acc = Math.round(visible.scoutAccuracy);
              const accColor = acc >= 70 ? '#4CAF50' : acc >= 45 ? '#FF9800' : '#E57373';
              return (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color }}>{grade}</span>
                    <span style={{ fontSize: 13, color, fontWeight: 500 }}>({label})</span>
                    {signed && (
                      <span style={{ fontSize: 12, color: accColor, fontWeight: 600, marginLeft: 8 }}>
                        신뢰도 {acc}%
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: '#999', marginLeft: 'auto' }}>스카우팅 기대 평가</span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* 스카우팅 힌트 */}
          <div className={styles.section}>
            <div className={styles.sectionTitle}>스카우트 의견</div>
            <div className={styles.hints}>
              {visible.hints.map((hint, i) => (
                <div key={i} className={styles.hint} style={{ borderLeftColor: HINT_COLORS[hint.type] }}>
                  <span className={styles.hintIcon} style={{ color: HINT_COLORS[hint.type] }}>
                    {HINT_ICONS[hint.type]}
                  </span>
                  <span className={styles.hintText}>{hint.text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 스카우트 보고서 요청 후 공개 */}
          {scouted && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                상세 스카우트 보고서
                <span className={styles.scoutedBadge}>✓ 보고서 수령</span>
              </div>
              {/* 좁혀진 ERA 범위 */}
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>정밀 ERA 추정</span>
                <span className={styles.detailVal}>
                  {((visible.projectedERA.low + visible.projectedERA.high) / 2 - 0.3).toFixed(2)}
                  {' ~ '}
                  {((visible.projectedERA.low + visible.projectedERA.high) / 2 + 0.3).toFixed(2)}
                </span>
              </div>
              {/* 능력치 범위 힌트 */}
              <div className={styles.abilityHints}>
                {[
                  { label: '구위',     val: hidden.trueStuff },
                  { label: '커맨드',   val: hidden.trueCommand },
                  { label: '컨트롤',   val: hidden.trueControl },
                  { label: '체력',     val: hidden.trueStamina },
                ].map(({ label, val }) => {
                  const tier = val >= 60 ? { arrow: '↑', color: '#4CAF50' }
                             : val >= 45 ? { arrow: '',  color: '#FF9800' }
                             :             { arrow: '↓', color: '#E57373' };
                  return (
                    <span key={label} className={styles.abilityChip} style={{ color: tier.color, background: tier.color + '18' }}>
                      {label}{tier.arrow && ` ${tier.arrow}`}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 선수 특성 강점/단점 — 스카우트 보고서 수령 후 공개 */}
          {scouted && (strengths.length > 0 || weaknesses.length > 0) && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>선수 특성</div>
              <div className={styles.hints}>
                {strengths.map((text, i) => (
                  <div key={`s${i}`} className={styles.hint} style={{ borderLeftColor: HINT_COLORS.positive }}>
                    <span className={styles.hintIcon} style={{ color: HINT_COLORS.positive }}>{HINT_ICONS.positive}</span>
                    <span className={styles.hintText}>{text}</span>
                  </div>
                ))}
                {weaknesses.map((text, i) => (
                  <div key={`w${i}`} className={styles.hint} style={{ borderLeftColor: HINT_COLORS.negative }}>
                    <span className={styles.hintIcon} style={{ color: HINT_COLORS.negative }}>{HINT_ICONS.negative}</span>
                    <span className={styles.hintText}>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 계약 후 능력치 공개 (데모용) */}
          {signed && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                계약 완료 — 실제 능력치
                <button className={styles.revealBtn} onClick={() => setRevealed(r => !r)}>
                  {revealed ? '숨기기' : '공개'}
                </button>
              </div>
              {revealed && (
                <div className={styles.revealed}>
                  {[
                    { label: '구위',    val: hidden.trueStuff,    color: '#4CAF50' },
                    { label: '커맨드',  val: hidden.trueCommand,  color: '#2196F3' },
                    { label: '컨트롤',  val: hidden.trueControl,  color: '#26A69A' },
                    { label: '주자억제', val: hidden.trueHolding,  color: '#9C27B0' },
                    { label: '체력',    val: hidden.trueStamina,  color: '#FF9800' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className={styles.hiddenStat}>
                      <span>{label}</span>
                      <div className={styles.hiddenBar} style={{ width: `${(val - 20) / 60 * 100}%`, background: color }} />
                      <span>{val}</span>
                    </div>
                  ))}
                  <div className={styles.adaptLabel}>
                    <span>적응 유형</span>
                    <strong>{hidden.adaptationType.label}</strong>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 1시즌 시뮬레이션 */}
          {signed && simResult && (
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                KBO 1년차 시뮬레이션
                <span className={styles.simNote}>9회 시뮬 중앙값</span>
              </div>
              <div className={styles.simGrid}>
                {[
                  { label: visible.role === 'SP' ? 'GS' : 'G',  value: visible.role === 'SP' ? simResult.gs : simResult.g },
                  { label: 'IP',   value: formatIP(simResult.ip) },
                  { label: 'ERA',  value: simResult.era.toFixed(2),  color: simResult.era <= 3.50 ? '#4CAF50' : simResult.era >= 5.00 ? '#E57373' : 'var(--text)' },
                  { label: 'K/9',  value: simResult.k9.toFixed(1),   color: simResult.k9 >= 9.0 ? '#4CAF50' : 'var(--text)' },
                  { label: 'BB/9', value: simResult.bb9.toFixed(1),  color: simResult.bb9 <= 2.5 ? '#4CAF50' : simResult.bb9 >= 4.0 ? '#E57373' : 'var(--text)' },
                  { label: 'WHIP', value: simResult.whip.toFixed(2) },
                ].map(({ label, value, color }) => (
                  <div key={label} className={styles.simCell}>
                    <span className={styles.simLabel}>{label}</span>
                    <span className={styles.simValue} style={{ color }}>{value}</span>
                  </div>
                ))}
              </div>
              <div className={styles.simAdaptNote}>
                적응계수 {(simResult.adaptFactor ?? hidden.adaptationType.curve[0] * 100).toFixed ?
                  `${Math.round(hidden.adaptationType.curve[0] * 100)}%` : '—'} 반영
                &nbsp;·&nbsp;{hidden.adaptationType.label}
              </div>
            </div>
          )}

        </div>

        {/* 액션 버튼 */}
        <div className={styles.actions}>
          <button className={styles.rerollBtn} onClick={reroll}>다른 선수 보기</button>
          {!scouted && !signed && (
            <button className={styles.scoutBtn} onClick={() => setScouted(true)}>
              스카우트 보고서 요청
            </button>
          )}
          {!signed ? (
            <button className={styles.signBtn} onClick={() => setSigned(true)}>
              계약 체결
            </button>
          ) : (
            <div className={styles.signedLabel}>✓ 계약 완료</div>
          )}
        </div>

      </div>
    </div>
  );
}
