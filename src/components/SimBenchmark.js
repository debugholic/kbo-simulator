/**
 * SimBenchmark.js — 투구/타격 시뮬레이션 벤치마크
 *
 * 조건:
 *   - 타자: 모든 능력치 50 라인업 (9명)
 *   - 투수: 체력(physique) 30~40 이하 OR 5실점 이상 시 리셋 (새 투수 등판)
 *   - 200이닝 될 때까지 반복
 *
 * 출력: 평균 타율 / 출루율 / 장타율 / 평균 실점(이닝당)
 */

import React, { useState, useCallback, useRef } from 'react';
import { PitchSimulator } from '../simulator/PitchSimulator';
import { BattingSimulator, DEFAULT_PITCHER_PROFILE } from '../simulator/BattingSimulator';
import { judgeInPlay, processAtBat, getAttackingSide, createGameState } from '../simulator/gameEngine';

// ── 능력치 50 고정 라인업 ─────────────────────────────────────────
function createBenchmarkLineup() {
  return Array.from({ length: 9 }, (_, i) => ({
    id:         `bench-bat-${i}`,
    name:       `타자${i + 1}`,
    contact_l:  50, contact_r: 50,
    power:      50, eye: 50, discipline: 50,
    speed:      50, bunt: 40, fatigue: 0,
  }));
}

// ── 디폴트 투수 프로필 ────────────────────────────────────────────
function createPitcherProfile() {
  return {
    ...DEFAULT_PITCHER_PROFILE,
    stuff: 50, command: 50, control: 50, stamina: 50,
  };
}

// ── 한 타석 시뮬레이션 ────────────────────────────────────────────
function simulateAtBat(pitcherSim, batSim, count, situation, knownPitchTypes) {
  let balls = 0, strikes = 0;
  let pitches = 0;
  let ballsThrown = 0, strikesThrown = 0, takes = 0, swings = 0, fouls = 0, whiffs = 0;

  while (pitches < 20) {
    pitches++;
    const c = { balls, strikes };
    const pitchResult = pitcherSim.simulate(c, situation);
    if (!pitchResult.isNormal || !pitchResult.location) {
      const r = pitchResult.result || pitchResult.type;
      if (r === 'hit_by_pitch') return { type: 'hbp', pitches, ballsThrown, strikesThrown, takes, swings };
      if (r === 'wild_pitch' || r === 'balk') { balls++; ballsThrown++; if (balls >= 4) return { type: 'walk', pitches, ballsThrown, strikesThrown, takes, swings }; continue; }
      continue;
    }

    const batResult = batSim.simulate(pitchResult, c, 'R', knownPitchTypes, situation);
    const pitchRes  = pitchResult.result || pitchResult.type;

    // 실제 볼/스트라이크 집계
    if (pitchRes === 'ball') ballsThrown++;
    else strikesThrown++;

    // 피드백
    pitcherSim.applyBattingFeedback(pitchResult, batResult);
    batSim.applyBallDeadFeedback(batResult, { isRisp: situation.bases[1] || situation.bases[2] });

    if (batResult.action === 'swing') {
      swings++;
      if (batResult.result === 'whiff') {
        whiffs++;
        strikes++;
        if (strikes >= 3) return { type: 'strikeout', pitches, ballsThrown, strikesThrown, takes, swings, fouls, whiffs };
      } else if (batResult.result === 'contact') {
        const t = batResult.type;
        if (t === 'foul' || t === 'foul_back') {
          fouls++;
          if (strikes < 2) strikes++;
        } else {
          return { type: 'contact', batResult, pitches, ballsThrown, strikesThrown, takes, swings, fouls, whiffs };
        }
      }
    } else {
      takes++;
      if (pitchRes === 'called_strike') {
        strikes++;
        if (strikes >= 3) return { type: 'strikeout_looking', pitches, ballsThrown, strikesThrown, takes, swings, fouls, whiffs };
      } else {
        balls++;
        if (balls >= 4) return { type: 'walk', pitches, ballsThrown, strikesThrown, takes, swings, fouls, whiffs };
      }
    }
  }
  return { type: 'walk', pitches, ballsThrown, strikesThrown, takes, swings, fouls, whiffs };
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────
export default function SimBenchmark({ onClose }) {
  const [running, setRunning]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult]     = useState(null);
  const cancelRef = useRef(false);

  const run = useCallback(async () => {
    setRunning(true);
    setResult(null);
    cancelRef.current = false;

    const TARGET_INNINGS = 3000;
    const lineup = createBenchmarkLineup();
    const knownPitchTypes = Object.keys(DEFAULT_PITCHER_PROFILE.pitchTypes);

    // 누적 통계
    let totalAB = 0, totalH = 0, totalBB = 0, totalHBP = 0;
    let total1B = 0, total2B = 0, total3B = 0, totalHR = 0;
    let totalSOSwing = 0, totalSOLook = 0;
    let totalRuns = 0, totalInnings = 0;
    let pitcherResets = 0;
    // 타구 분포 디버그
    let dbgGrounder = 0, dbgLineDrive = 0, dbgFlyBall = 0, dbgPopup = 0, dbgFoul = 0, dbgHR = 0;
    // 볼넷 디버그
    let dbgTotalPitches = 0, dbgBallCount = 0, dbgStrikeCount = 0, dbgTakeCount = 0, dbgSwingCount = 0, dbgWhiffCount = 0;

    let pitcherSim = new PitchSimulator(createPitcherProfile());
    let pitcherEarnedRuns = 0;
    let lineupIdx = 0;

    // 배터 시뮬레이터 풀 (9명 고정)
    const batSims = lineup.map(b => new BattingSimulator({ ...b }));

    while (totalInnings < TARGET_INNINGS) {
      if (cancelRef.current) break;

      // 이닝 시뮬레이션
      let outs = 0;
      let bases = [false, false, false];
      let inningRuns = 0;

      while (outs < 3) {
        const batter = lineup[lineupIdx % 9];
        const batSim = batSims[lineupIdx % 9];
        const situation = {
          outs, bases: [...bases],
          isClose: false, isLate: totalInnings >= 7,
        };

        const atBat = simulateAtBat(pitcherSim, batSim, { balls: 0, strikes: 0 }, situation, knownPitchTypes);
        dbgTotalPitches += atBat.pitches ?? 0;
        dbgBallCount    += atBat.ballsThrown ?? 0;
        dbgStrikeCount  += atBat.strikesThrown ?? 0;
        dbgTakeCount    += atBat.takes ?? 0;
        dbgSwingCount   += atBat.swings ?? 0;
        dbgFoul         += atBat.fouls ?? 0;
        dbgWhiffCount   += atBat.whiffs ?? 0;

        if (atBat.type === 'strikeout' || atBat.type === 'strikeout_looking') {
          outs++;
          totalAB++;
          if (atBat.type === 'strikeout') totalSOSwing++;
          else                            totalSOLook++;
          batSim.applyAtBatResult?.('strikeout', { isRisp: bases[1] || bases[2] });
        } else if (atBat.type === 'walk' || atBat.type === 'hbp') {
          totalBB += atBat.type === 'walk' ? 1 : 0;
          totalHBP += atBat.type === 'hbp' ? 1 : 0;
          // 밀어내기
          const nb = [...bases];
          let runs = 0;
          if (nb[0] && nb[1] && nb[2]) { runs = 1; }
          else if (nb[0] && nb[1]) { nb[2] = true; }
          else if (nb[0]) { nb[1] = true; }
          else { nb[0] = true; }
          bases = nb;
          inningRuns += runs;
          pitcherEarnedRuns += runs;
          batSim.applyAtBatResult?.('walk', {});
        } else if (atBat.type === 'contact') {
          totalAB++;
          const judge = judgeInPlay(atBat.batResult, bases, outs);
          outs += judge.outsAdded;
          bases = judge.basesAfter;
          inningRuns += judge.runsScored;
          pitcherEarnedRuns += judge.runsScored;

          // 타구 분포 집계
          const bt = atBat.batResult.type;
          if (bt === 'grounder') dbgGrounder++;
          else if (bt === 'line_drive') dbgLineDrive++;
          else if (bt === 'fly_ball' || bt === 'deep_fly') dbgFlyBall++;
          else if (bt === 'popup') dbgPopup++;
          else if (bt === 'foul' || bt === 'foul_back') dbgFoul++;
          else if (bt === 'home_run') dbgHR++;
          if (judge.result === 'hit' || judge.result === 'home_run') {
            totalH++;
            const ht = judge.hitType;
            if (ht === 'home_run') { totalHR++; batSim.applyAtBatResult?.('home_run', {}); }
            else if (ht === 'triple') { total3B++; batSim.applyAtBatResult?.('hit', {}); }
            else if (ht === 'double') { total2B++; batSim.applyAtBatResult?.('hit', {}); }
            else { total1B++; batSim.applyAtBatResult?.('hit', {}); }
          }
        }

        lineupIdx++;

        // 투수 교체 조건: 4실점 이상 OR physique 20 이하 (지침 상태)
        const snap = pitcherSim._getStateSnapshot?.('4seam');
        if (pitcherEarnedRuns >= 4 || (snap && snap.physique <= 20)) {
          pitcherSim = new PitchSimulator(createPitcherProfile());
          pitcherEarnedRuns = 0;
          pitcherResets++;
          // 새 게임 — 타자도 전부 리셋
          batSims.forEach((_, i) => { batSims[i] = new BattingSimulator({ ...lineup[i] }); });
          bases = [false, false, false];
          outs = 0;
        }
      }

      totalRuns += inningRuns;
      totalInnings++;

      // 이닝 종료 피드백
      pitcherSim.onInningEnd?.();
      batSims.forEach(b => b.onInningEnd?.());

      // 진행률 업데이트 (매 10이닝)
      if (totalInnings % 10 === 0) {
        setProgress(Math.round(totalInnings / TARGET_INNINGS * 100));
        // UI 업데이트를 위해 잠깐 양보
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // 결과 계산
    const avg  = totalAB > 0 ? totalH / totalAB : 0;
    const obp  = (totalAB + totalBB + totalHBP) > 0
      ? (totalH + totalBB + totalHBP) / (totalAB + totalBB + totalHBP) : 0;
    const slg  = totalAB > 0
      ? (total1B + total2B * 2 + total3B * 3 + totalHR * 4) / totalAB : 0;
    const ops  = obp + slg;
    const rpg  = totalInnings > 0 ? totalRuns / totalInnings : 0; // 이닝당 실점

    setResult({
      innings: totalInnings,
      ab: totalAB, h: totalH, bb: totalBB,
      hr: totalHR, runs: totalRuns,
      soSwing: totalSOSwing, soLook: totalSOLook,
      pitcherResets,
      avg:  avg.toFixed(3),
      obp:  obp.toFixed(3),
      slg:  slg.toFixed(3),
      ops:  ops.toFixed(3),
      rpg:  rpg.toFixed(3),
      ipPerPitcher: pitcherResets > 0
        ? (totalInnings / (pitcherResets + 1)).toFixed(1)
        : totalInnings.toFixed(1),
      pitchPerInning: totalInnings > 0 ? (dbgTotalPitches / totalInnings).toFixed(1) : '0',
      pitchPerAtBat: totalAB > 0 ? (dbgTotalPitches / (totalAB + totalBB + totalHBP)).toFixed(1) : '0',
      single: total1B, double: total2B, triple: total3B,
      // 타구 분포
      dbg: { grounder: dbgGrounder, lineDrive: dbgLineDrive, flyBall: dbgFlyBall, popup: dbgPopup, foul: dbgFoul, hrType: dbgHR },
      dbgPitch: { total: dbgTotalPitches, balls: dbgBallCount, strikes: dbgStrikeCount, takes: dbgTakeCount, swings: dbgSwingCount, fouls: dbgFoul, whiffs: dbgWhiffCount },
    });

    setRunning(false);
    setProgress(100);
  }, []);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
    }} onClick={onClose}>
      <div style={{
        background: '#0d1520', border: '1px solid #2a3a50', borderRadius: 12,
        padding: 32, minWidth: 420, maxWidth: 560,
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <span style={{ color: '#ccd6f6', fontWeight: 700, fontSize: 16 }}>시뮬레이션 벤치마크</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8892b0', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ color: '#8892b0', fontSize: 12, marginBottom: 16, lineHeight: 1.6 }}>
          타자 전원 능력치 50 · 3000이닝 · 투수 4실점/지침 시 새 게임 생성
        </div>

        {!running && !result && (
          <button onClick={run} style={{
            width: '100%', padding: '10px 0', background: '#1e4a8a',
            border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700,
            fontSize: 14, cursor: 'pointer',
          }}>
            시뮬레이션 시작
          </button>
        )}

        {running && (
          <div>
            <div style={{ color: '#42A5F5', fontSize: 13, marginBottom: 8 }}>
              진행 중... {progress}%
            </div>
            <div style={{ background: '#1e2a3a', borderRadius: 4, height: 6 }}>
              <div style={{ background: '#42A5F5', height: 6, borderRadius: 4, width: `${progress}%`, transition: 'width 0.3s' }} />
            </div>
            <button onClick={() => { cancelRef.current = true; }} style={{
              marginTop: 12, padding: '6px 16px', background: '#3a1a1a',
              border: '1px solid #8a2a2a', borderRadius: 4, color: '#ef5350',
              cursor: 'pointer', fontSize: 12,
            }}>중단</button>
          </div>
        )}

        {result && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              {[
                ['타율 (AVG)', result.avg],
                ['출루율 (OBP)', result.obp],
                ['장타율 (SLG)', result.slg],
                ['OPS', result.ops],
                ['이닝당 실점', result.rpg],
                ['이닝당 투구수', result.pitchPerInning],
                ['타석당 투구수', result.pitchPerAtBat],
                ['홈런', result.hr],
                ['볼넷', result.bb],
                ['헛스윙 삼진', result.soSwing],
                ['낫아웃 삼진', result.soLook],
                ['200이닝 총 타수', result.ab],
              ].map(([label, val]) => (
                <div key={label} style={{ background: '#0a1018', borderRadius: 6, padding: '10px 14px' }}>
                  <div style={{ color: '#8892b0', fontSize: 10, marginBottom: 4 }}>{label}</div>
                  <div style={{ color: '#ccd6f6', fontWeight: 700, fontSize: 18 }}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{ color: '#4a5a6a', fontSize: 11, lineHeight: 1.8 }}>
              {result.innings}이닝 · {result.ab}타수 {result.h}안타 ({result.single}단 {result.double}2 {result.triple}3 {result.hr}홈런) · {result.bb}볼넷 · {result.runs}실점
            </div>
            {result.dbgPitch && (
              <div style={{ color: '#4a5a6a', fontSize: 11, lineHeight: 1.8, marginTop: 6 }}>
                총투구 {result.dbgPitch.total} · 실제볼 {result.dbgPitch.balls} · 실제스트라이크 {result.dbgPitch.strikes} · 테이크 {result.dbgPitch.takes} · 스윙 {result.dbgPitch.swings} · 파울 {result.dbgPitch.fouls} · 헛스윙 {result.dbgPitch.whiffs} ({result.dbgPitch.swings > 0 ? ((result.dbgPitch.whiffs / result.dbgPitch.swings) * 100).toFixed(1) : 0}%)
              </div>
            )}
            <button onClick={run} style={{
              marginTop: 14, width: '100%', padding: '8px 0', background: '#1a3a5a',
              border: 'none', borderRadius: 6, color: '#ccd6f6', fontSize: 13, cursor: 'pointer',
            }}>다시 실행</button>
          </div>
        )}
      </div>
    </div>
  );
}
