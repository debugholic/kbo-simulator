# KBO Roster Viewer

KBO 10개 구단 618명 선수 능력치 뷰어 (데이터 정적 내장)

## 로컬 실행

```bash
npm install
npm start
```

## Vercel 배포

### 방법 1 — Vercel CLI (권장)
```bash
npm install -g vercel
vercel
```

### 방법 2 — GitHub 연동
1. 이 폴더를 GitHub 리포지토리로 push
2. [vercel.com](https://vercel.com) 접속 → "New Project"
3. 리포지토리 선택 → "Deploy"
4. Framework: **Create React App** 자동 감지됨

### 방법 3 — 직접 빌드 후 배포
```bash
npm run build
# build/ 폴더를 Vercel, Netlify, GitHub Pages 등 어디든 정적 호스팅
```

## 기능
- 10개 구단 필터
- 포지션 그룹 필터 (투수/포수/내야/외야)
- 선수명 검색
- 능력치 정렬 (OVR, 나이, 개별 스탯)
- 선수 상세 모달 (능력치 바 차트, AI 평가)
