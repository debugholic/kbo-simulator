/**
 * PitchSimulator — 투구 시뮬레이션 엔진
 *
 * 좌표계: 홈플레이트 반폭 = 1.0 기준 (캐처 시점)
 *   x: -1.0(안쪽) ~ +1.0(바깥쪽)  |  y: -1.35(낮은) ~ +1.35(높은)
 *   1 단위 = 홈플레이트 반폭 (8.5인치 ≈ 21.6cm)
 *   존 안 = |x| <= 1.0 && |y| <= 1.35
 *   존 밖 = 그 외 (최대 ±3.0 정도까지 발생 가능)
 *
 * 투구 루프:
 *   1. planPitch()     — 구종 + 목표 위치 결정
 *   2. checkAbnormal() — 비정상 투구 판정 (보크, 폭투, 몸에맞는공)
 *   3. executePitch()  — 정상 투구 실행 (구종, 구속, 최종 위치)
 *   4. classifyPitch() — 결과 판정 (스트라이크/볼)
 *   5. generateFeedback() — 다음 투구를 위한 피드백
 */

// ── 유틸 ──

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function rand(min, max) { return Math.random() * (max - min) + min; }

// Box-Muller 정규분포 난수
function gaussRandom(mean = 0, stddev = 1) {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  return mean + stddev * u * mul;
}

// 20-80 스케일 → 0~1 정규화
function norm(rating) { return clamp((rating - 20) / 60, 0, 1); }

// 가중 랜덤 선택
function weightedPick(items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = Math.random() * total;
  for (const it of items) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

// ── 존 경계 상수 ──
// 홈플레이트 반폭 = 1.0, 존 높이는 약 1.35배 (무릎~가슴)
const ZONE_X = 1.0;    // |x| <= 1.0 이면 존 안
const ZONE_Y = 1.35;   // |y| <= 1.35 이면 존 안
const BALL_R = 0.17;   // 공 반지름 (1.45인치 / 8.5인치) — 걸치면 스트라이크

// ── 상수 ──

// 카운트별 구종 보정 (패스트볼 비중 증가/감소)
const COUNT_FB_BIAS = {
  '0-0': 0.05, '0-1': -0.05, '0-2': -0.15,
  '1-0': 0.10, '1-1': 0.00,  '1-2': -0.10,
  '2-0': 0.20, '2-1': 0.10,  '2-2': 0.00,
  '3-0': 0.35, '3-1': 0.20,  '3-2': 0.10,
};

// 카운트별 목표 위치 전략
const COUNT_LOCATION_STRATEGY = {
  '0-0': { zoneProb: 0.60, edgeProb: 0.30 },  // 초구: 존 안 우세
  '0-1': { zoneProb: 0.50, edgeProb: 0.30 },
  '0-2': { zoneProb: 0.20, edgeProb: 0.30 },  // 쫓아가는 볼 / 웨이스트
  '1-0': { zoneProb: 0.65, edgeProb: 0.25 },
  '1-1': { zoneProb: 0.55, edgeProb: 0.30 },
  '1-2': { zoneProb: 0.35, edgeProb: 0.35 },
  '2-0': { zoneProb: 0.75, edgeProb: 0.20 },  // 볼카운트 불리: 존 안 승부
  '2-1': { zoneProb: 0.60, edgeProb: 0.30 },
  '2-2': { zoneProb: 0.50, edgeProb: 0.35 },
  '3-0': { zoneProb: 0.85, edgeProb: 0.10 },  // 반드시 넣어야 함
  '3-1': { zoneProb: 0.70, edgeProb: 0.25 },
  '3-2': { zoneProb: 0.60, edgeProb: 0.30 },  // 풀카운트: 과감하게
};

// 구종 분류
const FASTBALL_TYPES = new Set(['4seam', '2seam', 'sinker', 'cutter']);
const BREAKING_TYPES = new Set(['slider', 'curve', 'changeup', 'fork', 'knuckle']);

// 클래스 내부용 로컬 레이블 (export PITCH_TYPE_LABELS 보다 먼저 정의)
const PITCH_TYPE_LABELS_LOCAL = {
  '4seam':    '포심',
  '2seam':    '투심',
  'sinker':   '싱커',
  'cutter':   '커터',
  'slider':   '슬라이더',
  'curve':    '커브',
  'changeup': '체인지업',
  'fork':     '포크',
  'knuckle':  '너클',
};

// ── 메인 클래스 ──

export class PitchSimulator {
  /**
   * @param {Object} pitcher
   * @param {number} pitcher.stuff     — 20-80 구위
   * @param {number} pitcher.command   — 20-80 제구력
   * @param {number} pitcher.control   — 20-80 커맨드/스트라이크율
   * @param {number} pitcher.stamina   — 20-80 체력
   * @param {Object} pitcher.pitchTypes — { '4seam': { velo, pct }, 'slider': { velo, pct }, ... }
   * @param {Object} [pitcher.attributes] — player_attributes (20-80 스케일)
   */
  constructor(pitcher) {
    this.pitcher = pitcher;
    this.stuff   = pitcher.stuff   ?? 50;
    this.command = pitcher.command ?? 50;
    this.control = pitcher.control ?? 50;
    this.stamina = pitcher.stamina ?? 50;

    // 구종 목록 (pct > 0 만)
    this.pitchTypes = Object.entries(pitcher.pitchTypes || {})
      .filter(([, v]) => v.pct > 0)
      .map(([type, data]) => ({ type, velo: data.velo, pct: data.pct }));

    // 특성 (기본값 50)
    const attr = pitcher.attributes || {};
    this.attr = {
      competitiveness: attr.competitiveness ?? 50,
      resilience:      attr.resilience      ?? 50,
      focus:           attr.focus           ?? 50,
      adaptability:    attr.adaptability    ?? 50,
      work_ethic:      attr.work_ethic      ?? 50,
      durability:      attr.durability      ?? 50,
      leadership:      attr.leadership      ?? 50,
    };

    // 게임 내 누적 상태
    this.pitchCount = 0;
    this.gameLog = [];  // 이번 경기 투구 기록
  }

  // ── 1. 구종 + 목표 위치 결정 ──

  planPitch(count, situation = {}, feedback = null) {
    const countKey = `${count.balls}-${count.strikes}`;

    // (A) 구종 선택: pct 가중 + 카운트 보정 + 피드백 반영
    const { pitchType, reasoning: typeReasoning } = this._selectPitchType(countKey, feedback);

    // (B) 목표 위치 결정
    const { target, reasoning: locationReasoning } = this._selectTarget(countKey, pitchType, feedback);

    // (C) 투구 의도 요약
    const reasoning = this._buildReasoning(countKey, pitchType, typeReasoning, locationReasoning, feedback);

    return { pitchType: pitchType.type, targetVelo: pitchType.velo, target, reasoning };
  }

  _buildReasoning(countKey, pitchType, typeReasons, locationReasons, feedback) {
    const [balls, strikes] = countKey.split('-').map(Number);
    const lines = [];

    // 1. 카운트 상황 판단
    if (balls === 3 && strikes < 2) {
      lines.push('볼카운트 최악. 어떻게든 스트라이크를 넣어야 한다.');
    } else if (balls === 0 && strikes === 2) {
      lines.push('투수 유리. 여유 있게 승부할 수 있다.');
    } else if (balls > strikes) {
      lines.push('볼이 앞서고 있어 스트라이크가 필요한 상황.');
    } else if (strikes > balls) {
      lines.push('스트라이크가 앞서 있다. 타자를 압박할 수 있다.');
    } else if (countKey === '0-0') {
      lines.push('초구. 주도권을 잡는 것이 중요하다.');
    }

    // 2. 구종 선택 이유
    lines.push(...typeReasons);

    // 3. 위치 선택 이유
    lines.push(...locationReasons);

    // 4. 변화구 낮은 존
    if (BREAKING_TYPES.has(pitchType.type)) {
      lines.push('변화구는 낮은 코스로 떨어뜨려 헛스윙을 유도한다.');
    }

    return lines;
  }

  _selectPitchType(countKey, feedback) {
    if (!this.pitchTypes.length) {
      return { pitchType: { type: '4seam', velo: 145, pct: 100 }, reasoning: [] };
    }

    const fbBias = COUNT_FB_BIAS[countKey] ?? 0;
    const reasoning = [];

    // 카운트 보정 설명
    if (fbBias >= 0.20) {
      reasoning.push(`${countKey} 카운트 — 볼카운트 불리. 패스트볼 비중을 크게 높인다.`);
    } else if (fbBias >= 0.08) {
      reasoning.push(`${countKey} 카운트 — 패스트볼 쪽으로 약간 기운다.`);
    } else if (fbBias <= -0.12) {
      reasoning.push(`${countKey} 카운트 — 투수 유리. 변화구로 타자를 흔들 수 있다.`);
    } else if (fbBias <= -0.04) {
      reasoning.push(`${countKey} 카운트 — 변화구 비중을 살짝 늘린다.`);
    }

    // 가중치 계산
    const items = this.pitchTypes.map(pt => {
      let weight = pt.pct;
      const isFB = FASTBALL_TYPES.has(pt.type);
      weight *= (1 + (isFB ? fbBias : -fbBias * 0.5));

      if (feedback) {
        if (feedback.lastPitchType === pt.type) weight *= 0.7;
        if (feedback.lastResult === 'swinging_strike' && feedback.lastPitchType === pt.type) {
          weight *= 1.5;
        }
        if (feedback.lastResult === 'in_play_hard' && feedback.lastPitchType === pt.type) {
          weight *= 0.4;
        }
      }

      return { ...pt, weight: Math.max(weight, 0.1) };
    });

    const picked = weightedPick(items);

    // 피드백 기반 reasoning
    if (feedback) {
      const lastLabel = PITCH_TYPE_LABELS_LOCAL[feedback.lastPitchType] || feedback.lastPitchType;
      if (feedback.lastResult === 'swinging_strike' && feedback.lastPitchType === picked.type) {
        reasoning.push(`직전 ${lastLabel}에 헛스윙 → 같은 구종으로 다시 승부.`);
      } else if (feedback.lastResult === 'in_play_hard' && feedback.lastPitchType !== picked.type) {
        reasoning.push(`직전 ${lastLabel}을 세게 맞음 → 구종을 바꾼다.`);
      } else if (feedback.lastPitchType === picked.type) {
        reasoning.push(`직전과 같은 ${PITCH_TYPE_LABELS_LOCAL[picked.type] || picked.type} — 연속이지만 비중상 선택됐다.`);
      } else if (feedback.lastPitchType && feedback.lastPitchType !== picked.type) {
        reasoning.push(`직전 ${lastLabel} 후 ${PITCH_TYPE_LABELS_LOCAL[picked.type] || picked.type}으로 구종 변경.`);
      }
    }

    return { pitchType: picked, reasoning };
  }

  _selectTarget(countKey, pitchType, feedback) {
    const strategy = COUNT_LOCATION_STRATEGY[countKey] || { zoneProb: 0.55, edgeProb: 0.30 };
    const roll = Math.random();
    const reasoning = [];

    let x, y;
    let locationZone;

    if (roll < strategy.zoneProb) {
      // 존 안: 중앙부
      x = gaussRandom(0, 0.45);
      y = gaussRandom(0, 0.55);
      x = clamp(x, -ZONE_X * 0.85, ZONE_X * 0.85);
      y = clamp(y, -ZONE_Y * 0.85, ZONE_Y * 0.85);
      locationZone = 'zone';
    } else if (roll < strategy.zoneProb + strategy.edgeProb) {
      // 존 경계: 코너 or 존 바로 밖
      const side = Math.random();
      if (side < 0.25) {
        x = rand(-ZONE_X * 1.2, -ZONE_X * 0.7);
        y = gaussRandom(0, 0.6);
        locationZone = 'inside';
      } else if (side < 0.5) {
        x = rand(ZONE_X * 0.7, ZONE_X * 1.2);
        y = gaussRandom(0, 0.6);
        locationZone = 'outside';
      } else if (side < 0.75) {
        x = gaussRandom(0, 0.5);
        y = rand(ZONE_Y * 0.7, ZONE_Y * 1.15);
        locationZone = 'high';
      } else {
        x = gaussRandom(0, 0.5);
        y = rand(-ZONE_Y * 1.15, -ZONE_Y * 0.7);
        locationZone = 'low';
      }
    } else {
      // 웨이스트 피치
      const angle = Math.random() * Math.PI * 2;
      const dist = rand(1.3, 2.0);
      x = Math.cos(angle) * dist;
      y = Math.sin(angle) * dist * ZONE_Y;
      locationZone = 'waste';
    }

    // 위치 reasoning
    const locationDescriptions = {
      zone:    '존 안으로 직접 승부. 스트라이크를 확실하게 잡으러 간다.',
      inside:  '안쪽 코너를 노린다. 타자의 손목을 막는다.',
      outside: '바깥쪽 코너. 타자의 배트 끝을 겨냥한다.',
      high:    '높은 코스. 타자의 눈을 위로 올린다.',
      low:     '낮은 코스. 땅볼을 유도하거나 헛스윙을 노린다.',
      waste:   '웨이스트 피치. 타자를 유인하거나 다음 승부를 위한 포석.',
    };
    reasoning.push(locationDescriptions[locationZone] || '');

    // 변화구는 낮은 존 선호
    if (BREAKING_TYPES.has(pitchType.type)) {
      y -= 0.25;
    }

    // 피드백: 직전 위치 반대편 유도
    if (feedback?.lastLocation) {
      const movedX = feedback.lastLocation.x * 0.15;
      const movedY = feedback.lastLocation.y * 0.1;
      x -= movedX;
      y -= movedY;
      if (Math.abs(movedX) > 0.05 || Math.abs(movedY) > 0.05) {
        reasoning.push('직전 위치와 코스를 바꿔 타자의 타이밍을 흔든다.');
      }
    }

    return {
      target: { x: clamp(x, -2.5, 2.5), y: clamp(y, -ZONE_Y * 2, ZONE_Y * 2) },
      reasoning,
    };
  }

  // ── 2. 비정상 투구 판정 ──

  checkAbnormal(count, situation = {}) {
    // 기저 확률
    let abnormalProb = 0.008; // ~0.8%

    // 특성 보정
    const focusNorm   = norm(this.attr.focus);         // 집중력
    const resNorm     = norm(this.attr.resilience);     // 회복력
    const compNorm    = norm(this.attr.competitiveness); // 승부욕

    // 집중력 낮으면 비정상 투구 증가
    abnormalProb += (1 - focusNorm) * 0.012;

    // 피로 누적 (투구수 기반)
    const fatigue = Math.max(0, (this.pitchCount - 60) / 40); // 60구 이후 증가
    abnormalProb += fatigue * (1 - norm(this.stamina)) * 0.015;

    // 주자 있으면 보크 가능성
    const hasRunners = situation.runners &&
      (situation.runners.first || situation.runners.second || situation.runners.third);
    if (hasRunners) abnormalProb += 0.003;

    // 압박 상황 (접전 + 득점권 주자)
    const scoringPos = situation.runners?.second || situation.runners?.third;
    if (scoringPos && situation.outs < 2) {
      // 승부욕 높으면 압박에 강함, 낮으면 흔들림
      abnormalProb += (1 - compNorm) * 0.008;
    }

    // 판정
    if (Math.random() >= abnormalProb) return null;

    // ── 비정상 투구 유형 결정 ──
    const controlNorm = norm(this.control);
    const roll = Math.random();

    // 보크: 주자 있을 때만
    if (hasRunners && roll < 0.15) {
      const balkTypes = ['투구 동작 중 중단', '세트 포지션 위반', '1루 견제 실패'];
      return {
        type: 'balk',
        description: balkTypes[Math.floor(Math.random() * balkTypes.length)],
      };
    }

    // 폭투 vs 몸에맞는공
    // control 낮을수록 폭투/HBP 빈도 높음
    if (roll < 0.55 + (1 - controlNorm) * 0.2) {
      // 폭투 (wild pitch)
      const wpX = gaussRandom(0, 1.5);
      const wpY = rand(-ZONE_Y * 2.0, -ZONE_Y * 1.3); // 대부분 원바운드
      return {
        type: 'wild_pitch',
        description: '폭투',
        location: { x: wpX, y: wpY },
      };
    }

    // 몸에 맞는 공 (HBP)
    const hbpX = rand(-1.8, -1.3); // 타자 몸 쪽
    const hbpY = rand(-ZONE_Y * 0.4, ZONE_Y * 0.6);
    return {
      type: 'hit_by_pitch',
      description: '몸에 맞는 공',
      location: { x: hbpX, y: hbpY },
    };
  }

  // ── 3. 정상 투구 실행 ──

  executePitch(plan) {
    const { pitchType, targetVelo, target } = plan;
    const commandNorm = norm(this.command); // 0~1
    const controlNorm = norm(this.control);
    const stuffNorm   = norm(this.stuff);

    // (A) 구속: 기본 velo ± 랜덤 편차
    //   stuff 높으면 구속 유지력 좋음, 피로 시 덜 떨어짐
    const fatigueDrop = Math.max(0, (this.pitchCount - 70) / 30) * (1 - stuffNorm * 0.6);
    const veloVariance = gaussRandom(0, 1.2); // ±1~2km 자연 편차
    const velocity = Math.round((targetVelo - fatigueDrop * 2 + veloVariance) * 10) / 10;

    // (B) 투구 위치: 목표 + 가우시안 편차
    //   command가 높을수록 편차 작음
    //   20→stddev 0.55, 50→0.35, 80→0.15
    const locationStdDev = 0.55 - commandNorm * 0.40;
    const offsetX = gaussRandom(0, locationStdDev);
    const offsetY = gaussRandom(0, locationStdDev);

    // control이 낮으면 큰 미스가 간헐적으로 발생
    let bigMissX = 0, bigMissY = 0;
    if (Math.random() > controlNorm * 0.85 + 0.10) {
      bigMissX = gaussRandom(0, 0.4);
      bigMissY = gaussRandom(0, 0.4);
    }

    const location = {
      x: clamp(target.x + offsetX + bigMissX, -3.0, 3.0),
      y: clamp(target.y + offsetY + bigMissY, -ZONE_Y * 2.2, ZONE_Y * 2.2),
    };

    // (C) 결과 판정
    const result = this._classifyPitch(location);

    // 폭투 체크: 정상 투구인데 너무 빗나간 경우
    if (Math.abs(location.y) > ZONE_Y * 1.8 || Math.abs(location.x) > 2.2) {
      return {
        type: 'wild_pitch',
        pitchType,
        velocity,
        target,
        location,
        result: 'wild_pitch',
        description: '폭투 (제구 실패)',
      };
    }

    // 몸에 맞는 공 체크: 안쪽으로 크게 빗나간 경우
    if (location.x < -1.6 && Math.abs(location.y) < 1.0) {
      if (Math.random() < 0.6) { // 타자가 피할 수도 있음
        return {
          type: 'hit_by_pitch',
          pitchType,
          velocity,
          target,
          location,
          result: 'hit_by_pitch',
          description: '몸에 맞는 공 (제구 실패)',
        };
      }
    }

    return {
      type: 'normal',
      pitchType,
      velocity,
      target,
      location,
      result, // 'called_strike', 'ball', 등
    };
  }

  _classifyPitch(location) {
    const { x, y } = location;
    // 공이 존에 걸치면 스트라이크 (공 중심 + 반지름이 존 경계 안쪽)
    // 심판 가변성: 존 경계에서 약간의 흔들림
    const umpX = gaussRandom(0, 0.06);
    const umpY = gaussRandom(0, 0.06);
    const inZone = Math.abs(x) <= (ZONE_X + BALL_R + umpX) &&
                   Math.abs(y) <= (ZONE_Y + BALL_R + umpY);

    // 타자의 스윙은 BatterSimulator에서 처리
    // 여기서는 노스윙 기준 판정만
    return inZone ? 'called_strike' : 'ball';
  }

  // ── 4. 피드백 생성 ──

  generateFeedback(pitchResult) {
    return {
      lastPitchType: pitchResult.pitchType,
      lastLocation:  pitchResult.location,
      lastTarget:    pitchResult.target,
      lastVelocity:  pitchResult.velocity,
      lastResult:    pitchResult.result,
    };
  }

  // ── 메인 API ──

  /**
   * 한 투구를 시뮬레이션한다.
   * @param {Object} count       — { balls: 0-3, strikes: 0-2 }
   * @param {Object} situation   — { runners, outs, inning, score }
   * @param {Object|null} feedback — 이전 투구 피드백
   * @returns {Object} 투구 결과
   */
  simulate(count, situation = {}, feedback = null) {
    this.pitchCount++;

    // 1. 계획
    const plan = this.planPitch(count, situation, feedback);

    // 2. 비정상 투구 체크
    const abnormal = this.checkAbnormal(count, situation);
    if (abnormal) {
      const result = {
        pitchNumber: this.pitchCount,
        isNormal: false,
        ...abnormal,
        plan,
        feedback: null,
      };
      this.gameLog.push(result);
      return result;
    }

    // 3. 정상 투구 실행
    const execution = this.executePitch(plan);

    // 4. 비정상 결과 (제구 실패에 의한 폭투/HBP)
    if (execution.type === 'wild_pitch' || execution.type === 'hit_by_pitch') {
      const result = {
        pitchNumber: this.pitchCount,
        isNormal: false,
        ...execution,
        plan,
        feedback: this.generateFeedback(execution),
      };
      this.gameLog.push(result);
      return result;
    }

    // 5. 정상 투구 결과
    const result = {
      pitchNumber: this.pitchCount,
      isNormal: true,
      ...execution,
      plan,
      feedback: this.generateFeedback(execution),
    };
    this.gameLog.push(result);
    return result;
  }

  // 게임 상태 리셋
  reset() {
    this.pitchCount = 0;
    this.gameLog = [];
  }
}

// ── 헬퍼: 투수 데이터 → PitchSimulator 입력 변환 ──

/**
 * 선수 상세화면의 데이터를 PitchSimulator 입력으로 변환
 * @param {Object} playerData — useData()에서 가져온 투수 데이터
 * @returns {Object} PitchSimulator constructor 인자
 */
export function toPitcherProfile(playerData) {
  const eval_ = playerData.eval || {};
  const pitchStats = playerData.pitchStats || {};
  const attributes = playerData.attributes || {};

  const PITCH_KEYS = ['4seam', '2seam', 'cutter', 'curve', 'slider', 'changeup', 'sinker', 'fork', 'knuckle'];

  const pitchTypes = {};
  for (const key of PITCH_KEYS) {
    const velo = pitchStats[`velo_${key}`];
    const pct  = pitchStats[`pct_${key}`];
    if (velo && pct && pct > 0) {
      pitchTypes[key] = { velo: Number(velo), pct: Number(pct) };
    }
  }

  return {
    stuff:   eval_.stuff   ?? 50,
    command: eval_.command ?? 50,
    control: eval_.control ?? 50,
    stamina: eval_.stamina ?? 50,
    pitchTypes,
    attributes,
  };
}

// ── 존 경계 export ──
export { ZONE_X, ZONE_Y, BALL_R };

// ── 구종 한글 표시명 ──

export const PITCH_TYPE_LABELS = {
  '4seam':    '포심',
  '2seam':    '투심',
  'sinker':   '싱커',
  'cutter':   '커터',
  'slider':   '슬라이더',
  'curve':    '커브',
  'changeup': '체인지업',
  'fork':     '포크',
  'knuckle':  '너클',
};
