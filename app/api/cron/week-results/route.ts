import { dispatchWeekResults, pendingResultWeeks } from "../../../../lib/week-results-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const weeks = await pendingResultWeeks();
    let sent = 0;
    for (const week of weeks.slice(0, 3)) {
      sent += await dispatchWeekResults(week, 6);
    }
    return Response.json({ success: true, sent, weeksChecked: Math.min(weeks.length, 3) });
  } catch (error) {
    console.error("Results email retry failed:", error);
    return Response.json({ error: "Unable to deliver pending results emails" }, { status: 502 });
  }
}
