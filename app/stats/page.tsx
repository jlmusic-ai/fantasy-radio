import { redirect } from "next/navigation";
import { FIRST_SEASON_END, FIRST_SEASON_START } from "../../lib/game";
import { serverClient } from "../../lib/server";
import StatsDashboard, { type StatsWeek, type TopicTrend } from "./stats-dashboard";

export const metadata = {
  title: "Stats | Mooberball",
  description: "Official season scoring trends and completed week archives.",
};

type FinalizedWeek = { week_id: string; scores_finalized_at: string };
type ScoringLine = {
  week_id: string;
  scoring_date: string;
  category_id: string;
  topic_name: string;
  scoring_type: string;
  quantity: number;
};
type ScoreRow = { week_id: string; user_id: string; score: number };
type ProfileRow = { id: string };

function ErrorPanel() {
  return <div className="panel" role="alert">
    <h1>Stats are unavailable</h1>
    <p>We couldn't load the scoring archive right now. Please try again shortly.</p>
  </div>;
}

export default async function StatsPage() {
  const db = await serverClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const [finalizedResult, profilesResult] = await Promise.all([
    db.from("finalized_weeks").select("week_id,scores_finalized_at")
      .gte("week_id", FIRST_SEASON_START).lte("week_id", FIRST_SEASON_END)
      .not("scores_finalized_at", "is", null).order("week_id"),
    db.from("profiles").select("id").eq("hide_from_leaderboards", false).limit(1000),
  ]);
  if (finalizedResult.error || profilesResult.error) return <ErrorPanel />;

  const finalized = (finalizedResult.data || []) as FinalizedWeek[];
  const weekIds = finalized.map((row) => row.week_id);
  const visible = new Set(((profilesResult.data || []) as ProfileRow[]).map((row) => row.id));
  const lines: ScoringLine[] = [];
  const scores: ScoreRow[] = [];
  if (weekIds.length) {
    // Page through results so a season with 500 players does not hit the API's row limit.
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const result = await db.from("weekly_score_snapshots")
        .select("week_id,user_id,score").in("week_id", weekIds)
        .order("week_id").order("user_id").range(offset, offset + pageSize - 1);
      if (result.error) return <ErrorPanel />;
      const batch = (result.data || []) as ScoreRow[];
      scores.push(...batch.filter((row) => visible.has(row.user_id)));
      if (batch.length < pageSize) break;
    }
    for (let offset = 0; ; offset += pageSize) {
      const result = await db.from("daily_scoring_lines")
        .select("week_id,scoring_date,category_id,topic_name,scoring_type,quantity")
        .in("week_id", weekIds).order("week_id").order("scoring_date")
        .order("category_id").range(offset, offset + pageSize - 1);
      if (result.error) return <ErrorPanel />;
      const batch = (result.data || []) as ScoringLine[];
      lines.push(...batch);
      if (batch.length < pageSize) break;
    }
  }

  const weeks: StatsWeek[] = finalized.map(({ week_id }) => {
    const weekScores = scores.filter((row) => row.week_id === week_id);
    const weekLines = lines.filter((row) => row.week_id === week_id);
    const totalPoints = weekScores.reduce((sum, row) => sum + Number(row.score), 0);
    const occurrences = weekLines.reduce((sum, row) => sum + row.quantity, 0);
    const topics = new Map<string, { name: string; count: number; birthday: boolean }>();
    for (const line of weekLines) {
      const current = topics.get(line.category_id);
      topics.set(line.category_id, {
        name: line.topic_name,
        count: (current?.count || 0) + line.quantity,
        birthday: line.scoring_type === "closest_guess",
      });
    }
    return {
      week: week_id,
      players: weekScores.length,
      totalPoints,
      averageScore: weekScores.length ? Math.round(totalPoints / weekScores.length * 10) / 10 : 0,
      topScore: weekScores.length ? Math.max(...weekScores.map((row) => Number(row.score))) : 0,
      occurrences,
      scoredDays: new Set(weekLines.map((line) => line.scoring_date)).size,
      topics: [...topics.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  });

  const trendMap = new Map<string, TopicTrend>();
  for (const line of lines) {
    const current = trendMap.get(line.category_id) || {
      id: line.category_id, name: line.topic_name,
      birthday: line.scoring_type === "closest_guess", total: 0, weeks: {} as Record<string, number>,
    };
    // The name comes from the week it was scored, not today's editable lineup.
    current.name = line.topic_name;
    current.total += line.quantity;
    current.weeks[line.week_id] = (current.weeks[line.week_id] || 0) + line.quantity;
    trendMap.set(line.category_id, current);
  }

  return <StatsDashboard weeks={weeks} topics={[...trendMap.values()]}
    uniquePlayers={new Set(scores.map((row) => row.user_id)).size} />;
}
