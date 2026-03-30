---
name: 드래프티 신인 투수 평가 시스템
description: rookie_pitcher_scouting 테이블 구조, evaluateRookie 공식, 입력 방법 전체 정리
type: project
---

# 드래프티 신인 투수 평가 시스템

**관련 파일**
- DB 테이블: `rookie_pitcher_scouting`
- 평가 로직: `src/utils/pitcherEval.js` — `evaluateRookie()` (line 607)
- 데이터 연결: `src/hooks/useData.js` (line 331~354)

---

## 1. 적용 조건

`pitcher_season_stats`가 없는 투수 + `rookie_pitcher_scouting`에 row가 있으면 → `evaluateRookie()`로 능력치 생성.

시즌 스탯이 한 시즌이라도 생기면 신인 평가 무시하고 `evaluatePitcher()`로 전환됨.

---

## 2. rookie_pitcher_scouting 테이블 컬럼

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `player_id` | text | players.id (FK) |
| `draft_year` | int | 드래프트 연도 |
| `draft_round` | int | 드래프트 라운드 (1~10+) |
| `draft_pick` | int | 지명 순서 |
| `age` | int | 지명 당시 나이 |
| `max_velo` | numeric | 최고 구속 (km/h) |
| `avg_velo` | numeric | 평균 구속 (km/h), 없으면 max×0.96 사용 |
| `command_grade` | int | 커맨드 스카우팅 등급 (0~80, 기준 50=평균) |
| `control_grade` | int | 컨트롤 스카우팅 등급 (0~80, 기준 50=평균) |
| `grade_4seam` | int | 4심 패스트볼 등급 (null = 미보유) |
| `grade_2seam` | int | 2심 패스트볼 등급 |
| `grade_cutter` | int | 커터 등급 |
| `grade_curve` | int | 커브 등급 |
| `grade_slider` | int | 슬라이더 등급 |
| `grade_changeup` | int | 체인지업 등급 |
| `grade_sinker` | int | 싱커 등급 |
| `grade_fork` | int | 포크볼 등급 |

**등급 스케일**: 스카우팅 관행상 20~80 스케일 사용. 50=평균, 60=평균이상, 70=플러스, 80=엘리트.

---

## 3. 능력치 계산 공식 (evaluateRookie)

### ROOKIE_BASE (드래프트 라운드별 기준값)
```
1라운드  → 36
2~3라운드 → 32
4~5라운드 → 29
6라운드+  → 26
```

### toKBO 변환
```
toKBO(raw) = ROOKIE_BASE + (raw - 50) × 0.3
범위: 20~80 클램프
```
스카우팅 편차의 **30%만 반영** — 신인은 검증되지 않았으므로 실전 기준으로 대폭 할인.

### Stuff (구위)
```
veloZ = (avgVelo - 145) / 3.5         // KBO 평균 145km, std 3.5
maxBonus = max(0, (maxVelo - 155) × 0.5)  // 155km+ 엘리트 보너스
stuffFromVelo = clamp(50 + veloZ×10 + maxBonus, 20, 80)

avgBreaking = 보유 구종 등급 평균 (없으면 50)

stuffRaw = stuffFromVelo × 0.6 + avgBreaking × 0.4
stuff = toKBO(stuffRaw)
```

### Command (커맨드)
```
command = toKBO(commandGrade)
```

### Control (컨트롤)
```
control = toKBO(controlGrade)
```

### Holding (주자억제)
```
holding = ROOKIE_BASE  // 데이터 없음 → base 고정
```

### Stamina (체력)
```
ageBonus  = age >= 22 ? 2 : 0
draftBonus = draft_round == 1 ? 1 : 0
stamina = min(80, ROOKIE_BASE - 3 + ageBonus + draftBonus)
```

---

## 4. 목표 OVR 범위

| 라운드 | 목표 OVR |
|--------|----------|
| 1라운드 | 36~40 |
| 2~3라운드 | 32~36 |
| 4~5라운드 | 30~33 |
| 6라운드+ | 27~30 |

---

## 5. 데이터 수집 가이드 (새 신인 입력 시)

웹(나무위키, 고교야구, 각 구단 공식 채널)에서 수집해야 할 정보와 평가 기준.

### 수집 항목 & 평가 기준

| 항목 | 수집처 | 평가 기준 |
|------|--------|-----------|
| `draft_round` / `draft_pick` | 나무위키 드래프트 문서, KBO 공식 | 사실값 그대로 |
| `age` | 생년월일 → 드래프트 연도 기준 만 나이 | 사실값 그대로 |
| `max_velo` | 나무위키, 구단 소개, 고교야구 기사 | 기재된 최고구속 |
| `avg_velo` | 기사/영상, 없으면 max × 0.96 추정 | 불펜형은 max × 0.97 내외 |
| `grade_*` (구종) | 나무위키 구종 항목, 경기 영상 기사 | 언급 없는 구종 = null |
| `command_grade` | "제구 좋다 / 나쁘다" 평가 | 50=평균, 60=좋음, 45=불안 |
| `control_grade` | 볼넷/피안타 경향, 위기관리 | 50=평균, 60=좋음 |

### 구종 등급 기준 (20~80 스케일)
- **45 이하**: 평균 이하, 보조 구종도 되기 어려움
- **50**: KBO 평균 수준
- **55**: 평균 이상, 유효한 구종
- **60**: 플러스 구종, 믿을 수 있는 무기
- **65+**: 엘리트 구종 (고졸 신인에겐 거의 없음)

---

## 6. DB 입력 예시 (SQL)

```sql
INSERT INTO rookie_pitcher_scouting
  (player_id, draft_year, draft_round, draft_pick, age,
   max_velo, avg_velo, command_grade, control_grade,
   grade_4seam, grade_curve, grade_slider, grade_changeup)
VALUES
  ('PLAYER_ID', 2026, ROUND, PICK, AGE,
   MAX_KMH, AVG_KMH, CMD, CTL,
   GRADE_OR_NULL, GRADE_OR_NULL, GRADE_OR_NULL, NULL);
```

보유하지 않는 구종은 `null`로 입력. grade_*가 null인 구종은 구종 레이더에 표시되지 않음.

---

## 7. 입력 사례

### 박준현 (player_id: 2974) — 2026 1라운드 1순번

```
draft_year: 2026, draft_round: 1, draft_pick: 1, age: 18
max_velo: 157.0, avg_velo: 150.0
command_grade: 55, control_grade: 55
grade_curve: 55, grade_slider: 60
(나머지 구종 null)
```

---

### 이준서 (player_id: 2927) — 2026 7라운드 4순번 (전체 64번)

**출처**: 나무위키 이준서(2006), 2026 KBO 신인 드래프트 기사

**수집 정보**
- 유신고 우완 투수, 2006년 8월 5일생 (지명 당시 19세)
- 구속: 포심 140km/h 후반대, 커브 125~130km/h
- 구종: 포심 + 커브 2구종 (슬라이더/체인지업 미확인 → null)
- 평가: "좋은 구위", "불리한 카운트에서도 존 공략 가능한 안정적 제구"
- 전망: 피지컬 한계로 선발 어려움, 불펜 필승조 육성 예정
- 고교 3년 성적: 21경기 77이닝 81K ERA 2.92

**입력값 & 산정 근거**

| 항목 | 값 | 근거 |
|------|-----|------|
| max_velo | 148.0 | "140km/h 후반" = 147~149 중간값 |
| avg_velo | 143.0 | 불펜형 특성, max × 0.967 추정 |
| command_grade | 60 | "불리한 카운트에서도 존 공략" = 평균 이상 |
| control_grade | 58 | 전반적 안정적 제구, 커맨드보다 소폭 낮게 |
| grade_4seam | 55 | "좋은 구위" + 피지컬 한계 감안 |
| grade_curve | 60 | 결정구로 사용, 충분히 믿을 수 있는 구종 |

```sql
INSERT INTO rookie_pitcher_scouting
  (player_id, draft_year, draft_round, draft_pick, age,
   max_velo, avg_velo, command_grade, control_grade,
   grade_4seam, grade_curve)
VALUES
  ('2927', 2026, 7, 4, 19,
   148.0, 143.0, 60, 58,
   55, 60);
```

**Why:** 시즌 스탯 없는 신인에게 스카우팅 보고서 기반 능력치를 부여하기 위해 이 방식 사용.
**How to apply:** 새 드래프티 입력 시 이 테이블에 INSERT. 첫 시즌 스탯이 쌓이면 자동으로 evaluatePitcher()로 전환됨.
