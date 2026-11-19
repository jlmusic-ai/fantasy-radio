import { emailDatabase as supabaseRequest, optedOutUsers, unsubscribeFooter, unsubscribeHeaders, unsubscribeUrl } from "./email-unsubscribe";
import { FIRST_SEASON_START, FIRST_SEASON_END, FIRST_SEASON_FINALE, STUFF_A_BUS_WEEK } from "./game";
import { loadSeasonPodium, type PodiumEntry } from "./season-results";

const SITE_URL = "https://mooberball.com";
function picksReminder(now = new Date()) {
  const friday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short",
  }).format(now) === "Fri";
  return `Reminder: Next week's picks will open ${friday ? "" : "Friday "}at 5pm EST!`;
}

type Recipient = {
  user_id: string;
  email: string | null;
  username: string;
  score: number;
  place: number;
  tied: boolean;
};

function ordinal(place: number) {
  const suffix = place % 100 >= 11 && place % 100 <= 13
    ? "th" : place % 10 === 1 ? "st" : place % 10 === 2 ? "nd" : place % 10 === 3 ? "rd" : "th";
  return `${place}${suffix}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function weekLabel(week: string) {
  if (week >= FIRST_SEASON_START && week <= FIRST_SEASON_END) {
    const index = Math.floor((Date.parse(`${week}T12:00:00Z`) - Date.parse(`${FIRST_SEASON_START}T12:00:00Z`)) / 604_800_000) + 1;
    return `Week ${index}`;
  }
  return `week of ${week.slice(5, 7)}-${week.slice(8, 10)}-${week.slice(0, 4)}`;
}

const recap = "That’s a wrap on the first season of Mooberball! This has been a super fun seven weeks! Thanks for playing along and making our first season such a good time.";
const upcomingTitle = "Up next: Stuff a Bus · Nov. 30–Dec. 4";
const upcoming = "With Season One over, we’re taking a week off. For the Stuff a Bus special season, you'll make your regular picks and give one guess for how many buses will get filled with toys! The closer you are to the number, the more bonus points you get that week. Works the same as Bob's birthday wishes!";
const medals = ["🏆", "🥈", "🥉"];
const points = (score: number) => new Intl.NumberFormat("en-US").format(score);

function congratulations(podium: PodiumEntry[]) {
  const champions = podium.filter((entry) => entry.place === 1).map((entry) => entry.username);
  if (champions.length === 1) return `Congratulations to our first-ever Mooberball champion, ${champions[0]}!`;
  if (champions.length > 1) return `Congratulations to our Season One co-champions, ${champions.join(" and ")}!`;
  return "";
}

export function renderWeekResult(week: string, recipient: Recipient, podium?: PodiumEntry[], now = new Date()) {
  const finale = week === FIRST_SEASON_FINALE;
  if (finale && !podium) throw new Error("Season One standings are required for its finale email");
  const reminder = week === STUFF_A_BUS_WEEK ? "" : picksReminder(now);
  const subject = finale ? "Mooberball Season One Final Results 🏆"
    : `Mooberball ${weekLabel(week)} Results: ${ordinal(recipient.place)} Place`;
  const result = `${recipient.tied ? "Tied for " : ""}${ordinal(recipient.place)} place`;
  const footer = finale ? [
    "Season One top 3",
    ...(podium ?? []).map((entry) => `${entry.place}. ${medals[entry.place - 1]} ${entry.username} · ${points(entry.score)} points`),
    "", congratulations(podium ?? []), "", upcomingTitle, upcoming,
  ].join("\n") : reminder;
  const text = [
    "Howdy Moober!", finale ? recap : `${recipient.username}, the scores are final.`,
    `${finale ? "Your Week 7 finish: " : ""}${result} · ${points(recipient.score)} ${recipient.score === 1 ? "point" : "points"}`,
    footer, `See final scores: ${SITE_URL}/`, finale ? "-Chef Jon" : "",
    `Unsubscribe from all Mooberball emails: ${unsubscribeUrl(recipient.user_id)}`,
  ].filter(Boolean).join("\n\n");
  return { subject, text, html: resultHtml(week, recipient, reminder, finale ? podium : undefined) };
}

function resultHtml(week: string, recipient: Recipient, reminder: string, podium?: PodiumEntry[]) {
  const result = `${recipient.tied ? "Tied for " : ""}${ordinal(recipient.place)} place`;
  const name = escapeHtml(recipient.username);
  const finale = podium !== undefined;
  const seasonBlock = finale ? `
        <h2 style="margin:26px 0 12px;color:#ffca05;font-size:23px;">Season One top 3</h2>
        <div style="padding:16px 20px;border:1px solid #5a4600;border-radius:12px;background:#242017;">
          ${podium.map((entry) => `<p style="margin:8px 0;color:#fff;font-size:17px;">${entry.place}. ${medals[entry.place - 1]} <strong>${escapeHtml(entry.username)}</strong> · ${points(entry.score)} points</p>`).join("")}
        </div>
        <p style="margin:18px 0;color:#e2e2e2;font-size:17px;line-height:1.5;">${escapeHtml(congratulations(podium))}</p>
        <h2 style="margin:24px 0 8px;color:#ffca05;font-size:21px;">${upcomingTitle}</h2>
        <p style="margin:0 0 20px;color:#e2e2e2;font-size:16px;line-height:1.5;">${upcoming}</p>` : "";
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>${finale ? "Mooberball Season One final results" : "Mooberball weekly results"}</title></head>
  <body style="margin:0;background:#050505;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
    <div style="padding:32px 16px;background:#0b0b0b;">
      <div style="max-width:680px;margin:0 auto;padding:30px;border:1px solid #4d3d00;border-radius:18px;background:#151515;">
        <img src="${SITE_URL}/mooberball-logo.png" width="180" alt="Mooberball" style="display:block;width:180px;max-width:70%;height:auto;margin:0 0 26px;">
        <p style="margin:0 0 8px;color:#ffca05;font-size:13px;font-weight:900;letter-spacing:.15em;text-transform:uppercase;">${finale ? "Season One" : escapeHtml(weekLabel(week))} · final results</p>
        <h1 style="margin:0 0 18px;color:#ffca05;font-size:36px;line-height:1.1;text-transform:uppercase;">Howdy Moober!</h1>
        <p style="margin:0 0 18px;color:#e2e2e2;font-size:19px;line-height:1.6;">${finale ? recap : `${name}, the scores are final. Here is where you finished this week:`}</p>
        <div style="padding:20px;border:1px solid #5a4600;border-radius:12px;background:#242017;">
          ${finale ? '<p style="margin:0 0 8px;color:#e2e2e2;font-size:15px;">Your Week 7 finish</p>' : ""}
          <p style="margin:0 0 8px;color:#ffca05;font-size:28px;font-weight:800;">${result}</p>
          <p style="margin:0;color:#ffffff;font-size:19px;">${points(recipient.score)} ${recipient.score === 1 ? "point" : "points"}</p>
        </div>
        ${finale ? seasonBlock : '<p style="margin:22px 0;color:#e2e2e2;font-size:16px;line-height:1.5;">See the weekly leaderboard and how your points were earned on Mooberball.</p>'}
        <a href="${SITE_URL}/" style="display:inline-block;padding:14px 20px;border-radius:9px;background:#ffca05;color:#151515;font-size:16px;font-weight:800;text-decoration:none;">See final scores</a>
        ${finale || reminder ? `<p style="margin:24px 0 0;color:#ffca05;font-size:16px;line-height:1.5;">${finale ? "-Chef Jon" : escapeHtml(reminder)}</p>` : ""}
        <p style="margin:24px 0 0;color:#999999;font-size:12px;line-height:1.5;">Mooberball is an independent fan-made game.</p>
        ${unsubscribeFooter(unsubscribeUrl(recipient.user_id))}
      </div>
    </div>
  </body>
</html>`;
}

export async function dispatchWeekResults(week: string, maxBatches = 8) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new Error("Invalid week");
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!secret || !resendKey || !from) throw new Error("Results email service is not configured");
  const podium = week === FIRST_SEASON_FINALE ? await loadSeasonPodium(secret) : undefined;
  let sent = 0;

  for (let index = 0; index < maxBatches; index++) {
    const claim = await supabaseRequest("/rest/v1/rpc/claim_week_result_emails", secret, {
      method: "POST", body: JSON.stringify({ p_week: week, p_limit: 100 }),
    });
    if (!claim.ok) throw new Error(`Unable to reserve results emails (HTTP ${claim.status}, ${claim.headers.get("sb-error-code") || "unknown"})`);
    const rows = (await claim.json()) as Recipient[];
    if (!rows.length) break;
    const optedOut = await optedOutUsers(secret);
    const recipients = rows.filter((row) => Boolean(row.email) && !optedOut.has(row.user_id));
    const ids = rows.map((row) => row.user_id);
    const acknowledge = async (userIds: string[], delivered: boolean) => {
      const response = await supabaseRequest("/rest/v1/rpc/complete_week_result_emails", secret, {
        method: "POST", body: JSON.stringify({ p_week: week, p_user_ids: userIds, p_sent: delivered }),
      });
      if (!response.ok) throw new Error(`Unable to record results email delivery (HTTP ${response.status})`);
    };

    if (recipients.length) {
      const emailRequest = {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `mooberball-results-${week}-${recipients[0].user_id}-${recipients.at(-1)!.user_id}`,
        },
        body: JSON.stringify(recipients.map((recipient) => ({
          from, to: [recipient.email],
          ...renderWeekResult(week, recipient, podium),
          headers: unsubscribeHeaders(recipient.user_id),
        }))),
      };
      let response = await fetch("https://api.resend.com/emails/batch", emailRequest);
      if (response.status === 429) {
        const retrySeconds = Math.min(5, Math.max(1, Number(response.headers.get("retry-after")) || 2));
        await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1000));
        response = await fetch("https://api.resend.com/emails/batch", emailRequest);
      }
      if (!response.ok) {
        await acknowledge(ids, false);
        throw new Error(`Results email provider did not accept the batch (HTTP ${response.status})`);
      }
      const receipt = (await response.json()) as { data?: { id: string }[] };
      if (receipt.data?.length !== recipients.length) {
        await acknowledge(ids, false);
        throw new Error("Results email provider returned an incomplete batch");
      }
      await acknowledge(recipients.map((row) => row.user_id), true);
      sent += recipients.length;
    }
    const missing = rows.filter((row) => !row.email || optedOut.has(row.user_id)).map((row) => row.user_id);
    if (missing.length) await acknowledge(missing, true);
  }
  return sent;
}

export async function pendingResultWeeks() {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Supabase secret is not configured");
  const response = await supabaseRequest(
    "/rest/v1/week_result_email_sends?select=week_id&status=in.(pending,processing)&order=week_id.desc&limit=1000",
    secret,
  );
  if (!response.ok) throw new Error(`Unable to load pending results emails (HTTP ${response.status}, ${response.headers.get("sb-error-code") || "unknown"})`);
  const rows = (await response.json()) as { week_id: string }[];
  return [...new Set(rows.map((row) => row.week_id))];
}
