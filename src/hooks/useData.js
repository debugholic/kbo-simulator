import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { PITCH_TYPES } from '../utils';
import { calcLeagueStdDevsFromTables, evaluatePitcher } from '../utils/pitcherEval';

/**
 * 구종별 val100 리그 평균/표준편차 계산
 */
function calcLeaguePitchStats(allPitchStats) {
  if (!allPitchStats || !allPitchStats.length) return {};

  // 최신 연도 기준
  const maxYear = Math.max(...allPitchStats.map(s => s.year));
  const latest = allPitchStats.filter(s => s.year === maxYear);

  const result = {};
  for (const type of PITCH_TYPES) {
    const key = `val100_${type}`;
    const values = latest.map(s => s[key]).filter(v => v != null).map(Number);
    if (values.length < 2) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);

    result[type] = { mean, std: std || 1 };
  }
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
        ] = await Promise.all([
          supabase.from('teams').select('*'),
          supabase
            .from('players')
            .select(`
              id, name_kor, name_eng, number, position, bats_throws,
              birthdate, team_id, height, weight, image_url, status,
              player_attributes (
                competitiveness, resilience, focus, adaptability,
                work_ethic, durability, leadership,
                competitiveness_desc, resilience_desc, focus_desc,
                adaptability_desc, work_ethic_desc, durability_desc,
                leadership_desc, overall_comment, scouting_report
              ),
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
                pct_knuckle, pct_other
              ),
              pitcher_season_stats (
                year, g, gs, gr, gf, cg, sho, w, l, s, hd,
                ip, er, r, tbf, h, hr, bb, hp, so, bk, wp,
                era, fip, whip, war,
                k_per9, bb_per9, k_pct, bb_pct, k_bb,
                hr_per9, babip, lob_pct, xfip,
                np, p_per_g, p_per_ip, p_per_pa
              ),
              pitcher_pitch_quality_stats (
                year, g,
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
        ]);

        if (teamsRes.error) throw teamsRes.error;
        if (playersRes.error) throw playersRes.error;

        if (cancelled) return;

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

        const flatPlayers = (playersRes.data || []).map(p => {
          const attr = p.player_attributes || {};
          const pitchStats = latestByYear(p.pitcher_pitch_type_stats);
          const seasonStats = latestByYear(p.pitcher_season_stats);
          const qualityStats = latestByYear(p.pitcher_pitch_quality_stats);
          const runningStats = latestByYear(p.pitcher_baserunning_stats);

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
            },
            pitchStats,
            seasonStats,
            qualityStats,
            runningStats,
          };
        });

        // 투수 평가용 stddev 계산 (리그 테이블 연도별 데이터 기반)
        const stdDevs = calcLeagueStdDevsFromTables(
          leagueSeasonRows, leagueQualityRows, leagueRunningRows
        );

        // 각 투수에 대해 5대 능력치 산출
        const playersWithEval = flatPlayers.map(p => {
          if (!p.seasonStats) return p;
          const eval5 = evaluatePitcher(
            { seasonStats: p.seasonStats, qualityStats: p.qualityStats, runningStats: p.runningStats },
            leagueAvgs,
            stdDevs,
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
