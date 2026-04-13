# KBO 시뮬레이터 — 게임 메커니즘 설계서

> 각 시스템의 **입력 → 판정 → 출력** 흐름을 정의한다.  
> 구현 완료 여부: ✅ 완료 / 🔨 진행중 / ⬜ 미구현

---

## 목차

1. [경기 흐름 (Game Flow)](#1-경기-흐름)
2. [선수 게임 상태 (Player Game State)](#2-선수-게임-상태) ← 모든 시스템의 기반
3. [투구 (Pitching)](#3-투구)
4. [타격 (Batting)](#4-타격)
5. [타구 처리 (Ball in Play)](#5-타구-처리)
6. [수비 (Defense)](#6-수비)
7. [주루 (Baserunning)](#7-주루)
8. [공통 능력치 스케일](#8-공통-능력치-스케일)

---

## 1. 경기 흐름

**상태 머신:**

```
경기 시작
  └─ 이닝 루프 (1~9+)
       ├─ 초 (원정 공격)
       │    └─ 타석 루프 → 3아웃
       └─ 말 (홈 공격)
            └─ 타석 루프 → 3아웃 (끝내기 시 종료)
경기 종료 (9이닝 후 동점이면 연장)
```

**타석 루프 한 사이클:**

```
투구 → 타자 반응(스윙/노스윙) → 결과 판정
  ├─ 스트라이크 3 → 삼진
  ├─ 볼 4 → 볼넷
  ├─ 인플레이 → 타구 처리 → 수비 → 주루
  └─ 비정상 이벤트 (HBP / 보크 / 폭투)
```

**경기 상태 구조:**

```js
{
  inning: 1,
  isBottom: false,
  outs: 0,
  score: [0, 0],          // [원정, 홈]
  runners: {
    first:  null,         // Player | null
    second: null,
    third:  null,
  },
  count: { balls: 0, strikes: 0 },
  pitchCount: 0,          // 현 투수 투구 수
}
```

**구현 상태:** ⬜

---

## 2. 선수 게임 상태

> 모든 투구 / 타격 / 수비 / 주루 판정의 **기반 레이어**.  
> 경기 시작 시 선수마다 생성되고, 경기 내내 실시간으로 갱신된다.

### 2-1. 용어 정의

| 용어 | 타입 | 설명 |
|------|------|------|
| `fatigue` | 경기 전 사전값 | 피로도. 연속 경기·직전 등판 투구 수 등으로 사전 결정 |
| `condition` | 경기별 생성값 | 컨디션. 피로도 기반 초기화, 이벤트에 따라 감소/회복 |
| `physique` | 경기별 생성값 | 체력. 피로도 기반 초기화, 경기 진행에 따라 소모. 지침 상태 진입 기준 |
| `tension` | 경기별 생성값 | 긴장도. 기본값 30. 이벤트에 따라 오르내림 |
| `stamina` | **선수 능력치** | 스태미너 (20-80). 투수의 체력 소모 속도에 영향 |

> **`stamina`(스태미너)** 는 선수의 영구 능력치이고,  
> **`physique`(체력)** 는 경기마다 새로 생성되는 게임 상태값이다.

### 2-2. 상태 구조

```js
{
  // ── 경기 전 결정 ──
  fatigue:   number,      // 피로도 (0~100)

  // ── 경기 시작 시 초기화 ──
  condition: number,      // 컨디션 (0~100)
  physique:  number,      // 체력 (0~100)
  tension:   number,      // 긴장도 (0~100)

  // ── 파생 상태 ──
  isExhausted: boolean,   // physique < 25 → 지침 상태
}
```

### 2-3. 초기값 산정

```
condition 초기값:
  base = 100 - fatigue * 0.6     // 피로 60이면 컨디션 64로 시작
  + gaussian(0, 5)
  clamp(0, 100)

physique 초기값:
  base = 100 - fatigue * 0.4
  + gaussian(0, 4)
  clamp(0, 100)

tension 초기값:
  base = 30
  + 중요 경기(포스트시즌 등) → +10
  + 홈/원정 → ±3
  + gaussian(0, 5)
  clamp(0, 100)
```

### 2-3. 경기 중 소모

**갱신 타이밍:**

| 갱신 대상 | 시점 |
|-----------|------|
| 긴장도 / 컨디션 / 체력 | 볼데드 선언 시마다 (§2-7 참조) |
| 구종별 컨디션 (투수) | 투구 결과 볼데드 시 (§2-7 참조) |
| 피로도 | 이닝 종료 시 (경기 전 값에 누적) |

**전체 컨디션 감소/회복 (타석 이벤트 완료 직후):**

```
① 플레이당 미량 감소:
  투수: 매 타석 종료     → condition -= 0.8 + fatigue * 0.01
  타자: 매 타석 종료     → condition -= 0.5 + fatigue * 0.008
  수비: 매 수비 처리     → condition -= 0.4
  주자: 매 진루 판단     → condition -= 0.3

② 심각도 이벤트 추가 감소:
  // 투수 (타석 종료 후)
  다실점 이닝 (3실점+)      → condition -= 4.0
  장이닝 소화 (40구+ 이닝)  → condition -= 3.0
  피홈런                    → condition -= 2.0
  볼넷 허용                 → condition -= 0.8

  // 타자 (타석 종료 후)
  득점권 삼진               → condition -= 3.0
  삼진                      → condition -= 1.5
  볼넷 선출                 → condition -= 0.5

  // 수비 (플레이 직후)
  에러                      → condition -= 3.0

  // 주루 (플레이 직후)
  도루 실패                 → condition -= 2.0

③ 긍정 이벤트 회복 (초기값 초과 가능, 상한 100):
  // 투수 (타석 종료 후)
  삼진 탈삼진               → condition += 1.5
  병살 유도                 → condition += 2.0
  무실점 이닝               → condition += 3.0

  // 타자 (타석 종료 후)
  홈런                      → condition += 5.0
  적시타                    → condition += 3.0
  안타                      → condition += 1.0
  볼넷 선출                 → condition += 0.5

  // 수비 (플레이 직후)
  호수비 (range 밖 처리)    → condition += 4.0
  병살 수비 성공            → condition += 2.5

  // 주루 (플레이 직후)
  도루 성공                 → condition += 2.0
  홈인                      → condition += 1.5

condition clamp(0, 100)
```

**체력(physique) 감소:**

```
매 이닝 종료 시 (전체 선수):
  physique -= 1.0 + fatigue * 0.015

투수 추가 소모 (매 투구마다):
  // stamina: 투수의 능력치 (20-80)
  staminaNorm = norm(stamina)   // 스태미너 능력치가 높을수록 소모 작음
  physique -= (1 - staminaNorm) * 0.4
  // 80구 이후 소모 가속 × 1.5
  // 100구 이후 소모 가속 × 2.0

지침 상태 진입:
  physique < 25  →  isExhausted = true
```

### 2-4. 긴장도 — Yerkes-Dodson 모델

```
최적 구간: 20 ~ 65   → 실수 보정 없음
너무 낮음: tension < 20   → 방심. mistakeMod = (20 - tension) / 20 * 0.25  // 최대 +25%
너무 높음: tension > 65   → 과긴장. mistakeMod = (tension - 65) / 35 * 0.25  // 최대 +25%
```

**긴장도 이벤트 테이블:**

| 이벤트 | 긴장도 변화 |
|--------|-----------|
| 삼진 (투수) | +5 |
| 피홈런 (투수) | +15 |
| 볼넷 허용 (투수) | +8 |
| 병살 유도 (투수) | -8 |
| 홈런 (타자) | -12 |
| 삼진 (타자) | +10 |
| 적시타 (타자) | -8 |
| 득점권에서 삼진 (타자) | +18 |
| 에러 (수비) | +15 |
| 도루 성공 (주자) | -6 |
| 도루 실패 (주자) | +20 |
| 이닝 종료 | -3 (긴장 해소) |

긴장도 변화 후 `clamp(0, 100)`.

### 2-5. 긴장도 역전 (실수 발생 시)

```
if tension < 20:
  // 방심 → 실수 → 과긴장으로 역전
  tension = clamp(tension + gaussian(45, 10), 55, 90)

elif tension >= 20 and tension <= 65:
  // 최적 구간 실수 → 긴장 소폭 증가 (여전히 최적 구간 내 가능)
  tension += gaussian(10, 6)

elif tension > 65:
  // 과긴장 → 실수해도 과긴장 유지 (더 올라가거나 제자리)
  tension = clamp(tension + gaussian(5, 8), tension - 5, 100)

clamp(0, 100)
```

> 방심 상태에서 실수가 나면 갑자기 과긴장 상태로 역전된다.  
> 과긴장 상태에서의 실수는 과긴장을 더욱 심화시키거나 유지한다.  
> 과긴장에서 벗어나는 것은 이닝 종료나 긍정적 이벤트를 통해서만 가능하다.

### 2-6. 퀄리티 시스템

> 투구 / 타격 / 수비 / 주루 모두 **퀄리티(0~100)** 를 먼저 뽑는다.  
> 최종 결과는 퀄리티로부터 결정된다.

```
quality = generateQuality(baseAbility, playerState)

── 기본값 ──
baseAbility:
  능력치(20-80) → norm → 기본 퀄리티 기여
  투구: stuff + command + control 조합
  타격: contact + power + eye 조합
  수비: fielding + range 조합
  주루: speed + baserunning 조합

── 상태 보정 (곱연산) ──
conditionMod  = condition / 100           // 선형
staminaMod    = isExhausted ? 0.55 : 1.0  // 지침 시 급락
tensionMod    = 1.0 - mistakeMod          // 최적 구간 이탈 시 감소

── 정규분포 편차 ──
mean   = baseAbility × conditionMod × staminaMod × tensionMod
stddev = 10 (평상시)
       → 15 (지침 상태)
       → 25 (실수 발생 시)

quality = gaussian(mean, stddev)
clamp(0, 100)
```

**실수(Mistake) 발생:**

```
// 매 플레이마다 실수 롤
mistakeProb = mistakeMod + attributesMod

attributesMod:
  focus      낮을수록 기저 mistakeMod 증가
  resilience 높을수록 실수 후 회복력 좋음 (stddev 빠르게 정상화)
  competitiveness 높을수록 중요 상황 tension 제어력 향상

실수 판정 성공 시:
  quality = gaussian(15, 8)
  clamp(0, 35)          // 극단적 저퀄리티
  → 긴장도 역전 트리거
```

**구현 상태:** ⬜

---

### 2-7. 볼데드 이벤트 처리

볼데드가 선언될 때마다 실행된다.  
이벤트 종류에 따라 관련 선수의 긴장도·컨디션·체력을 즉시 갱신하며,  
갱신된 값은 다음 **투구 계획(§3-4) · 타격 계획(§4-4) · 주루 계획(§7)** 수립에 즉시 반영된다.

**이벤트 종류별 갱신 대상:**

| 볼데드 이벤트 | 갱신 대상 | 갱신 항목 |
|---|---|---|
| 투구 결과 (스트라이크 / 볼 / 파울 / 헛스윙) | 투수, 타자 | 긴장도, 체력, 구종 컨디션(투수) |
| 타격 결과 (안타 / 아웃 / 홈런 등) | 타자, 투수, 야수 | 긴장도, 컨디션, 체력 |
| 주루 플레이 완료 (진루 / 도루 / 태그아웃 등) | 주자, 야수 | 긴장도, 컨디션, 체력 |
| 수비 플레이 완료 (실책 / 호수비 등) | 야수, 투수 | 긴장도, 컨디션, 체력 |

긴장도 갱신 → §2-4 이벤트 테이블 적용  
컨디션·체력 갱신 → §2-3 소모/회복 테이블 적용

**투수 구종 컨디션 갱신 (투구 결과 볼데드 시):**

```
직전 투구 결과를 바탕으로 해당 구종의 컨디션을 갱신한다.
소모는 없고 결과에 따라 오르내리기만 한다.

헛스윙 유도 성공        → pitchTypeCondition[type] += 3.0   // 잘 먹히고 있음
루킹 스트라이크         → pitchTypeCondition[type] += 1.0   // 위치 좋음
파울 유도 (2스트라이크) → pitchTypeCondition[type] += 1.5   // 타자가 쫓아옴
피안타 (라인드라이브+)  → pitchTypeCondition[type] -= 4.0   // 타자가 맞춰냄
피홈런                  → pitchTypeCondition[type] -= 6.0   // 완전히 읽힘
볼 (크게 벗어남)        → pitchTypeCondition[type] -= 1.5   // 제구 안 됨
연속 사용 후 피안타     → pitchTypeCondition[type] -= 2.0   // 타자 적응

clamp(40, 100)
```

**다음 계획 수립 연결:**

| 계획 | 참조하는 피드백 값 |
|---|---|
| 투구 계획 (§3-4) | 투수 긴장도, 구종 컨디션, 상황 데이터 |
| 타격 계획 (§4-4) | 타자 긴장도, 수비 대형, 상황 데이터 |
| 주루 계획 (§7) | 주자 긴장도, 상황 데이터 |

**구현 상태:** ⬜

---

## 3. 투구

### 3-1. 투수 능력치

| 능력치 | 설명 | 스케일 |
|--------|------|--------|
| `stuff` | 구위 (구종의 위력, 타자 컨택 어려움) | 20-80 |
| `command` | 커맨드 (스트라이크존으로 공을 끌어당기는 능력) | 20-80 |
| `control` | 컨트롤 (공이 도달 가능한 범위 결정) | 20-80 |
| `stamina` | 스태미너 (체력 소모 속도) | 20-80 |
| `hold` | 주자 억제 (견제 능력, 폼 다양성) | 20-80 |

**구종별 컨디션:**
각 구종마다 독립적인 컨디션 값이 존재한다 (0~100).  
경기 시작 시 플레이어 전체 컨디션을 기반으로 구종마다 임의 생성된다.  
투구 횟수에 따라 소모되지 않으며, 투구 결과 피드백에 의해서만 변동된다.  
체력·피로도·긴장도의 영향은 구종별 컨디션이 아닌 **투구 퀄리티** 단계에서 반영된다.

```js
// 경기 시작 시 초기화
pitchTypeCondition[type] = clamp(
  gaussian(playerCondition, 12),  // 전체 컨디션 기준 ±편차
  40, 100                         // 최저 40 보장 (오늘 안 좋은 구종도 기본은 있음)
)
```

### 3-2. 투구 생성 흐름

```
① 피드백 반영
② 투구 계획 생성  (투수 / 포수 각각)
③ 포수 리드 확정  (합의 or 피치클락 초과)
④ 투구 준비       (견제 / 피치클락 소모)
⑤ 투구 퀄리티 생성
⑥ 투구 생성       (Control → 범위 / Command → 존 인력)
```

---

### 3-3. ① 피드백 반영

매 투구 결과 볼데드 시 실행된다. 긴장도·체력·구종 컨디션 갱신 → **§2-7 볼데드 이벤트 처리 참조**.

갱신된 값은 다음 투구 계획(§3-4) 수립에 즉시 반영된다.

**투구 계획 수립 시 참조하는 상황 데이터:**

| 데이터 | 설명 |
|--------|------|
| 직전 투구 결과 | 피안타 / 볼 / 스트라이크 / 헛스윙 |
| 타자 타격 퀄리티 추이 | 최근 타석에서 얼마나 잘 쳤는가 |
| 타자 타격 계획 예측 | 당겨치기 / 반대 방향 / 기다림 등 (정확도는 숙련도에 따름) |
| 주자 상황 | 득점권 주자 유무, 주자 주루 위협도 |
| 스코어 차이 | 접전 / 대량 리드 / 뒤지는 상황 |
| Command / Control 현재 수준 | 전체 컨디션·체력에 의해 실시간 변동 |

---

### 3-4. ② 투구 계획 생성

> 피치클락은 이 단계에서 시작된다.

투수와 포수가 **각각 독립적으로** 투구 계획을 생성한다.

**투구 계획 구조:**

```js
{
  pitchType: string,       // 구종
  targetLocation: {x, y}, // 목표 투구 위치
  intent: {
    expectedResult: string,   // 기대 타자 반응 (swinging_strike / groundball / flyball / ...)
    targetCount: string,      // 목표 볼카운트 (예: "0-2", "선두타자 처리")
  }
}
```

**생성 기준:**

```
투수 계획:
  구종: pct 가중 + 카운트 보정 + 피드백 + 투수 특성
  위치: 카운트 전략 + 타자 약점 예측 + 피드백

포수 계획:
  구종: 타자 최근 타석 분석 + 배터리 히스토리 + 상황 판단
  위치: 투수 Command/Control 현재 수준 반영
        (Control 낮으면 안전한 위치 선택)
  의도: 타자에게 부정적인 기대 결과 + 목표 볼카운트 명시
```

**투수의 포수 계획 이해:**

```
투수는 포수의 사인을 보고 의도를 파악한다.

intentUnderstandProb = 숙련도(skill) * 0.6 + 포수와의 호흡(chemistry) * 0.4

성공 → 의도를 파악한 상태로 동의/거부 판단
실패 → 의도를 모르는 상태로 동의/거부 판단
       (의도를 모르더라도 동의할 수 있음)
```

---

### 3-5. ③ 포수 리드 확정

포수의 투구 계획을 **투수가 동의**할 때 포수 리드가 확정된다.

**동의/거부 판정:**

```
rejectProb = baseTension * 0.008          // 긴장도가 높을수록 거부 가능성 증가
           + (1 - agreeableness) * 0.05   // 선수 특성: 고집 센 투수일수록 거부 높음
           - intentUnderstood * 0.10      // 의도를 파악했을 때 거부 감소

if rand() < rejectProb:
  → 포수는 새로운 투구 계획을 재생성
  → 동의할 때까지 반복
```

**피치클락 초과:**

```
피치클락 제한 내에 합의가 이뤄지지 않으면:
  → 진행 중인 계획을 취소
  → 투수/포수 각각 계획을 조정(단순화)하여 재생성
  → 재생성된 계획은 거부 없이 확정 (피치클락 위반 방지 우선)
  → 긴장도 +5 (혼선으로 인한 증가)
```

**주자 견제 사인:**

```
포수 리드 생성 단계에서 주자 움직임에 따라 견제 사인 가능.
  seeSignProb = runnerThreat * 0.3 + catcherAlert * 0.2
  → 견제 사인 발생 시 투구 준비 단계로 넘어가기 전 견제 처리
```

---

### 3-6. ④ 투구 준비

**피치클락 소모:**

```
포수 리드 확정 후 투구 시작까지 임의 시간 소모.
  timeUsed = gaussian(baseTime, variance)
  baseTime  = 투수 특성 (루틴 길이, 신중함)
  variance  = tensionNorm * 2.0   // 긴장할수록 루틴이 불규칙해짐

실수 발생 시:
  pitchClockViolation 확률 = mistakeMod * 0.4
  → 위반 발생 시 볼 추가
```

**견제 시도:**

```
주자가 있을 때 매 투구 준비마다 판정.

pickoffAttemptProb = runnerThreat * 0.25
                   - holdNorm * 0.15   // 주자 억제 능력 높을수록 불필요한 견제 줄임
                   + tension_excess    // 과긴장 시 견제 충동 증가

견제 성공/실패 → 주자 상태 변경 (§7 주루 참조)
```

**주자의 투수 압박:**

```
주자의 baserunning / stealing 능력치에 따라:
  → 투수 피로도 증가 확률 상승
  → 투수 긴장도 증가 확률 상승

압박 증가율 = runnerStealingNorm * 0.15
투수 억제:   holdNorm 으로 감쇠  → 실제 증가율 = 압박 * (1 - holdNorm * 0.6)
```

---

### 3-7. ⑤ 투구 퀄리티 생성

투구를 시작하는 순간 퀄리티가 결정된다.  
구종별 컨디션은 "오늘 이 공이 얼마나 날카로운가"를 나타내고,  
체력·피로도·긴장도는 "지금 이 순간 얼마나 잘 던질 수 있는가"를 나타낸다.

```
pitchTypeCondition = 해당 구종의 개별 컨디션 (40~100, 결과 피드백으로만 변동)

physiqueMod  = isExhausted ? 0.55 : lerp(0.75, 1.0, physique / 100)
               // physique: 경기별 생성 체력값 (능력치 stamina 아님)
tensionMod   = 1.0 - mistakeMod                  // §2-4 참조
conditionMod = playerCondition / 100             // 전체 컨디션

pitchQuality = generateQuality(
  base: (stuff / 80)               * 0.35  // 구위 (능력치)
      + (pitchTypeCondition / 100)  * 0.30  // 오늘 이 구종의 날카로움
      + conditionMod                * 0.20  // 전체 컨디션
      + attributesMod               * 0.15  // focus, resilience 등

  multiplier: physiqueMod * tensionMod     // 체력·긴장도로 전체 스케일 조정

  stddev: 8 (평상시) → 14 (지침 상태) → 22 (실수 발생 시)
)

// 구종별 컨디션은 이 단계에서 소모하지 않음
// 투구 결과가 나온 후 피드백 반영 단계(①)에서 갱신
```

---

### 3-8. ⑥ 투구 생성

**Control — 도달 가능 범위 결정:**

```
controlNorm = norm(control) * conditionMod * staminaMod

// Control이 결정하는 것: 공이 실제로 도달할 수 있는 범위(반경)
controlRadius = 2.5 - controlNorm * 2.0
// control 20 → radius 2.5 (거의 어디든 갈 수 있음 / 제구 불안)
// control 80 → radius 0.5 (매우 좁은 범위)

// 범위 내에서 실제 도달 지점 선택 (정규분포)
rawLocation = {
  x: gaussian(targetLocation.x, controlRadius * 0.4),
  y: gaussian(targetLocation.y, controlRadius * 0.4),
}
clamp to ±3.0
```

**Command — 스트라이크존 인력:**

```
commandNorm = norm(command) * conditionMod

// Command가 결정하는 것: 스트라이크존 방향으로 끌어당기는 강도
// rawLocation이 controlRadius 내에 있을 때
// 가장 가까운 존 경계 방향으로 가중 이동

nearestZonePoint = 존 경계에서 rawLocation에 가장 가까운 점
pullStrength     = commandNorm * 0.45   // 최대 45% 이동

finalLocation = rawLocation + (nearestZonePoint - rawLocation) * pullStrength
// 결과: 공이 존 쪽으로 은근히 끌려오는 효과
```

**최종 판정:**

```
classifyPitch(finalLocation):
  inZone = |x| ≤ (ZONE_X + BALL_R + umpVariance)
         && |y| ≤ (ZONE_Y + BALL_R + umpVariance)
  umpVariance = gaussian(0, 0.06)   // 심판 일관성 편차

  → called_strike | ball
```

**구속:**

```
velocity = targetVelo
         × (0.85 + pitchQuality/100 * 0.15)   // 퀄리티 반영
         - fatigueDrop                          // 피로 저하
         + gaussian(0, 1.2)                    // 자연 편차
```

### 3-9. 좌표계

```
캐처 시점 기준
  x: 몸쪽(−) ↔ 바깥쪽(+)  |  1.0 = 홈플레이트 반폭(8.5인치)
  y: 낮은(−) ↔ 높은(+)    |  1.35 = 존 상하 반높이
  공 반지름 BALL_R = 0.17  → 걸치면 스트라이크
```

**구현 상태:** 🔨 (기본 흐름 구현됨 / 퀄리티·포수리드·피치클락 ⬜)

---

## 4. 타격

### 4-1. 타자 능력치

| 능력치 | 설명 | 스케일 |
|--------|------|--------|
| `contact` | 컨택 (공을 맞히는 능력) | 20-80 |
| `contact_l` / `contact_r` | 좌/우투수 상대 컨택 | 20-80 |
| `power` | 장타력 | 20-80 |
| `eye` | 선구력 (볼/스트라이크 판별) | 20-80 |
| `speed` | 발빠름 | 20-80 |
| `bunt` | 번트 능력 | 20-80 |

### 4-2. 타격 생성 흐름

```
① 피드백 반영
② 타격 계획      (예측 구종·존 수립 → ③의 선입견으로 작용)
③ 판단           (eye + 투구 퀄리티로 구종·위치 최종 판단 / 예측이 선입견으로 영향)
④ 스윙 레벨 생성
⑤ 타구 퀄리티 생성
⑥ 타구 벡터 생성
```

---

### 4-3. ① 피드백 반영

볼데드 시마다 긴장도·체력 갱신 → **§2-7 볼데드 이벤트 처리 참조**.

갱신된 값은 다음 타격 계획(§4-4) 수립에 즉시 반영된다.

**타격 계획 수립 시 참조하는 상황 데이터:**

| 데이터 | 설명 |
|--------|------|
| 직전 타석 결과 | 안타 / 삼진 / 볼넷 / 범타 |
| 현재 볼카운트 | 유리/불리 여부 |
| 주자 상황 | 득점권 유무, 주자 부담 |
| 스코어 차이 | 접전 / 대량 리드 / 역전 필요 |
| 투수 현재 상태 | 구속 추이, 최근 제구 |
| 포수 리드 경향 | 이 타석에서 어떤 공이 올 것인가 |
| 수비 대형 | 시프트 여부 / 내야 전진 수비 여부 |

---

### 4-4. ② 타격 계획

투수가 투구하기 전, 타자가 이번 투구에 대한 대응 계획을 수립한다.

**타격 계획 구조:**

```js
{
  predictedPitchType: string | null, // 예측 구종. 무계획 시 null
  predictedZone:      ZoneRegion,    // 예측 존. 무계획 시 null
  tactic:             Tactic,        // 작전 수행
  targetBallResult:   BallResult,    // 목표 타구 (긍정 결과만)
  targetSwingLevel:   number,        // 목표 스윙 레벨 0~100
}
```

**예측 구종 (predictedPitchType) / 예측 존 (predictedZone):**

```
피드백 단계에서 해석한 상황 데이터 + 숙련도(skill) 기반으로 결정.
eye 능력치는 이 단계에서 직접 관여하지 않음.

숙련도 높음 → 투수 패턴 분석 정확 → 특정 구종·존을 좁혀 예측할 수 있음
숙련도 낮음 → 분석 부정확 → null로 흐를 가능성 높음

무계획 타격(no plan):
  예측 구종 = null  // 특정 구종을 예측하지 않음
  예측 존   = null  // 특정 코스를 예측하지 않음
  → 오는 공에 반응만 하는 상태
  → 숙련도 낮거나 상황 해석이 불확실할 때 발생
  → 역설적으로 투수의 의도를 벗어나는 결과가 나오기도 함

ZoneRegion:
  'inside'   — 몸쪽
  'outside'  — 바깥쪽
  'high'     — 높은 코스
  'low'      — 낮은 코스
  'center'   — 한가운데
  null       — 무계획
```

**작전 수행 (tactic):**

| 작전 | 조건 | 설명 |
|------|------|------|
| `full_swing` | 기본 | 풀스윙 |
| `contact` | 투수 유리 카운트 / 주자 있음 | 컨택 우선, 인플레이 지향 |
| `bunt` | 감독 지시 / 번트 상황 | 번트 능력치 사용 |
| `sacrifice_fly` | 3루 주자 있음 | 외야 플라이 의도 |
| `hit_and_run` | 주자 1루 + 감독 지시 | 스윙 강제, 주자 동시 출발 |
| `take` | 3볼 or 투수 제구 난조 | 스윙 없음, 기다림 |
| `opposite_field` | 바깥쪽 공 노림 | 반대 방향 타구 의도 |

**목표 타구 (targetBallResult):**

```
타자가 만들어내고 싶은 타구의 종류. 의도형으로 정의하며 null = 목표 없음 (아무거나).
삼진·팝업 등 부정 결과는 목표로 생성되지 않음. 안치기(take)는 tactic으로 표현.

방향이 있는 타구는 전술적 이유가 있을 때 생성된다:
  grounder / line_drive 좌측  — 시프트 역이용 (열린 좌측 공간 공략)
  grounder / line_drive 우측  — 1루수 이탈 시 1-2루 간 공략, 주자 진루
  bloop                       — 내야 전진 수비 시 내야수 뒤 공간 노림
  deep_fly_right_or_center    — 2루 주자 3루 진루 목적 (우중간이 유리)

TargetBallResult:

  // 땅볼
  'grounder_any'        — 방향 무관 강한 땅볼
  'grounder_left'       — 좌측 방향 땅볼  (시프트 역이용 등)
  'grounder_center'     — 중앙 방향 땅볼
  'grounder_right'      — 우측 방향 땅볼  (진루타, 1-2루 간 공략)

  // 직선
  'line_drive_left'     — 좌측 직선 타구  (시프트 역이용 등)
  'line_drive_center'   — 중앙 직선 타구
  'line_drive_right'    — 우측 직선 타구  (1-2루 간 공략)

  // 플레어 — 배트를 짧게 쥐고 내야수 키를 살짝 넘기는 타구
  'bloop_left'          — 좌측 플레어
  'bloop_right'         — 우측 플레어
  'bloop_any'           — 방향 무관 플레어

  // 뜬공 — 방향 의도 가능 (주자 진루 전술 등)
  'deep_fly_any'              — 방향 무관 깊은 뜬공 (희생 플라이 등)
  'deep_fly_right_center'  — 중앙~우측 방향 깊은 뜬공 (2루 주자 3루 진루 목적)

  // 홈런
  'home_run'            — 담장을 넘기는 강한 타구

  // 번트
  'sharp_bunt'          — 빠르고 예리하게 찍어내는 번트 (기습)
  'soft_bunt'           — 부드럽게 굴리는 번트 (보내기)
```

**목표 스윙 레벨 (targetSwingLevel):**

```
이번 투구에 대해 타자가 계획하는 목표 스윙 레벨.
실제 스윙 레벨 생성(④단계)의 기준값으로 사용된다.

결정 요소:
  작전 수행(tactic):
    full_swing      → targetSwingLevel 높음 (80~100)
    contact         → targetSwingLevel 중간 (50~70)
    opposite_field  → targetSwingLevel 중간 (50~70)
    bunt            → targetSwingLevel 낮음 (20~40)
    take            → targetSwingLevel = 0 (스윙 없음)

  목표 타구:
    home_run                          → 높음 보정
    deep_fly_* / line_drive_*         → 중간~높음 보정
    grounder_* / bloop_*              → 중간 보정
    sharp_bunt / soft_bunt            → 낮음 보정 (정확성 우선)

  상황:
    풀카운트 (3-2)    → 보정 없음 (반응 우선)
    투수 유리 카운트  → 낮춰서 정확성 확보
    타자 유리 카운트  → 높여서 강하게 노림
```

**구현 상태:** ⬜

---

### 4-5. ③ 투구 판단

투수가 공을 릴리스하는 순간 타자는 구종과 투구 위치를 최종 판단한다.  
타격 계획의 **예측 구종·예측 존이 선입견으로 작용**해 판단에 영향을 미친다.  
선입견은 예측이 맞을 때는 판단을 강화하고, 틀릴 때는 판단을 방해한다.

**구종 판단:**

```
judgementAccuracy = eyeNorm * 0.6 - (pitchQuality / 100) * 0.4

선입견 효과:
  예측 구종 = 실제 구종  → 판단 정확도 상승 (확신이 맞아떨어짐)
  예측 구종 ≠ 실제 구종  → 오판 확률 상승 (선입견이 방해)
  예측 구종 null         → 선입견 없음, 순수 eye + 퀄리티로만 판단 (중립)

오판 계층 (오판 발생 시 어느 구종으로 잘못 판단하는가):
  1순위: 인접 구종 오판
    포심↔투심, 투심↔싱커, 커터↔슬라이더, 체인지업↔포크, 슬라이더↔커브

  2순위: 속구↔변화구 계열 혼동 (실전에서 가장 흔한 오류)
    포심→체인지업·슬라이더, 투심→체인지업, 체인지업→포심·투심·싱커 등

  3순위: 완전 오판 (가장 드묾)
```

**투구 위치 판단:**

```
예측 존(predictedZone)이 선입견으로 작용.

  예측 존 = 실제 코스  → 위치 판단 오차 감소 (예측한 쪽에서 오니까 잘 보임)
  예측 존 ≠ 실제 코스  → 위치 판단 오차 증가 (의외의 코스, 대처 늦어짐)
  예측 존 null         → 중립 (선입견 없이 오는 공 그대로 봄)

// 예측 구종이 틀렸을 경우 예측 위치 중심 자체가 어긋남
// (체인지업 예측했는데 포심이 오면 높은 쪽을 전혀 보지 않고 있었음)
```

**판단 결과 유형:**

| 결과 | 조건 | 스윙 레벨 영향 |
|------|------|--------------|
| 선입견 강화 | 예측 구종·존 = 실제 | 유리한 보정 |
| 정확 판단 (무계획) | null 상태에서 판단 성공 | 소폭 유리 |
| 중립 판단 (무계획) | null 상태에서 중간 | 보정 없음 |
| 선입견 방해 | 예측 구종·존 ≠ 실제 | 불리한 보정 |
| 속구↔변화구 혼동 | 계열 자체 오판 | 매우 크게 불리 |

**구현 상태:** ⬜

### 4-6. ④ 스윙 레벨 생성

③ 투구 판단 결과로 형성된 예측 위치 분포가 스트라이크 존과 겹치는 비율(strikeZoneOverlap)과
타격 계획을 바탕으로 스윙 여부와 스윙 강도를 결정한다.

**스트라이크 존 오버랩 (strikeZoneOverlap):**

```
③ 투구 판단 결과로 형성된 예측 위치 분포 중 스트라이크 존에 해당하는 비율.

  1.0 — 존 한가운데, 확실한 스트라이크
  0.5 — 경계 부근, 절반은 스트라이크
  0.0 — 완전히 존 밖, 확실한 볼
```

**스윙 여부 결정:**

```
우선순위:

  1. tactic = 'take' (감독 테이크 사인)
     → 무조건 노스윙

  2. targetBallResult = 'take' (타자 자율 기다림)
     → swingThreshold = 0.85~0.95 (거의 완벽한 스트라이크가 아니면 보냄)

  3. targetBallResult = null (아무거나)
     → swingThreshold = eye 기반

  4. targetBallResult = 특정 타구
     → swingThreshold = eye 기반 + planMod

swingThreshold 결정:

  baseThreshold(eye):
    eye 높음 → threshold 높음  // 확실한 스트라이크만 스윙
    eye 낮음 → threshold 낮음  // 애매한 공도 스윙

  planMod (targetBallResult):
    'home_run'          → -0.10  // 적극적 스윙
    'deep_fly_*'        → -0.05
    'line_drive_*'      →  0.00
    'grounder_*'        →  0.00
    'bloop_*'           → -0.08  // 컨택 우선
    'sharp_bunt'        → -0.10
    'soft_bunt'         → -0.10

strikeZoneOverlap >= swingThreshold → 스윙
strikeZoneOverlap <  swingThreshold → 노스윙
```

**스윙 레벨 결정:**

```
base = targetSwingLevel  // ② 타격 계획 기준값
       (targetBallResult = null 이면 카운트·상황 기반 default)

보정:

  1. 오버랩 신뢰도:
     (strikeZoneOverlap - swingThreshold) 클수록 확신 → 상향
     // 스트라이크 존 한가운데일수록 강하게 스윙

  2. ③ 투구 판단 결과:
     선입견 강화 (예측 적중)   → × 1.10
     정확 판단 (무계획 성공)   → × 1.03
     중립 판단 (무계획 보통)   → 보정 없음
     선입견 방해 (예측 빗나감) → × 0.85
     속구↔변화구 계열 혼동     → × 0.65

  3. 긴장도 보정 (Yerkes-Dodson):
     최적 구간 (20~65) → 보정 없음
     방심 구간 (<20)   → × 0.90
     과긴장 구간 (>65) → × (1 - (tension - 65) / 200)

  4. 컨디션 보정:
     × (0.80 + condition / 100 * 0.20)

  5. 선수 특성 보정:
     power 높음 + home_run / deep_fly_* → 상한 보정 +
     contact 높음 + grounder_* / bloop_* → 안정적 레벨 유지
     speed 높음 + sharp_bunt            → 낮은 레벨로 충분

swingLevel = clamp(rawSwingLevel + gaussian(0, 3), 0, 100)
```

**타격 계획별 양상:**

| targetBallResult | swingThreshold | swingLevel 경향 |
|---|---|---|
| `'take'` | 0.85~0.95 | 노스윙 |
| null | eye 기반 | 카운트·상황 기반 |
| `'home_run'` | 낮음 | 높음 (85~100) |
| `'deep_fly_*'` | 낮음 | 중~높음 (65~85) |
| `'line_drive_*'` | 중간 | 중간 (55~75) |
| `'grounder_*'` | 중간 | 중간 (45~65) |
| `'bloop_*'` | 낮음 | 낮~중간 (25~50) |
| `'sharp_bunt'` | 낮음 | 낮음 (20~35) |
| `'soft_bunt'` | 낮음 | 낮음 (15~30) |

**구현 상태:** ⬜

---

### 4-7. ⑤ 타구 퀄리티 생성

스윙 레벨에 따라 스윙 유형을 결정하고, 타구가 발생하면 quality(0~100)를 산출한다.

**스윙 유형 결정:**

```
스윙 레벨에 따라 스윙의 성격이 결정된다.

  swingLevel = 0          → 노스윙
  swingLevel 1 ~ 20       → 체크 스윙
  swingLevel 21 ~ 45      → 뒤늦은 스윙
  swingLevel 46 ~ 75      → 일반 스윙
  swingLevel 76 ~ 100     → 자신감 있는 스윙 (풀스윙에 가까울수록 파워 증가)
```

**스윙 유형별 가능한 결과:**

```
노스윙
  → 타구 없음

체크 스윙
  → 노스윙 (배트 멈춤)
  → 헛스윙
  → 컨택 불리 (quality 크게 감점 후 타구 발생)

뒤늦은 스윙
  → 헛스윙
  → 컨택 불리 (quality 감점 후 타구 발생)

일반 스윙 / 자신감 있는 스윙
  → 헛스윙 (위치 괴리 클 경우)
  → 타구 발생 → quality 산출
```

**헛스윙 판정:**

```
예측 위치(judgedLocation)와 실제 위치(pitchLocation)의 괴리가 클수록 헛스윙 확률 상승.

locationError = distance(pitchLocation, judgedLocation)   // 존 단위

whiffProb = locationError * whiffSensitivity
  whiffSensitivity: contact 낮을수록, swingLevel 높을수록 민감
  // 풀스윙으로 크게 벗어난 공 → 헛스윙 확률 급상승
```

**타구 퀄리티 산출:**

```
기반 요소 (높을수록 quality 상승):
  swingLevel            — 스윙 레벨이 높을수록 강한 타구 가능성 증가
  위치 예측 정확도       — judgedLocation ≈ pitchLocation 일수록 유리
  contact (좌/우투수)   — 상대 투수 투구팔 기준 effectiveContact 적용
  투구 퀄리티 역수       — pitchQuality 낮을수록 타자에게 유리

계산:

  effectiveContact = pitcherIsLeft ? contact_l : contact_r
  contactNorm      = norm(effectiveContact)   // 20-80 → 0.0~1.0

  locationBonus    = max(0, 1 - locationError) * 20  // 예측 정확할수록 최대 +20
  pitchPenalty     = pitchQuality * 0.3              // 투구 퀄리티 높을수록 감점

  baseQuality = contactNorm * 55 + swingLevel * 0.25 + locationBonus - pitchPenalty

  // 스윙 유형 보정
  체크 스윙 (swingLevel < 20):  baseQuality *= 0.35  // 땅볼 수준의 약한 타구
  뒤늦은 스윙 (swingLevel < 45): baseQuality *= 0.65  // 컨택 불리

  // 컨디션·긴장도 보정 (§2 참조)
  quality = baseQuality × conditionMod × tensionMod

  quality = clamp(quality + gaussian(0, 5), 0, 100)
```

**퀄리티 구간:**

| quality | 타구 경향 |
|---------|----------|
| 0 ~ 14  | 극히 약한 타구 (대부분 파울·팝업) |
| 15 ~ 34 | 약한 타구 (팝업·내야 땅볼 위험) |
| 35 ~ 59 | 보통 타구 |
| 60 ~ 79 | 강한 타구 |
| 80 ~ 100 | 완벽한 타구 (라인드라이브·장타 지향) |

**구현 상태:** ⬜

---

### 4-8. ⑥ 타구 벡터 생성

타구 퀄리티와 공의 타격 위치(contactPoint)로 초기 벡터를 결정하고,
이후 스핀·바람·바운드 등 물리 법칙에 따라 타구가 운동한다.

**출력 구조:**

```js
{
  exitVelo:    number,          // 타구 초기 속도 (km/h)
  launchAngle: number,          // 발사각 (degree, -10 ~ 90)
  direction:   number,          // 방향 (degree, 0=3루선, 90=중앙, 180=1루선)
  spin:        { top, back, side },  // 스핀 성분
  type:        string,          // 'grounder' | 'line_drive' | 'fly_ball' | 'popup' | 'foul'
}
```

**공의 타격 위치 (contactPoint):**

```
타자가 공의 어느 부분을 맞추느냐에 따라 발사각·방향·스핀의 기본값이 결정된다.

contactPoint = (cx, cy)   // 공 중심 기준 오프셋 (-1.0 ~ 1.0)

  cy > 0  (공 윗부분)  → 탑스핀 → 낮은 발사각 → 땅볼 경향
  cy ≈ 0  (공 중앙)   → 라인드라이브 경향
  cy < 0  (공 아랫부분) → 백스핀 → 높은 발사각 → 뜬공·홈런 경향
  cx > 0  (우타자 기준 공 안쪽) → 당겨치기 방향
  cx < 0  (우타자 기준 공 바깥쪽) → 밀어치기 방향

contactPoint 결정 요소:
  투구 위치(pitchLocation)   — 기본 컨택 포인트 설정
  targetBallResult           — 타자가 의도한 타격 위치
  quality                    — 낮을수록 contactPoint 오차 증가
                               (quality 높음 → 의도한 위치에 정확히 맞춤)
```

**타구 속도 (exitVelo):**

```
// 속도는 Power 능력치가 주도하고, quality는 편차 범위를 담당한다.

powerNorm    = norm(power)              // 20-80 → 0.0~1.0
baseExitVelo = 90 + powerNorm * 50     // 90~140 km/h
swingBoost   = (swingLevel - 50) * 0.3
qualityScale = 0.55 + (quality / 100) * 0.45
// quality=0   → × 0.55  (최저 55%)
// quality=50  → × 0.775
// quality=100 → × 1.0

exitVelo = (baseExitVelo + swingBoost) * qualityScale
         + gaussian(0, 3)
clamp(20, 175)
```

**발사각 (launchAngle):**

```
// contactPoint.cy 기반
launchAngle = -cy * 45                              // cy=1 → -45°, cy=-1 → +45°
            + (1 - quality / 100) * gaussian(0, 12) // 퀄리티 낮을수록 편차 증가
clamp(-10, 90)
```

**방향 (direction):**

```
// 기준: 90° = 중앙(2루 방향), 0° = 3루 파울선, 180° = 1루 파울선 (우타자 기준)
// 0° 미만 / 180° 초과 = 홈플레이트 뒤쪽 파울 영역
// 왼손 타자는 좌우 반전

direction = 90 - cx * 30                            // cx=1(당겨치기) → 60°, cx=-1(밀어치기) → 120°
          + (1 - quality / 100) * gaussian(0, 15)
// 범위 제한 없음 — 뒤로 빠지는 파울팁·백스크린 팝업도 표현 가능
// 타구 처리(§5)에서 direction < 0 or > 180 → 파울 뒤쪽으로 처리
```

**스핀 (spin):**

```
// 타격 위치에 따라 결정. 타구가 날아가면서 휘어지는 방향을 주로 결정한다.

sidespin ∝ cx  — 타구가 진행 방향으로 휘어짐 (당겨친 타구는 파울선 쪽으로 훅)
topspin  ∝ cy > 0  — 수직 하강 가속 (바운드 짧고 낮음)
backspin ∝ cy < 0  — 수직 체공 유지 (외야 깊이 진행)

// 예: 강하게 당겨친 타구 → sidespin → 비행 중 더 당겨지는 방향으로 휨
//     밀어친 타구 → 반대 방향 sidespin → 반대 방향으로 휨
```

**타구 물리 운동:**

```
초기 벡터(exitVelo, launchAngle, direction, spin)를 기반으로
타구는 아래 물리 요소에 따라 운동한다.

  스핀    — 타구가 비행 중 휘어지는 방향 결정 (sidespin → 훅/슬라이스, topspin/backspin → 수직 궤적)
  바람    — 방향·세기에 따라 뜬공·외야 타구 궤적 보정
  바운드  — 땅에 닿는 각도·속도에 따라 첫 바운드 높이·방향 결정
            (경기장 표면: 잔디·흙·습도 등 반영)
  중력    — 표준 물리 법칙 적용
```

**타구 유형 분류:**

```
if direction < 0 or direction > 180:
  type = 'foul_back'    // 홈플레이트 뒤쪽 파울
elif direction < 5 or direction > 175:
  type = 'foul'         // 파울라인 바깥 파울
elif launchAngle < 10:
  type = 'grounder'
elif launchAngle < 25:
  type = 'line_drive'
elif launchAngle < 50:
  type = 'fly_ball'
else:
  type = 'popup'
```

**타격 결과 → §5 타구 처리로 전달:**

```js
{
  exitVelo,
  launchAngle,
  direction,
  spin,
  type,
  batter: { speed, ... },
  quality,
}
```

**구현 상태:** ⬜

---

## 5. 타구 처리

### 5-1. 홈런 판정

```
distance = f(exitVelo, launchAngle)   // 물리 기반 추정
fenceDistance = getFenceDistance(direction)  // 구장 방향별 펜스 거리
isHR = distance > fenceDistance
```

### 5-2. 인필드 타구

```
방향 → 담당 야수 결정 (3루수 / 유격수 / 2루수 / 1루수)
range 판정 → 처리 가능 여부
에러 판정
아웃/세이프 → 타자 주루 속도 + 야수 송구
```

### 5-3. 외야 타구

```
방향 + 거리 → 담당 외야수 (좌·중·우)
range 판정 → 아웃 or 안타
안타 종류: 단타 / 2루타 / 3루타 (거리 + 주자 speed)
```

**구현 상태:** ⬜

---

## 6. 수비

### 6-1. 야수 능력치

| 능력치 | 설명 |
|--------|------|
| `fielding` | 기본 수비 (에러율) |
| `range` | 수비 범위 |
| `arm` | 송구 능력 |
| `blocking` | 포수 블로킹 (폭투 저지율) |

### 6-2. 수비 품질

```
defenseQuality = generateQuality(
  base: fielding * 0.5 + range * 0.5,
  state: playerGameState
)
```

### 6-3. 수비 판정 흐름

```
1. 타구 도달 위치 계산
2. 해당 야수까지 거리 계산
3. range 내 여부 (defenseQuality 반영)
4. 에러 판정: base(0.03) + (1 - defenseQuality/100) * 0.10
5. 아웃 시 송구 판정: armNorm 기반
```

### 6-4. 병살 판정

```
조건: 1루 주자 + 0,1아웃 + 땅볼
dpProb = defenseQuality / 100 * 0.55 + rangeNorm * 0.20 + 상황보정
// 타자 speed에 따라 완성 여부 결정
```

**구현 상태:** ⬜

---

## 7. 주루

### 7-1. 주자 능력치

| 능력치 | 설명 |
|--------|------|
| `speed` | 주루 속도 |
| `baserunning` | 주루 판단력 |
| `stealing` | 도루 능력 |

### 7-2. 주루 품질

```
basrunQuality = generateQuality(
  base: speed * 0.5 + baserunning * 0.5,
  state: playerGameState
)
```

### 7-3. 진루 판정

```
안타 종류 + basrunQuality + 야수 arm → 진루 베이스 수 결정

단타:
  1루 → 2루: 항상
  2루 → 홈: basrunQuality + speed vs 야수 arm
  1루 → 3루: basrunQuality 높고 공이 앞에 떨어질 때

2루타:
  1루 → 홈: speed
  2루 → 홈: 항상 (느린 주자는 3루에서 멈춤)

플라이볼 (아웃):
  태그업 여부 = basrunQuality > 임계값 + 야수 arm 고려
```

### 7-4. 도루

```
stealProb = stealingNorm * 0.6
          + speedNorm * 0.25
          - catcherArmNorm * 0.30
          - pitcherHoldNorm * 0.15

basrunQuality 낮음 → 타이밍 실패 확률 증가
```

### 7-5. 비정상 주루 이벤트

| 이벤트 | 결과 |
|--------|------|
| 폭투 | 3루 주자 득점 / 나머지 한 칸 전진 |
| 보크 | 모든 주자 한 칸 전진 |
| HBP | 1루 + 밀어내기 |
| 볼넷 | HBP와 동일 |

**구현 상태:** ⬜

---

## 8. 공통 능력치 스케일

### 8-1. 20-80 스케일

```
20 = 리그 최하위 수준
50 = 리그 평균
80 = 역대 최상위 수준

norm(v) = clamp((v - 20) / 60, 0, 1)  →  0.0 ~ 1.0
```

### 8-2. 퀄리티 → 결과 변환 기준 (참고)

| 퀄리티 구간 | 의미 |
|------------|------|
| 85 ~ 100 | 최상 (엘리트 플레이) |
| 65 ~ 84 | 양호 (평균 이상) |
| 40 ~ 64 | 평균 |
| 20 ~ 39 | 불량 (실수 가능성 높음) |
| 0 ~ 19 | 실수 (Mistake 발생 구간) |

### 8-3. 구현 순서 로드맵

| 순서 | 모듈 | 의존성 | 상태 |
|------|------|--------|------|
| 1 | 투구 (PitchSimulator) | — | ✅ |
| 2 | 선수 게임 상태 (PlayerGameState) | — | ⬜ |
| 3 | 타격 (BatterSimulator) | 투구 위치 + 게임 상태 | ⬜ |
| 4 | 타구 처리 (BallInPlayResolver) | 타격 결과 | ⬜ |
| 5 | 수비 (DefenseSimulator) | 타구 + 게임 상태 | ⬜ |
| 6 | 주루 (BaserunningSimulator) | 타구 + 수비 + 게임 상태 | ⬜ |
| 7 | 경기 엔진 (GameEngine) | 전체 조합 | ⬜ |
| 8 | 경기 UI | GameEngine | ⬜ |
