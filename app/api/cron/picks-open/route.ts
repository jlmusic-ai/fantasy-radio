import { emailDatabase, optedOutUsers, unsubscribeFooter, unsubscribeUrl } from "../../../../lib/email-unsubscribe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type AuthUser = { id: string; email?: string; email_confirmed_at?: string | null };
const SITE_URL = "https://mooberball.com";

function easternParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    weekday: "short", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: get("weekday"), hour: Number(get("hour")) };
}

function upcomingMonday(parts: ReturnType<typeof easternParts>) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + 3, 12));
  return date.toISOString().slice(0, 10);
}

function emailHtml(week: string, unsubscribe: string) {
  const date = `${week.slice(5, 7)}-${week.slice(8, 10)}-${week.slice(0, 4)}`;
  return `<!doctype html><html><body style="margin:0;background:#050505;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <div style="padding:32px 16px;background:#0b0b0b;"><div style="max-width:680px;margin:0 auto;padding:30px;border:1px solid #4d3d00;border-radius:18px;background:#151515;">
      <img src="${SITE_URL}/mooberball-logo.png" width="180" alt="Mooberball" style="display:block;width:180px;max-width:70%;height:auto;margin:0 0 26px;">
      <p style="margin:0 0 8px;color:#ffca05;font-size:13px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;">Welcome to Mooberball</p>
      <h1 style="margin:0 0 18px;color:#ffca05;font-size:36px;line-height:1.1;text-transform:uppercase;">Howdy Moober!</h1>
      <p style="margin:0 0 24px;color:#e2e2e2;font-size:19px;line-height:1.6;">Picks are open for the week beginning ${date}. Build your lineup now!</p>
      <a href="${SITE_URL}/" style="display:inline-block;padding:14px 20px;border-radius:9px;background:#ffca05;color:#151515;font-size:16px;font-weight:800;text-decoration:none;">Make your picks</a>
      <p style="margin:24px 0 0;color:#999999;font-size:12px;line-height:1.5;">Picks lock Monday at 6:00 a.m. Eastern Time.</p>
      ${unsubscribeFooter(unsubscribe)}
    </div></div></body></html>`;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!secret || !resendKey || !from) return Response.json({ error: "Email service is not configured" }, { status: 503 });

  const parts = easternParts(new Date());
  if (parts.weekday !== "Fri" || parts.hour < 19 || parts.hour > 20)
    return Response.json({ skipped: true, reason: "Outside Friday evening reminder window" });
  const week = upcomingMonday(parts);
  const [optedOut, completeResponse] = await Promise.all([
    optedOutUsers(secret),
    emailDatabase(`/rest/v1/weekly_lineup_status?week_id=eq.${week}&allocated_points=eq.100&select=user_id`, secret),
  ]);
  if (!completeResponse.ok) return Response.json({ error: "Unable to check lineup status" }, { status: 502 });
  const completeRows = (await completeResponse.json()) as { user_id: string }[];
  const completeUsers = new Set(completeRows.map((row) => row.user_id));
  let sent = 0;
  let eligible = 0;
  for (let page = 1; page <= 100; page++) {
    const usersResponse = await emailDatabase(`/auth/v1/admin/users?page=${page}&per_page=100`, secret);
    if (!usersResponse.ok) return Response.json({ error: "Unable to load players", sent }, { status: 502 });
    const payload = (await usersResponse.json()) as { users?: AuthUser[] };
    const users = payload.users || [];
    const recipients = users.filter((user): user is AuthUser & { email: string } =>
      Boolean(user.email && user.email_confirmed_at) && !optedOut.has(user.id) && !completeUsers.has(user.id));
    eligible += recipients.length;
    if (recipients.length) {
      const claim = await emailDatabase("/rest/v1/pick_open_email_sends?on_conflict=week_id,user_id", secret, {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(recipients.map((user) => ({ week_id: week, user_id: user.id }))),
      });
      if (!claim.ok) return Response.json({ error: "Unable to reserve opening emails", sent }, { status: 502 });
      const claimed = (await claim.json()) as { user_id: string }[];
      const ids = new Set(claimed.map((row) => row.user_id));
      const batch = recipients.filter((user) => ids.has(user.id));
      if (batch.length) {
        const emailRequest = {
          method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json",
            "Idempotency-Key": `mooberball-picks-open-${week}-${batch[0].id}-${batch.at(-1)!.id}` },
          body: JSON.stringify(batch.map((user) => {
            const unsubscribe = unsubscribeUrl(user.id);
            return { from, to: [user.email], subject: "Mooberball: Picks Are Open for Next Week!",
              html: emailHtml(week, unsubscribe),
              text: `Howdy Moober! Picks are open for the week beginning ${week.slice(5,7)}-${week.slice(8,10)}-${week.slice(0,4)}. Make your picks: ${SITE_URL}/\n\nPicks lock Monday at 6:00 a.m. Eastern Time.\n\nUnsubscribe from all Mooberball emails: ${unsubscribe}`,
              headers: { "List-Unsubscribe": `<${unsubscribe}>` },
            };
          })),
        };
        let response = await fetch("https://api.resend.com/emails/batch", emailRequest);
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          response = await fetch("https://api.resend.com/emails/batch", emailRequest);
        }
        if (!response.ok) {
          await emailDatabase(`/rest/v1/pick_open_email_sends?week_id=eq.${week}&user_id=in.(${batch.map((user) => user.id).join(",")})&status=eq.pending`, secret, { method: "DELETE" });
          return Response.json({ error: "Email provider rejected batch", sent, status: response.status }, { status: 502 });
        }
        const receipt = (await response.json()) as { data?: { id: string }[] };
        if (receipt.data?.length !== batch.length) return Response.json({ error: "Incomplete email receipt", sent }, { status: 502 });
        const update = await emailDatabase(`/rest/v1/pick_open_email_sends?week_id=eq.${week}&user_id=in.(${batch.map((user) => user.id).join(",")})`, secret, {
          method: "PATCH", body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }),
        });
        if (!update.ok) return Response.json({ error: "Unable to record delivery", sent }, { status: 502 });
        sent += batch.length;
      }
    }
    if (users.length < 100) return Response.json({ success: true, week, eligible, sent });
  }
  return Response.json({ error: "Player pagination limit reached", sent }, { status: 502 });
}
