import { commissioner } from "../../../../lib/server";
import { weekStart } from "../../../../lib/game";
import { fetchEpisodeTitle, isShowDate } from "../../../../lib/podcast-feed";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const { db, allowed } = await commissioner();
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });
  let body: { scoringDate?: unknown; note?: unknown };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (!isShowDate(body.scoringDate) || typeof body.note !== "string" || body.note.trim().length > 2000) {
    return Response.json({ error: "Invalid show date or commissioner note" }, { status: 400 });
  }
  const now = new Date();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const week = weekStart(now);
  if (body.scoringDate < week || body.scoringDate > today) {
    return Response.json({ error: "Choose today or an earlier show date in the current broadcast week" }, { status: 400 });
  }
  const finalized = await db.from("finalized_weeks").select("scores_finalized_at").eq("week_id", week).maybeSingle();
  if (finalized.error) return Response.json({ error: "Unable to check this week's scoring" }, { status: 503 });
  if (finalized.data?.scores_finalized_at) return Response.json({ error: "Weekly scores are finalized" }, { status: 400 });

  let episodeTitle: string | null = null;
  try { episodeTitle = await fetchEpisodeTitle(body.scoringDate); }
  catch {
    // Feed availability must not stop the commissioner from publishing scores.
    console.warn("Podcast title lookup unavailable for show date", body.scoringDate);
  }
  const { error } = await db.rpc("complete_show_with_episode", {
    p_scoring_date: body.scoringDate, p_note: body.note.trim(), p_episode_title: episodeTitle,
  });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ completed: true, episodeTitle });
}
