import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { PITCH_TYPES } from '../utils';
import { calcLeagueStdDevsFromTables, evaluatePitcher, evaluateRookie } from '../utils/pitcherEval';

/**
 * 구종별 val100 리그 평균/표준편차 계산
 */
function calcLeaguePitchStats(allPitchStats) {
  if (!allPitchStats || !allPitchStats.length) return {};

  // val100 데이터가 실제 존재하는 최신 연도 기준
  const years = [...new Set(allPitchStats.map(s => s.year))].sort((a, b) => b - a);
  let latest = [];
  for (const yr of years) {
    const rows = allPitchStats.filter(s => s.year === yr);
    const hasVal = rows.some(s => PITCH_TYPES.some(t => s[`val100_${t}`] != null));
    if (hasVal) { latest = rows; break; }
  }

  // 전체 구종 val100을 하나의 풀로 모아서 공통 분포 계산
  const allValues = [];
  for (const type of PITCH_TYPES) {
    const key = `val100_${type}`;
    latest.forEach(s => {
      if (s[key] != null) allValues.push(Number(s[key]));
    });
  }
  if (allValues.length < 2) return {};

  const mean = allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const variance = allValues.reduce((a, v) => a + (v - mean) ** 2, 0) / allValues.length;
  const std = Math.sqrt(variance) || 1;
  const common = { mean, std };

  // 모든 구종에 동일한 분포 적용
  const result = {};
  for (const type of PITCH_TYPES) { result[type] = common; }
  return result;
}

/**
 * 최신 연도 레코드 추출 헬퍼
 */
function latestByYear(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows.sort((a, b) => b.year - a.year)[0];
}

/**
 * Supabase에서 teams + players(with attributes, pitch type stats, season stats, quality stats, running stats) 로딩
 */
export function useData() {
  const [players, setPlayers] = useState([]);
  const [teams, setTeams]   = useState([]);
  const [leaguePitchStats, setLeaguePitchStats] = useState({});
  const [pitcherEvalData, setPitcherEvalData] = useState({ stdDevs: {}, leagueAvgs: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          teamsRes, playersRes, allPitchRes,
          leagueSeasonRes, leagueQualityRes, leagueRunningRes,
          attrRes, rookieScoutingRes,
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
                whiff_knuckle, whiff_other
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
            .select('year, val100_4seam, val100_2seam, val100_cutter, val100_curve, val100_slider, val100_changeup, val100_sinker, val100_fork, val100_knuckle, val100_other'),
          // 리그 테이블 (전체 연도 — 평균 + stddev 계산용)
          supabase.from('league_pitcher_season_stats').select('*').order('year', { ascending: false }),
          supabase.from('league_pitcher_quality_stats').select('*').order('year', { ascending: false }),
          supabase.from('league_pitcher_running_stats').select('*').order('year', { ascending: false }),
          // player_attributes 별도 쿼리 (PostgREST 조인 미작동 대응)
          supabase.from('player_attributes').select('*'),
          // 신인 투수 스카우팅
          supabase.from('rookie_pitcher_scouting').select('*'),
        ]);

        if (teamsRes.error) throw teamsRes.error;
        if (playersRes.error) throw playersRes.error;

        if (cancelled) return;

        // player_attributes를 player_id 기준 맵으로 변환
        const attrMap = {};
        (attrRes.data || []).forEach(a => { attrMap[a.player_id] = a; });

        // 신인 투수 스카우팅을 player_id 기준 맵으로 변환
        const rookieScoutMap = {};
        (rookieScoutingRes.data || []).forEach(r => { rookieScoutMap[r.player_id] = r; });

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
          const pitchStats = latestByYear(p.pitcher_pitch_type_stats);
          const seasonStats = latestByYear(p.pitcher_season_stats);
          const qualityStats = latestByYear(p.pitcher_pitch_quality_stats);
          const runningStats = latestByYear(p.pitcher_baserunning_stats);

          // 다년도 데이터 (연도 내림차순)
          const allSeasonStats = (p.pitcher_season_stats || []).sort((a, b) => b.year - a.year);
          const allQualityStats = (p.pitcher_pitch_quality_stats || []).sort((a, b) => b.year - a.year);
          const allRunningStats = (p.pitcher_baserunning_stats || []).sort((a, b) => b.year - a.year);

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
          };
        });

        // 투수 평가용 stddev 계산 (리그 테이블 연도별 데이터 기반)
        const stdDevs = calcLeagueStdDevsFromTables(
          leagueSeasonRows, leagueQualityRows, leagueRunningRows
        );

        // 각 투수에 대해 5대 능력치 산출
        const playersWithEval = flatPlayers.map(p => {
          // 스카우팅 기반 신인 평가 (시즌 스탯 없는 투수)
          const rookieScout = rookieScoutMap[p.id];
          if (!p.seasonStats && rookieScout) {
            const pitchGrades = {};
            if (rookieScout.grade_4seam != null) pitchGrades['4seam'] = rookieScout.grade_4seam;
            if (rookieScout.grade_2seam != null) pitchGrades['2seam'] = rookieScout.grade_2seam;
            if (rookieScout.grade_cutter != null) pitchGrades.cutter = rookieScout.grade_cutter;
            if (rookieScout.grade_curve != null) pitchGrades.curve = rookieScout.grade_curve;
            if (rookieScout.grade_slider != null) pitchGrades.slider = rookieScout.grade_slider;
            if (rookieScout.grade_changeup != null) pitchGrades.changeup = rookieScout.grade_changeup;
            if (rookieScout.grade_sinker != null) pitchGrades.sinker = rookieScout.grade_sinker;
            if (rookieScout.grade_fork != null) pitchGrades.fork = rookieScout.grade_fork;
            return {
              ...p,
              pitcherEval: evaluateRookie({
                maxVelo: Number(rookieScout.max_velo) || 140,
                avgVelo: rookieScout.avg_velo ? Number(rookieScout.avg_velo) : undefined,
                pitchGrades,
                commandGrade: rookieScout.command_grade ?? 50,
                controlGrade: rookieScout.control_grade ?? 50,
                draftRound: rookieScout.draft_round ?? 10,
                age: rookieScout.age ?? 18,
              }),
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
          return { ...p, pitcherEval: eval5 };
        });

        setTeams(teamsRes.data || []);
        setPlayers(playersWithEval);
        setLeaguePitchStats(leagueStats);
        setPitcherEvalData({ stdDevs, leagueAvgs });
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

  return { players, teams, teamsMap, leaguePitchStats, loading, error };
}
