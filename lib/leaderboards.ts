import type { SupabaseClient } from "@supabase/supabase-js";

type Profile = { id: string; username: string; avatar_url: string | null; founding_member: boolean };
type Score = { user_id: string; username: string; avatar_url: string | null; score: number; founding_member?: boolean };

// A score of zero is still a score. Only add unscored profiles when they
// have submitted a complete lineup for the relevant week or season.
export function buildLeaderboard(scores: Score[], profiles: Profile[], submittedUsers: Set<string>): Score[] {
  if (!profiles.length) return scores;
  const scoresByUser = new Map(scores.map((player) => [player.user_id, player.score]));
  return profiles
    .filter((player) => scoresByUser.has(player.id) || submittedUsers.has(player.id))
    .map((player) => ({
      user_id: player.id,
      username: player.username,
      avatar_url: player.avatar_url,
      score: scoresByUser.get(player.id) ?? 0,
      founding_member: player.founding_member,
    }))
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
}

export async function loadSeasonParticipants(db: SupabaseClient, start: string, end: string): Promise<Set<string>> {
  const users = new Set<string>();
  // One record per player per week can exceed the Data API's row cap.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("weekly_lineup_status")
      .select("user_id,week_id")
      .eq("allocated_points", 100)
      .gte("week_id", start).lte("week_id", end)
      .order("week_id").order("user_id")
      .range(offset, offset + 999);
    if (error) return users; // Published score rows still remain visible.
    for (const row of data || []) users.add(row.user_id);
    if (!data || data.length < 1000) return users;
  }
}
