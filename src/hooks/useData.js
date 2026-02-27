import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Supabase에서 teams + players(with abilities) 로딩
 * players 구조: { id, name_kor, name_eng, number, position, bats_throws, age, team_id,
 *                  control, stuff, stamina, command,
 *                  contact, discipline, power, speed,
 *                  is_manual, ai_summary, source }
 */
export function useData() {
  const [players, setPlayers] = useState([]);
  const [teams, setTeams]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // teams와 players+abilities를 병렬 조회
        const [teamsRes, playersRes] = await Promise.all([
          supabase.from('teams').select('*'),
          supabase
            .from('players')
            .select(`
              id, name_kor, name_eng, number, position, bats_throws, age, team_id,
              player_abilities (
                control, stuff, stamina, command,
                contact, discipline, power, speed,
                is_manual, ai_summary, source
              )
            `),
        ]);

        if (teamsRes.error) throw teamsRes.error;
        if (playersRes.error) throw playersRes.error;

        if (cancelled) return;

        // player_abilities를 flat하게 병합
        const flatPlayers = (playersRes.data || []).map(p => {
          const ab = p.player_abilities || {};
          return {
            id:           p.id,
            name_kor:     p.name_kor,
            name_eng:     p.name_eng,
            number:       p.number,
            position:     p.position,
            bats_throws:  p.bats_throws,
            age:          p.age,
            team_id:      p.team_id,
            // 투수 능력치
            control:      ab.control    ?? null,
            stuff:        ab.stuff      ?? null,
            stamina:      ab.stamina    ?? null,
            command:      ab.command    ?? null,
            // 타자 능력치
            contact:      ab.contact    ?? null,
            discipline:   ab.discipline ?? null,
            power:        ab.power      ?? null,
            speed:        ab.speed      ?? null,
            // 메타
            is_manual:    ab.is_manual  ?? false,
            ai_summary:   ab.ai_summary ?? null,
            source:       ab.source     ?? 'statistical',
          };
        });

        setTeams(teamsRes.data || []);
        setPlayers(flatPlayers);
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

  return { players, teams, teamsMap, loading, error };
}
