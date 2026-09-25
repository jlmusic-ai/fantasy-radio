export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { optedOutUsers, unsubscribeFooter, unsubscribeUrl } from "../../../../lib/email-unsubscribe";

type AuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
};

type ReminderRecipient = {
  id: string;
  email: string;
};

const SITE_URL = "https://mooberball.com";
const FIRST_SEASON_START = "2026-10-05";
const FIRST_SEASON_END = "2026-11-20";

function easternDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
    hour: Number(value("hour")),
  };
}

function nextMonday(parts: ReturnType<typeof easternDateParts>) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function seasonWeekNumber(weekId: string) {
  const start = Date.parse(`${FIRST_SEASON_START}T12:00:00Z`);
  const week = Date.parse(`${weekId}T12:00:00Z`);
  return Math.floor((week - start) / 604_800_000) + 1;
}

function reminderHtml(unsubscribe: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#050505;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <div style="padding:32px 16px;background:radial-gradient(circle at 50% -20%,#3b2d00 0,#111111 38%,#050505 75%);">
      <div style="max-width:680px;margin:0 auto;padding:30px;border:1px solid #4d3d00;border-radius:18px;background:linear-gradient(145deg,#151515,#0d0d0d);">
        <img src="${SITE_URL}/mooberball-logo.png" width="180" alt="Mooberball" style="display:block;width:180px;max-width:70%;height:auto;margin:0 0 26px;">
        <p style="margin:0 0 8px;color:#ffca05;font-size:13px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;">Welcome to Mooberball</p>
        <h1 style="margin:0 0 18px;color:#ffca05;font-size:36px;line-height:1.1;text-transform:uppercase;">Howdy Moober!</h1>
        <p style="margin:0 0 24px;color:#e2e2e2;font-size:19px;line-height:1.6;">Don’t forget to lock in your picks for this week.</p>
        <a href="${SITE_URL}/" style="display:inline-block;padding:14px 20px;border-radius:9px;background:#ffca05;color:#151515;font-size:16px;font-weight:800;text-decoration:none;">Lock in your picks</a>
        <p style="margin:24px 0 0;color:#999999;font-size:12px;line-height:1.5;">Picks lock Monday at 6:00 a.m. Eastern Time.</p>
        ${unsubscribeFooter(unsubscribe)}
      </div>
    </div>
  </body>
</html>`;
}

async function supabaseRequest(
  path: string,
  secret: string,
  init: RequestInit = {},
) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl) throw new Error("Missing Supabase URL");
  const headers = new Headers(init.headers);
  headers.set("apikey", secret);
  headers.set("Authorization", `Bearer ${secret}`);
  headers.set("Content-Type", "application/json");
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function releaseClaims(
  weekId: string,
  recipients: ReminderRecipient[],
  secret: string,
) {
  if (!recipients.length) return;
  const ids = recipients.map((recipient) => recipient.id).join(",");
  await supabaseRequest(
    `/rest/v1/pick_reminder_sends?week_id=eq.${weekId}&user_id=in.(${ids})&status=eq.pending`,
    secret,
    { method: "DELETE" },
  );
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  const supabaseSecret =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;

  if (!resendKey || !supabaseSecret || !from) {
    return Response.json(
      { error: "Reminder email service is not configured" },
      { status: 503 },
    );
  }

  const parts = easternDateParts(new Date());
  if (parts.weekday !== "Sun" || parts.hour !== 13) {
    return Response.json({ skipped: true, reason: "Outside Sunday 1 p.m. Eastern" });
  }

  const weekId = nextMonday(parts);
  if (weekId < FIRST_SEASON_START || weekId > FIRST_SEASON_END) {
    return Response.json({
      skipped: true,
      reason: "Upcoming week is outside the official season",
      week: weekId,
    });
  }
  const weekNumber = seasonWeekNumber(weekId);
  const [usersResponse, completeResponse] = await Promise.all([
    supabaseRequest("/auth/v1/admin/users?page=1&per_page=1000", supabaseSecret),
    supabaseRequest(
      `/rest/v1/weekly_lineup_status?week_id=eq.${weekId}&allocated_points=eq.100&select=user_id`,
      supabaseSecret,
    ),
  ]);

  if (!usersResponse.ok || !completeResponse.ok) {
    return Response.json(
      { error: "Unable to load reminder recipients" },
      { status: 502 },
    );
  }

  const usersPayload = (await usersResponse.json()) as { users?: AuthUser[] };
  const optedOut = await optedOutUsers(supabaseSecret);
  const completeRows = (await completeResponse.json()) as { user_id: string }[];
  const completeUsers = new Set(completeRows.map((row) => row.user_id));
  const recipients = (usersPayload.users || [])
    .filter(
      (user): user is AuthUser & { email: string } =>
        Boolean(user.email && user.email_confirmed_at) &&
        !optedOut.has(user.id) &&
        !completeUsers.has(user.id),
    )
    .map((user) => ({ id: user.id, email: user.email }));

  if (!recipients.length) {
    return Response.json({ success: true, week: weekId, sent: 0 });
  }

  const claimResponse = await supabaseRequest(
    "/rest/v1/pick_reminder_sends?on_conflict=week_id,user_id",
    supabaseSecret,
    {
      method: "POST",
      headers: {
        Prefer: "resolution=ignore-duplicates,return=representation",
      },
      body: JSON.stringify(
        recipients.map((recipient) => ({
          week_id: weekId,
          user_id: recipient.id,
          status: "pending",
        })),
      ),
    },
  );

  if (!claimResponse.ok) {
    return Response.json({ error: "Unable to reserve reminders" }, { status: 502 });
  }

  const claimed = (await claimResponse.json()) as { user_id: string }[];
  const claimedIds = new Set(claimed.map((row) => row.user_id));
  const toSend = recipients.filter((recipient) => claimedIds.has(recipient.id));
  let sent = 0;
  const failures: string[] = [];

  for (let index = 0; index < toSend.length; index += 100) {
    const batch = toSend.slice(index, index + 100);
    const resendResponse = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        batch.map((recipient) => ({
          from,
          to: [recipient.email],
          subject: `Mooberball Week ${weekNumber}, Lock In Your Picks!`,
          html: reminderHtml(unsubscribeUrl(recipient.id)),
          text: `Howdy Moober! Don’t forget to lock in your picks for this week: ${SITE_URL}/\n\nPicks lock Monday at 6:00 a.m. Eastern Time.\n\nUnsubscribe from all Mooberball emails: ${unsubscribeUrl(recipient.id)}`,
          headers: { "List-Unsubscribe": `<${unsubscribeUrl(recipient.id)}>` },
        })),
      ),
    });

    if (!resendResponse.ok) {
      failures.push(...batch.map((recipient) => recipient.id));
      await releaseClaims(weekId, batch, supabaseSecret);
      continue;
    }

    const ids = batch.map((recipient) => recipient.id).join(",");
    await supabaseRequest(
      `/rest/v1/pick_reminder_sends?week_id=eq.${weekId}&user_id=in.(${ids})`,
      supabaseSecret,
      {
        method: "PATCH",
        body: JSON.stringify({
          status: "sent",
          sent_at: new Date().toISOString(),
        }),
      },
    );
    sent += batch.length;
  }

  return Response.json({
    success: failures.length === 0,
    week: weekId,
    eligible: recipients.length,
    sent,
    failed: failures.length,
  });
}
