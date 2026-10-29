import type { SupabaseClient } from "@supabase/supabase-js";

export type RivalryAssignment = { week_id: string; rivalry_number: number; user_id: string };
export type RivalrySnapshot = { week_id: string; user_id: string; score: number };
export type RivalryStats = {
  userId: string;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
  biggestWin: number | null;
  highestScore: number;
};

export function calculateRivalryStats(
  assignments: RivalryAssignment[], snapshots: RivalrySnapshot[], finalizedWeeks: string[],
): RivalryStats[] {
  const final = new Set(finalizedWeeks);
  const scores = new Map(snapshots.map((row) => [`${row.week_id}:${row.user_id}`, Number(row.score)]));
  const groups = new Map<string, RivalryAssignment[]>();
  for (const row of assignments) {
    if (!final.has(row.week_id)) continue;
    const key = `${row.week_id}:${row.rivalry_number}`;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }
  const stats = new Map<string, RivalryStats>();
  // Process a player's completed appearances chronologically for win streaks.
  const ordered = [...groups.values()].sort((a, b) => a[0].week_id.localeCompare(b[0].week_id));
  for (const group of ordered) {
    // An incomplete/deleted matchup must never become an automatic win.
    if (group.length < 2 || group.length > 3 || new Set(group.map((row) => row.user_id)).size !== group.length) continue;
    const match = group.map((row) => ({ ...row, score: scores.get(`${row.week_id}:${row.user_id}`) }));
    if (match.some((row) => row.score === undefined || !Number.isFinite(row.score))) continue;
    const top = Math.max(...match.map((row) => row.score!));
    const leaders = match.filter((row) => row.score === top).length;
    for (const player of match) {
      const record = stats.get(player.user_id) || {
        userId: player.user_id, played: 0, wins: 0, losses: 0, ties: 0, winRate: 0,
        currentStreak: 0, longestStreak: 0, biggestWin: null, highestScore: 0,
      };
      record.played++;
      record.highestScore = Math.max(record.highestScore, player.score!);
      if (player.score === top && leaders === 1) {
        record.wins++;
        record.currentStreak++;
        record.longestStreak = Math.max(record.longestStreak, record.currentStreak);
        const runnerUp = Math.max(...match.filter((row) => row.user_id !== player.user_id).map((row) => row.score!));
        record.biggestWin = Math.max(record.biggestWin ?? 0, top - runnerUp);
      } else {
        if (player.score === top) record.ties++;
        else record.losses++;
        record.currentStreak = 0;
      }
      record.winRate = Math.round(record.wins / record.played * 1000) / 10;
      stats.set(player.user_id, record);
    }
  }
  return [...stats.values()];
}

// Read all history pages; the Data API caps each response at 1,000 rows.
export async function loadRivalryStats(db: SupabaseClient, seasonStart: string, seasonEnd: string) {
  const finalized = await db.from("finalized_weeks").select("week_id")
    .gte("week_id", seasonStart).lte("week_id", seasonEnd)
    .not("scores_finalized_at", "is", null).order("week_id");
  if (finalized.error) throw new Error("Unable to load completed rivalry weeks");
  const weeks = (finalized.data || []).map((row) => row.week_id as string);
  if (!weeks.length) return [];
  async function pages<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await db.from(table).select(columns).in("week_id", weeks)
        .order("week_id").order("user_id").range(offset, offset + 999);
      if (page.error) throw new Error("Unable to load rivalry history");
      const batch = (page.data || []) as unknown as T[];
      rows.push(...batch);
      if (batch.length < 1000) return rows;
    }
  }
  const [assignments, snapshots] = await Promise.all([
    pages<RivalryAssignment>("weekly_rivalries", "week_id,rivalry_number,user_id"),
    pages<RivalrySnapshot>("weekly_score_snapshots", "week_id,user_id,score"),
  ]);
  return calculateRivalryStats(assignments, snapshots, weeks);
}
