import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { PITCH_TYPES } from '../utils';
import { calcLeagueStdDevsFromTables, evaluatePitcher, evaluateRookie, evaluateForeignSignee } from '../utils/pitcherEval';

/**
 * 구종별 val100 리그 평균/표준편차 계산
 */
function calcLeaguePitchStats(allPitchStats) {
  if (!allPitchStats || !allPitchStats.length) return {};

  // KBO 리그 데이터만 사용 (AAA/MLB/NPB 등 외부 리그 데이터 제외 — 소표본 극단치 방지)
  const kboOnly = allPitchStats.filter(s => !s.source_league || s.source_league === 'KBO');

  // val100 데이터가 실제 존재하는 최신 연도 기준
  const years = [...new Set(kboOnly.map(s => s.year))].sort((a, b) => b - a);
  let latest = [];
  for (const yr of years) {
    const rows = kboOnly.filter(s => s.year === yr);
    const hasVal = rows.some(s => PITCH_TYPES.some(t => s[`val100_${t}`] != null));
    if (hasVal) { latest = rows; break; }
  }

  // 구종별 독립 분포 계산 (포심/변화구 특성이 달라 혼합하면 왜곡됨)
  // val100 + velo 각각의 mean/std 산출
  const winsorize = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    const lo = Math.floor(sorted.length * 0.10);
    const hi = Math.ceil(sorted.length * 0.90);
    return sorted.length >= 10 ? sorted.slice(lo, hi) : sorted;
  };
  const calcStats = (values) => {
    const trimmed = winsorize(values);
    const mean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
    const variance = trimmed.reduce((a, v) => a + (v - mean) ** 2, 0) / trimmed.length;
    return { mean, std: Math.max(Math.sqrt(variance) || 0.5, 0.35) };
  };

  const result = {};
  for (const type of PITCH_TYPES) {
    const entry = {};

    // val100 분포
    const val100Key = `val100_${type}`;
    const val100Values = latest.map(s => s[val100Key] != null ? Number(s[val100Key]) : null).filter(v => v != null);
    if (val100Values.length >= 3) {
      entry.val100 = calcStats(val100Values);
    }

    // velo 분포 (구속 z-score에 사용)
    const veloKey = `velo_${type}`;
    const veloValues = latest.map(s => s[veloKey] != null ? Number(s[veloKey]) : null).filter(v => v != null && v > 0);
    if (veloValues.length >= 3) {
      entry.velo = calcStats(veloValues);
    }

    if (entry.val100 || entry.velo) {
      // 하위 호환: result[type].mean/std 는 val100 기준 유지
      result[type] = {
        mean: entry.val100?.mean ?? 0,
        std: entry.val100?.std ?? 1,
        val100: entry.val100 || null,
        velo: entry.velo || null,
      };
    }
  }
  return result;
}

/**
 * 투수 구종 품질/다양성 점수 계산 (OVR 반영용)
 * @returns {{ quality: number, diversity: number }}
 *   quality  - 사용 비율(pct) 가중 평균 구종 점수
 *   diversity - 평균 이상 구종(score>52, pct>8%) 개수 기반 보너스 (최대 +4)
 */
function calcPitchMetrics(pitchStats, leaguePitchStats) {
  if (!pitchStats || !leaguePitchStats) return null;
  const types = ['4seam', '2seam', 'slider', 'curve', 'changeup', 'cutter', 'sinker', 'fork'];
  let weightedSum = 0;
  let totalWeight = 0;
  let qualityPitchCount = 0; // 평균 이상(score>52) + 충분한 사용(pct>8%) 구종 수

  for (const type of types) {
    const val = pitchStats[`val100_${type}`];
    const pct = pitchStats[`pct_${type}`];
    const cnt = pitchStats[`cnt_${type}`];
    if (val == null || !pct || Number(pct) <= 0) continue;

    let v = Number(val);
    // 소표본 회귀
    if (cnt != null) {
      const w = Math.min(1, Number(cnt) / 300);
      v = v * w + (leaguePitchStats[type]?.mean ?? 0) * (1 - w);
    }

    const league = leaguePitchStats[type];
    let score = league
      ? 50 + ((v - league.mean) / league.std) * 10
      : 50 + v * 10;
    // 분포 확대 (PlayerDetail과 동일)
    score = 50 + (score - 50) * 1.10;
    score = Math.max(20, Math.min(80, score));

    const usagePct = Number(pct);
    weightedSum += score * usagePct;
    totalWeight += usagePct;

    // 다양성: 평균 이상 품질 + 주요 구종으로 사용되는 경우만 카운트
    if (score > 52 && usagePct > 8) qualityPitchCount++;
  }

  if (totalWeight === 0) return null;
  const quality = weightedSum / totalWeight;
  // 다양성 보너스: 평균 이상 구종이 2개부터 카운트 (1개는 보너스 없음)
  // 2개→+1.5, 3개→+3.0, 4개→+4.0 (상한)
  const diversity = Math.min(4, Math.max(0, (qualityPitchCount - 1) * 1.5));
  return { quality, diversity };
}

/**
 * 최신 연도 레코드 추출 헬퍼
 */
function latestByYear(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.sort((a, b) => b.year - a.year)[0];
}

/**
 * pitchStats용: val100 데이터가 존재하는 최신 연도 선택
 * (시즌 중 2025 데이터에 val100=0/null이 들어올 경우 직전 연도로 fallback)
 */
function latestPitchStatsByYear(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const sorted = rows.slice().sort((a, b) => b.year - a.year);
  const hasVal100 = r => ['4seam','slider','changeup','curve','sinker','cutter','fork','2seam']
    .some(t => r[`val100_${t}`] != null && r[`val100_${t}`] !== 0);
  return sorted.find(hasVal100) || sorted[0];
}

/**
 * Supabase에서 teams + players(with attributes, pitch type stats, season stats, quality stats, running stats) 로딩
 */
export function useData() {
  const [players, setPlayers] = useState([]);
  const [teams, setTeams]   = useState([]);
  const [leaguePitchStats, setLeaguePitchStats] = useState({});
  const [pitcherEvalData, setPitcherEvalData] = useState({ stdDevs: {}, leagueAvgs: {} });
  const [scoutingHints, setScoutingHints] = useState([]);
  const [attrOpinions, setAttrOpinions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          teamsRes, playersRes, allPitchRes,
          leagueSeasonRes, leagueQualityRes, leagueRunningRes,
          attrRes, rookieScoutingRes, scoutingHintsRes, attrOpinionsRes,
        ] = await Promise.all([
          supabase.from('teams').select('*'),
          supabase
            .from('players')
            .select(`
              id, name_kor, name_eng, number, position, bats_throws,
              birthdate, team_id, height, weight, image_url, status,
              pitcher_pitch_type_stats (
                year, g, ip,
                val100_4seam, val100_2seam, val100_cutter, val100_curve,
                val100_slider, val100_changeup, val100_sinker, val100_fork,
                val100_knuckle, val100_other,
                velo_4seam, velo_2seam, velo_cutter, velo_curve,
                velo_slider, velo_changeup, velo_sinker, velo_fork,
                velo_knuckle, velo_other,
                pct_4seam, pct_2seam, pct_cutter, pct_curve,
                pct_slider, pct_changeup, pct_sinker, pct_fork,
                pct_knuckle, pct_other,
                whiff_4seam, whiff_2seam, whiff_cutter, whiff_curve,
                whiff_slider, whiff_changeup, whiff_sinker, whiff_fork,
                whiff_knuckle, whiff_other,
                cnt_4seam, cnt_2seam, cnt_cutter, cnt_curve,
                cnt_slider, cnt_changeup, cnt_sinker, cnt_fork,
                cnt_knuckle, cnt_other,
                source_league
              ),
              pitcher_season_stats (
                year, source_league, g, gs, gr, gf, cg, sho, w, l, s, hd,
                ip, er, r, tbf, h, hr, bb, hp, so, bk, wp,
                era, fip, whip, war,
                k_per9, bb_per9, k_pct, bb_pct, k_bb,
                hr_per9, babip, lob_pct, xfip,
                np, p_per_g, p_per_ip, p_per_pa
              ),
              pitcher_pitch_quality_stats (
                year, source_league, g,
                s_pct, looking_pct, swinging_pct, csw_pct,
                swing_pct, contact_pct, whiff_pct,
                first_pitch_s_pct, first_pitch_whiff_pct, putaway_pct,
                zone_in_pitch_pct, zone_in_swing_pct, zone_in_contact_pct,
                zone_out_pitch_pct, zone_out_swing_pct, zone_out_contact_pct,
                zone_mid_pitch_pct, zone_mid_swing_pct
              ),
              pitcher_baserunning_stats (
                year, g, ip,
                sb, cs, sb_pct, sba, sba_pct,
                pick_all, pick_out_all,
                bk, wp
              )
            `),
          // 리그 평균 계산용 전체 구종 데이터
          supabase
            .from('pitcher_pitch_type_stats')
            .select('year, source_league, val100_4seam, val100_2seam, val100_cutter, val100_curve, val100_slider, val100_changeup, val100_sinker, val100_fork, val100_knuckle, val100_other'),
          // 리그 테이블 (전체 연도 — 평균 + stddev 계산용)
          supabase.from('league_pitcher_season_stats').select('*').order('year', { ascending: false }),
          supabase.from('league_pitcher_quality_stats').select('*').order('year', { ascending: false }),
          supabase.from('league_pitcher_running_stats').select('*').order('year', { ascending: false }),
          // player_attributes 별도 쿼리 (PostgREST 조인 미작동 대응)
          supabase.from('player_attributes').select('*'),
          // 신인 투수 스카우팅
          supabase.from('rookie_pitcher_scouting').select('*'),
          // 용병 스카우팅 힌트 템플릿
          supabase.from('player_scouting_opinions')
            .select('category, condition_key, hint_type, opinion')
            .eq('context', 'foreign_signee'),
          // 선수 특성 구간별 의견
          supabase.from('player_attribute_scouting_opinions')
            .select('attribute, range_min, range_max, description'),
        ]);

        if (teamsRes.error) throw teamsRes.error;
        if (playersRes.error) throw playersRes.error;

        if (cancelled) return;

        // player_attributes를 player_id 기준 맵으로 변환
        const attrMap = {};
        (attrRes.data || []).forEach(a => { attrMap[a.player_id] = a; });

        // 신인 투수 스카우팅을 player_id 기준 맵으로 변환 (year 최신 레코드 우선)
        const rookieScoutMap = {};
        (rookieScoutingRes.data || [])
          .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
          .forEach(r => {
            if (!rookieScoutMap[r.player_id]) rookieScoutMap[r.player_id] = r;
          });

        // 리그 평균/표준편차 계산 (구종)
        const leagueStats = calcLeaguePitchStats(allPitchRes.data || []);

        // 리그 테이블 전체 연도 데이터
        const leagueSeasonRows  = leagueSeasonRes.data || [];
        const leagueQualityRows = leagueQualityRes.data || [];
        const leagueRunningRows = leagueRunningRes.data || [];

        // 리그 평균 데이터 (최신 연도 — 투수 평가용 mean)
        const leagueAvgs = {
          season:  leagueSeasonRows[0] || null,
          quality: leagueQualityRows[0] || null,
          running: leagueRunningRows[0] || null,
        };

        // 연도별 리그 평균 맵 (시즌별 리그 보정용)
        const leagueAvgsByYear = {};
        leagueSeasonRows.forEach(r => {
          if (!leagueAvgsByYear[r.year]) leagueAvgsByYear[r.year] = {};
          leagueAvgsByYear[r.year].season = r;
        });
        leagueQualityRows.forEach(r => {
          if (!leagueAvgsByYear[r.year]) leagueAvgsByYear[r.year] = {};
          leagueAvgsByYear[r.year].quality = r;
        });
        leagueRunningRows.forEach(r => {
          if (!leagueAvgsByYear[r.year]) leagueAvgsByYear[r.year] = {};
          leagueAvgsByYear[r.year].running = r;
        });

        const flatPlayers = (playersRes.data || []).map(p => {
          const attr = attrMap[p.id] || {};
          const pitchStats = latestPitchStatsByYear(p.pitcher_pitch_type_stats);
          const seasonStats = latestByYear(p.pitcher_season_stats);
          const qualityStats = latestByYear(p.pitcher_pitch_quality_stats);
          const runningStats = latestByYear(p.pitcher_baserunning_stats);

          // 다년도 데이터 (연도 내림차순)
          const allSeasonStats = (p.pitcher_season_stats || []).sort((a, b) => b.year - a.year);
          const allQualityStats = (p.pitcher_pitch_quality_stats || []).sort((a, b) => b.year - a.year);
          const allRunningStats = (p.pitcher_baserunning_stats || []).sort((a, b) => b.year - a.year);
          const allPitchStats = (p.pitcher_pitch_type_stats || []).sort((a, b) => b.year - a.year);

          return {
            id:           p.id,
            name_kor:     p.name_kor,
            name_eng:     p.name_eng,
            number:       p.number,
            position:     p.position,
            bats_throws:  p.bats_throws,
            birthdate:    p.birthdate,
            team_id:      p.team_id,
            height:       p.height,
            weight:       p.weight,
            image_url:    p.image_url,
            status:       p.status,
            defaultPotential: attr.potential ?? null,
            fame:             attr.fame ?? null,
            attributes:   {
              competitiveness: attr.competitiveness ?? null,
              resilience:      attr.resilience ?? null,
              focus:           attr.focus ?? null,
              adaptability:    attr.adaptability ?? null,
              work_ethic:      attr.work_ethic ?? null,
              durability:      attr.durability ?? null,
              leadership:      attr.leadership ?? null,
              competitiveness_desc: attr.competitiveness_desc ?? null,
              resilience_desc:      attr.resilience_desc ?? null,
              focus_desc:           attr.focus_desc ?? null,
              adaptability_desc:    attr.adaptability_desc ?? null,
              work_ethic_desc:      attr.work_ethic_desc ?? null,
              durability_desc:      attr.durability_desc ?? null,
              leadership_desc:      attr.leadership_desc ?? null,
              overall_comment:      attr.overall_comment ?? null,
              scouting_report:      attr.scouting_report ?? null,
              rookie_scouting:      attr.rookie_scouting ?? null,
            },
            pitchStats,
            seasonStats,
            qualityStats,
            runningStats,
            allSeasonStats,
            allQualityStats,
            allRunningStats,
            allPitchStats,
          };
        });

        // 투수 평가용 stddev 계산 (리그 테이블 연도별 데이터 기반)
        const stdDevs = calcLeagueStdDevsFromTables(
          leagueSeasonRows, leagueQualityRows, leagueRunningRows
        );

        // 각 투수에 대해 5대 능력치 산출
        const playersWithEval = flatPlayers.map(p => {
          const rookieScout = rookieScoutMap[p.id];

          // KBO 1군 기록 유무 판별: 전체 시즌 중 source_league='KBO' 기록이 하나라도 있는지
          // (퓨처스/마이너/독립리그만 있는 경우 false → evaluateRookie 경로 사용)
          const hasKBORecord = (p.allSeasonStats || []).some(
            s => (s.source_league || 'KBO') === 'KBO'
          );

          // 스카우팅 기반 신인 평가: 1군 데뷔 전 선수 (시즌 스탯 없거나 퓨처스만 있는 경우)
          if (!hasKBORecord && rookieScout) {
            const pitchGrades = {};
            let maxVelo = Number(rookieScout.max_velo) || 140;
            let avgVelo = rookieScout.avg_velo ? Number(rookieScout.avg_velo) : undefined;

            if (p.pitchStats) {
              // pitcher_pitch_type_stats 우선: val100 → 20-80 스카우팅 등급 변환
              const PITCH_KEYS = ['4seam','2seam','cutter','curve','slider','changeup','sinker','fork'];
              for (const type of PITCH_KEYS) {
                const val = p.pitchStats[`val100_${type}`];
                const pct = p.pitchStats[`pct_${type}`];
                if (val != null && pct != null && Number(pct) > 0) {
                  const lg = leagueStats[type];
                  const grade = lg
                    ? 50 + ((Number(val) - lg.mean) / lg.std) * 10
                    : 50 + Number(val) * 10;
                  pitchGrades[type] = Math.max(20, Math.min(80, Math.round(grade)));
                }
              }
              // 패스트볼 구속 우선 사용
              const fbVelo = Math.max(
                p.pitchStats.velo_4seam ? Number(p.pitchStats.velo_4seam) : 0,
                p.pitchStats.velo_2seam ? Number(p.pitchStats.velo_2seam) : 0,
                p.pitchStats.velo_sinker ? Number(p.pitchStats.velo_sinker) : 0,
              );
              if (fbVelo > 0) maxVelo = fbVelo;
            }

            const rookiePitchMetrics = calcPitchMetrics(p.pitchStats, leagueStats);
            return {
              ...p,
              pitcherEval: {
                ...evaluateRookie({
                  maxVelo,
                  avgVelo,
                  pitchGrades,
                  commandGrade: rookieScout.command_grade ?? 50,
                  controlGrade: rookieScout.control_grade ?? 50,
                  draftRound: rookieScout.draft_round ?? 10,
                  age: rookieScout.age ?? 18,
                  source_league: rookieScout.source_league ?? 'HIGH_SCHOOL',
                }),
                pitchQuality:   rookiePitchMetrics?.quality  ?? null,
                pitchDiversity: rookiePitchMetrics?.diversity ?? 0,
              },
            };
          }
          if (!p.seasonStats) return p;
          const sourceLeague = p.seasonStats.source_league || 'KBO';

          const eval5 = evaluatePitcher(
            {
              seasonStats: p.seasonStats, qualityStats: p.qualityStats,
              runningStats: p.runningStats, pitchStats: p.pitchStats,
              allSeasonStats: p.allSeasonStats, allQualityStats: p.allQualityStats,
              allRunningStats: p.allRunningStats,
            },
            leagueAvgs,
            stdDevs,
            sourceLeague,
            leagueAvgsByYear,
          );

          // 구종 품질/다양성을 OVR에 반영하기 위해 pitcherEval에 추가
          const pitchMetrics = calcPitchMetrics(p.pitchStats, leagueStats);
          const pitchQuality  = pitchMetrics?.quality  ?? null;
          const pitchDiversity = pitchMetrics?.diversity ?? 0;

          // KBO 기록 없는 외국인 → 능력치 생성 (구종은 실제 데이터 유지)
          if (!hasKBORecord && sourceLeague !== 'KBO' && eval5) {
            const signeeEval = evaluateForeignSignee(eval5, sourceLeague);
            if (signeeEval) {
              return { ...p, pitcherEval: { ...signeeEval, pitchQuality, pitchDiversity } };
            }
          }

          return { ...p, pitcherEval: eval5 ? { ...eval5, pitchQuality, pitchDiversity } : null };
        });

        setTeams(teamsRes.data || []);
        setPlayers(playersWithEval);
        setLeaguePitchStats(leagueStats);
        setPitcherEvalData({ stdDevs, leagueAvgs });
        setScoutingHints(scoutingHintsRes.data || []);
        setAttrOpinions(attrOpinionsRes.data || []);
      } catch (err) {
        if (!cancelled) setError(err.message || '데이터 로딩 실패');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const teamsMap = useMemo(() => {
    const m = {};
    teams.forEach(t => { m[t.id] = t; });
    return m;
  }, [teams]);

  return { players, teams, teamsMap, leaguePitchStats, scoutingHints, attrOpinions, loading, error };
}
