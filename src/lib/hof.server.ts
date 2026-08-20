import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

export type Championship = {
  id: string;
  year: number;
  fantasy_team_name: string;
  manager_name: string;
  wins_losses: string | null;
};

export type PlayerWeekRecord = {
  id: string;
  year: number;
  player_name: string;
  week: string | null;
  points: number | null;
  fantasy_team_name: string | null;
  manager_name: string | null;
};

export type TeamWeekRecord = {
  id: string;
  year: number;
  week: string | null;
  points: number | null;
  fantasy_team_name: string | null;
  manager_name: string | null;
};

export type TeamSeasonRecord = {
  id: string;
  year: number;
  points: number | null;
  fantasy_team_name: string | null;
  manager_name: string | null;
};

export type HofYear = {
  year: number;
  championship: Championship | null;
  playerWeek: PlayerWeekRecord | null;
  teamWeek: TeamWeekRecord | null;
  teamSeason: TeamSeasonRecord | null;
};

function publicClient() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"] || process.env["SUPABASE_ANON_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY / SUPABASE_ANON_KEY."
    );
  }
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export async function loadHallOfFame(): Promise<HofYear[]> {
  const supabase = publicClient();

  const [champs, playerWeeks, teamWeeks, teamSeasons] = await Promise.all([
    supabase
      .from("hof_championships")
      .select("id, year, fantasy_team_name, manager_name, wins_losses"),
    supabase
      .from("hof_player_week_records")
      .select("id, year, player_name, week, points, fantasy_team_name, manager_name"),
    supabase
      .from("hof_team_week_records")
      .select("id, year, week, points, fantasy_team_name, manager_name"),
    supabase
      .from("hof_team_season_records")
      .select("id, year, points, fantasy_team_name, manager_name"),
  ]);

  const firstError =
    champs.error ?? playerWeeks.error ?? teamWeeks.error ?? teamSeasons.error;
  if (firstError) throw new Error(firstError.message);

  const byYear = new Map<number, HofYear>();
  const slot = (year: number) => {
    let entry = byYear.get(year);
    if (!entry) {
      entry = { year, championship: null, playerWeek: null, teamWeek: null, teamSeason: null };
      byYear.set(year, entry);
    }
    return entry;
  };

  for (const row of champs.data ?? []) slot(row.year).championship = row as Championship;
  for (const row of playerWeeks.data ?? []) slot(row.year).playerWeek = row as PlayerWeekRecord;
  for (const row of teamWeeks.data ?? []) slot(row.year).teamWeek = row as TeamWeekRecord;
  for (const row of teamSeasons.data ?? []) slot(row.year).teamSeason = row as TeamSeasonRecord;

  return [...byYear.values()].sort((a, b) => b.year - a.year);
}
