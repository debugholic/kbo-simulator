import React from 'react';
import styles from './AbilityVisibilityCard.module.css';

/**
 * RangeBar — 능력치 가시성 범위 바
 *
 * props:
 *   center   {number}  현재 추정 중앙값
 *   low      {number}  불확실 하한
 *   high     {number}  불확실 상한
 *   color    {string}  바 색상
 *   trueVal  {number=} 실제값 (마커 표시용, 선택)
 *   showTrue {boolean} 실제값 마커 표시 여부
 *   min      {number}  스케일 최솟값 (default 20)
 *   max      {number}  스케일 최댓값 (default 80)
 */
export function RangeBar({ center, low, high, color, trueVal, showTrue = false, min = 20, max = 80 }) {
  const range = max - min;
  const toX = v => Math.max(0, Math.min(100, ((v - min) / range) * 100));

  const lowX   = toX(low ?? center);
  const highX  = toX(high ?? center);
  const cX     = toX(center);
  const trueX  = trueVal != null ? toX(trueVal) : null;
  const isExact = (low == null && high == null) || low === high;

  return (
    <div className={styles.barOuter}>
      <div className={styles.barTrack}>
        {!isExact && (
          <div
            className={styles.rangeZone}
            style={{
              left: `${lowX}%`,
              width: `${highX - lowX}%`,
              background: color + '33',
              border: `1px solid ${color}66`,
            }}
          />
        )}
        <div
          className={styles.centerBar}
          style={{ width: `${cX}%`, background: color, opacity: isExact ? 1 : 0.85 }}
        />
        {showTrue && trueX != null && (
          <div
            className={styles.trueMarker}
            style={{ left: `${trueX}%` }}
            title={`실제: ${trueVal}`}
          />
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

/**
 * AbilityVisibilityCard — 능력치 가시성 카드
 *
 * props:
 *   name       {string}
 *   nameSub    {string=}
 *   position   {string=}
 *   typeBadge  {{ label, color }=}   선수 유형 뱃지
 *   ipInfo     {string=}             이닝 정보 텍스트
 *   confidence {number=}             신뢰도 0~1 (없으면 신뢰도 바 숨김)
 *   headerRight {ReactNode=}  헤더 오른쪽에 렌더링할 추가 요소 (뱃지, 버튼 등)
 *   stats      {Array<{
 *                 label: string,
 *                 color: string,
 *                 center: number,
 *                 low?: number,
 *                 high?: number,
 *                 trueVal?: number,
 *               }>}
 *   showTrue   {boolean=}
 */
export function AbilityVisibilityCard({ name, nameSub, nameExtra, position, typeBadge, ipInfo, headerRight, confidence, stats, showTrue = false }) {
  const confPct = confidence != null ? Math.round(confidence * 100) : null;

  const confLabel =
    confPct == null    ? null :
    confPct >= 95      ? '완전 파악' :
    confPct >= 75      ? '대부분 파악' :
    confPct >= 50      ? '어느정도 파악' :
    confPct >= 25      ? '초기 관찰 중' : '데이터 부족';

  const confColor =
    confPct == null    ? null :
    confPct >= 95      ? '#4CAF50' :
    confPct >= 75      ? '#2196F3' :
    confPct >= 50      ? '#FF9800' : '#9E9E9E';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <div className={styles.cardName}>
            {name}
            {nameExtra && <span className={styles.nameExtra}>{nameExtra}</span>}
          </div>
          {(nameSub || position) && (
            <div className={styles.cardSub}>
              {nameSub}{nameSub && position ? ' · ' : ''}{position}
            </div>
          )}
        </div>
        {(typeBadge || headerRight) && (
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            {headerRight}
            {typeBadge && (
              <span
                className={styles.typeBadge}
                style={{ background: typeBadge.color + '22', color: typeBadge.color }}
              >
                {typeBadge.label}
              </span>
            )}
            {ipInfo && <div className={styles.ipInfo}>{ipInfo}</div>}
          </div>
        )}
      </div>

      {confPct != null && (
        <div className={styles.confRow}>
          <div className={styles.confTrack}>
            <div className={styles.confFill} style={{ width: `${confPct}%`, background: confColor }} />
          </div>
          <span className={styles.confLabel} style={{ color: confColor }}>
            {confLabel} {confPct}%
          </span>
        </div>
      )}

      <div className={styles.stats}>
        {stats.map((s, i) => (
          <div key={i} className={styles.statRow}>
            <span className={styles.statLabel}>{s.label}</span>
            <RangeBar
              center={s.center}
              low={s.low}
              high={s.high}
              color={s.color}
              trueVal={s.trueVal}
              showTrue={showTrue}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
