# KBO Simulator - Project Memory

## 프로젝트 구조

### 파일 맵
```
src/
├── utils.js                    — 공통 유틸 (등급, OVR, 색상, 구종맵, 나이계산)
├── utils/
│   ├── pitcherEval.js          — 투수 5대 능력치 평가 + 외국인 용병 평가
│   ├── playerGrowth.js         — 성장 곡선 + 적응 시스템
│   ├── careerSimulator.js      — 시즌 성적 시뮬레이션
│   └── foreignPlayerGen.js     — 외국인 투수 생성 & 스카우팅 시스템 (공유 유틸 export)
├── components/
│   ├── PlayerTable.js          — 로스터 테이블 (정렬, 능력치 바)
│   ├── PlayerDetail.js         — 선수 상세 (5능력치, 구종등급, 특성, 커리어, 용병 스카우팅)
│   ├── FilterBar.js            — 타입/포지션/검색 필터
│   ├── TeamSelector.js         — 팀 필터
│   ├── ScoutingDemo.js         — 외국인 스카우팅 데모
│   ├── GrowthSimDemo.js        — 성장 시뮬레이터 (20년 팬차트)
│   └── ConfidenceDemo.js       — 불확실성 시각화 (prior vs observed)
├── hooks/
│   └── useData.js              — Supabase 데이터 로딩 + 투수 평가 실행
├── lib/
│   ├── supabase.js             — Supabase 클라이언트
│   └── genAbilities.js         — 레거시 능력치 생성 (타자용 폴백)
└── App.js                      — 루트 (필터, 데모 토글)
```

### 기술 스택
- React 18.2.0, CSS Modules
- Supabase (PostgreSQL + PostgREST)
- 배포: GitHub Pages (production 브랜치 push → 자동 배포)

### Supabase 테이블
- `teams`, `players`, `player_attributes`
- `pitcher_season_stats` (year, source_league, era, fip, whip, k_per9, bb_per9, k_bb, ip, g, gs, ...)
- `pitcher_pitch_quality_stats` (year, source_league, whiff_pct, csw_pct, zone_*, contact_pct, ...)
- `pitcher_baserunning_stats` (year, sb, cs, sb_pct, sba, pick_*, bk, wp)
- `pitcher_pitch_type_stats` (year, val100_*, velo_*, pct_*, whiff_*, cnt_*)
- `league_pitcher_season_stats`, `league_pitcher_quality_stats`, `league_pitcher_running_stats` (연도별)
- `rookie_pitcher_scouting` (max_velo, avg_velo, grade_*, command_grade, control_grade, draft_round, age)

---

## 투수 평가 시스템 (pitcherEval.js)

### 파일 위치
- `src/utils/pitcherEval.js` — 핵심 로직 (evaluatePitcher, evaluateRookie, evaluateForeignSignee)
- `src/hooks/useData.js` — 데이터 로딩 + 평가 실행 (line 233~)
- `src/components/PlayerDetail.js` — 상세 화면 (normalizeVal100 등)

### 5대 능력치 + zMultiplier
| 카테고리 | zMultiplier | 주요 지표 |
|----------|-------------|-----------|
| Stuff (구위) | 10 (기본) | whiff%, contact%, zone_contact%, CSW%, putaway%, K/9 |
| Command (제구) | 14 | zone_mid_pitch%, looking%, K/BB, P/IP |
| Control (컨트롤) | 10 | BB/9, BB%, strike%, WHIP, WP/IP |
| Holding (주자억제) | **6** | SB%, SBA/IP, BK/IP, pickoff/IP (소표본→50 중심 축소) |
| Stamina (체력) | 선발10/불펜12 | IP/GS, P/GS (선발) / IP/G, P/G (불펜) |

### 주요 상수
- YEAR_WEIGHTS = [12, 5, 3, 2, 1] (최신 시즌 가중)
- z-score cap = ±3.7
- IP 기반 회귀: REGRESSION_IP 기반 regressionFactor

### 리그 수준 변환 (LEAGUE_Z_OFFSETS)
| 리그 | stuff | command | control | holding | stamina |
|------|-------|---------|---------|---------|---------|
| KBO | 0 | 0 | 0 | 0 | 0 |
| MLB | +1.5 | +1.0 | +0.8 | +0.5 | +0.5 |
| AAA | +1.3 | +1.3 | +1.3 | +0.5 | +0.5 |
| NPB | +0.3 | +0.25 | +0.2 | +0.15 | +0.15 |
| NPB_FARM | -0.3 | -0.3 | -0.2 | -0.15 | -0.15 |

### 리그 스코어 플로어 (LEAGUE_SCORE_FLOOR)
- KBO: 20, MLB: 50, AAA: 48, NPB: 48, NPB_FARM: 20

### 평가 흐름 (useData.js)
```
1. evaluatePitcher(sourceLeague) — 기본 5대 능력치 추정
2. KBO 기록 없는 외국인 → evaluateForeignSignee(baseEval, sourceLeague)
   - 외국 스탯 앵커 + LEAGUE_BASE 랜덤으로 능력치 "생성"
   - 구종 종류는 실제 데이터 유지, 레이더 등급은 실제+생성 mix
3. 시즌 스탯 없음 + rookie_scouting → evaluateRookie(scouting)
4. 시즌 스탯 없음 + 스카우팅 없음 → 평가 없음
```

### 신인 평가 (evaluateRookie)
- ROOKIE_BASE: 1R=36, 2-3R=32, 4-5R=29, 6-10R=26
- ROOKIE_SCALE = 0.3 (스카우팅 편차의 30%만 반영)
- stuff = veloToStuff(구속) × 0.6 + avgBreaking × 0.4 → toKBO()
- 상세 문서: [드래프티 신인 투수 평가 시스템](memory/rookie_eval_system.md)

---

## 외국인 용병 시스템

### evaluateForeignSignee (pitcherEval.js)
- **용도**: KBO 기록 없는 외국인 투수를 가상 선수로 취급하여 능력치 생성
- **입력**: evaluatePitcher의 결과(estimate) + sourceLeague
- **생성 방식**: 외국 스탯 앵커(STAT_ANCHOR_WEIGHT) × anchorW + LEAGUE_BASE 랜덤 × (1-anchorW)
  - MLB: 40% 앵커, AAA: 25%, NPB: 30%, NPB_FARM: 20%
- **holding**: 외국 리그 주자억제 샘플 극소 → 50 중심 좁은 분포 (46~54)
- **stamina**: 선발 52~70, 불펜 44~62 랜덤
- **반환**: pitcherEval 호환 + `isForeignSignee: true` + `scouting` 메타데이터
  - scouting: { estimate, projected(1년차), adaptationType, kboFit, hints }

### 구종 처리 (PlayerDetail.js normalizeVal100)
- **구종 종류**: 실제 외국 리그 데이터 그대로 유지
- **레이더 등급**: `isForeignSignee`일 때 실제 외국 데이터 50% + 생성 stuff 기반 50% 블렌딩
  - 패스트볼 계열: ±3 편차, 변화구 계열: ±5 편차
- **velo z-score**: 리그 실측 데이터(calcLeaguePitchStats의 velo 통계) 우선 사용
  - 없으면 VELO_BENCHMARKS_FALLBACK(하드코딩) 폴백

### foreignPlayerGen.js (공유 유틸)
- export: ADAPTATION_TYPES, LEAGUE_BASE, pickWeighted, clamp, pick, generateHints
- 가상 외국인 투수 생성 (ScoutingDemo에서 사용)
- visible(스카우팅 정보) / hidden(실제 능력치) 분리 구조

### 적응 유형 (ADAPTATION_TYPES)
| 유형 | 1년차 | 2년차 | 3년차 | 확률 |
|------|-------|-------|-------|------|
| 조기 적응형 | 1.00 | 1.00 | 1.00 | 25% |
| 일반 적응형 | 0.80 | 1.00 | 1.00 | 45% |
| 느린 적응형 | 0.60 | 0.85 | 1.00 | 20% |
| 부적응형 | 0.55 | 0.65 | 0.70 | 10% |

### KBO 적합도
- `kboFit = (stuff-40)×0.6 + (control-40)×0.4 + 적응보정 + 랜덤`
- 등급: S(80+) A(65+) B(50+) C(35+) D(20+) E(<20)

---

## 구종 평가 시스템 (calcLeaguePitchStats + normalizeVal100)

### 리그 구종 통계 (useData.js calcLeaguePitchStats)
- KBO 리그만 사용, 최신 연도 기준
- 구종별 **val100** mean/std + **velo** mean/std 각각 산출
- winsorize(10%) 적용
- 하위 호환: `result[type].mean/std`는 val100 기준 유지

### normalizeVal100 (PlayerDetail.js)
- val100 직접 사용: `score = 50 + val100 * 8`
- velo 블렌딩: VELO_BLEND_RATIO (4seam 0.35, slider 0.10, changeup 0.00 등)
- velo z-score: **리그 실측 velo 통계 우선** → 없으면 VELO_BENCHMARKS_FALLBACK
- 소표본 회귀: cnt < 300이면 val100을 0(리그 평균) 방향으로 수축
- 분포 확대: 50 기준 ×1.10 stretch
- 신인 페널티: `score = 38 + (score-50) * 0.5`

---

## 성장 시스템 (playerGrowth.js)

### 성장 유형 (GROWTH_TYPES)
| 유형 | 확률 | 피크 보정 | ceiling | decline | 특징 |
|------|------|-----------|---------|---------|------|
| FLASH | 2% | -1 | 1.09 | 0.065 | 반짝스타 |
| BURNOUT | 5% | -2 | 1.06 | 0.042 | 조기 연소 |
| EARLY_PEAK | 13% | -1 | 1.08 | 0.030 | 빠른 피크 |
| STANDARD | 46% | 0 | 1.10 | 0.022 | 표준 (가장 흔함) |
| STEADY | 18% | +1 | 1.08 | 0.016 | 꾸준함 |
| LATE_BLOOM | 11% | +3 | 1.18 | 0.018 | 대기만성 |
| IRON | 4% | +2 | 1.07 | 0.070 | 철인 (peakWindow=14) |
| LEGEND | 1% | +4 | 1.22 | 0.012 | 레전드 |

### 적응 시스템 (리그 이동)
| 유형 | IP threshold | speed | ceiling | floor | 확률 |
|------|-------------|-------|---------|-------|------|
| EARLY | 150 | 8.0 | 1.00 | 0.90 | 25% |
| NORMAL | 240 | 5.0 | 1.00 | 0.72 | 45% |
| SLOW | 360 | 3.5 | 1.00 | 0.55 | 20% |
| BUST | 500 | 2.0 | 0.72 | 0.48 | 10% |

---

## OVR 계산 (utils.js)

### 투수 OVR
```
base = (stuff + command + control) / 3 + holding×0.3 + stamina×0.3
qualityBonus = max(0, (pitchQuality-50) × 0.08)
diversityBonus = pitchDiversity × 0.25
OVR = min(80, base + qualityBonus + diversityBonus)
```

### 등급 체계
- S: 73+ | A: 66+ | B: 58+ | C: 50+ | D: 42+ | E: <42

### 능력치 바 색상
- 70+: #00C853 (초록) | 60-69: #26A69A (틸) | 50-59: #3A8FCA (블루) | 40-49: #C49A50 (앰버) | ~39: #A0A0A0 (회색)

---

## UI/UX

### 선수 상세 화면 (PlayerDetail.js)
- 5대 능력치 바 + 구종 레이더 차트
- **용병 스카우팅 섹션**: `isForeignSignee`일 때 표시
  - KBO 적합도(S~E), 1년차 적응계수, estimate vs projected 비교 바, 힌트
  - CSS: `.signeeHeader`, `.signeeGrid`, `.signeeCompare`, `.signeeHints` 등
- 스카우팅 리포트: 인용 부호 스타일, 팀 컬러 적용
- 이미지: Supabase Storage, player.image_url (webp)

### 데모 화면들
- **ScoutingDemo**: 외국인 투수 스카우팅 → 계약 → 능력치 공개 → 1년차 시뮬
- **GrowthSimDemo**: 20년 커리어 팬차트 (잠재력/성장유형별 분포)
- **ConfidenceDemo**: 베이지안 불확실성 (IP 누적 → 신뢰구간 수렴)

---

## TODO / 계획

### 미구현
- 시즌 중 외국인 계약 해지 / 새 용병 영입 → 가상 선수 생성 필요
- "새 시즌 시작" 버튼으로 외국인 용병 능력치 재생성 (페이지 리로드 대신)
- 타자 평가 시스템 (현재 genAbilities.js 레거시)
