import { commissioner } from "../../../../lib/server";
import { dispatchWeekResults } from "../../../../lib/week-results-email";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const { db, allowed } = await commissioner();
  if (!allowed) return Response.json({ error: "Forbidden" }, { status: 403 });

  let body: { week?: unknown; early?: unknown };
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
  if (typeof body.week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.week) || typeof body.early !== "boolean") {
    return Response.json({ error: "Invalid week or finalization option" }, { status: 400 });
  }

  const { data, error } = await db.rpc(
    body.early ? "finalize_week_scores_early" : "finalize_week_scores",
    { p_week: body.week },
  );
  if (error) return Response.json({ error: error.message }, { status: 400 });

  try {
    const emailed = await dispatchWeekResults(body.week);
    return Response.json({ finalized: true, players: Number(data), emailed });
  } catch {
    // The database queue remains pending; the daily retry job picks it up.
    return Response.json({ finalized: true, players: Number(data), deliveryPending: true });
  }
}
