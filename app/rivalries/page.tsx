import Image from "next/image";
import { redirect } from "next/navigation";
import { defaultLockAt, formatDate, weekStart } from "../../lib/game";
import { serverClient } from "../../lib/server";
import RivalriesBoard, { type RivalryPlayer } from "./rivalries-board";

export const metadata = {
  title: "Rivalries | Mooberball",
  description: "This week's head-to-head and three-player Mooberball matchups.",
};

type Assignment = { user_id: string; rivalry_number: number };
type Profile = { id: string; username: string; avatar_url: string | null };
type Score = { user_id: string; score: number };

export default async function RivalriesPage() {
  const db = await serverClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const week = weekStart(new Date());
  const [assignment, profiles, scores, weekRow, finalized, lineups] = await Promise.all([
    db.from("weekly_rivalries").select("user_id,rivalry_number")
      .eq("week_id", week).order("rivalry_number").limit(1000),
    db.from("profiles").select("id,username,avatar_url")
      .eq("hide_from_leaderboards", false).limit(1000),
    db.from("weekly_scores").select("user_id,score")
      .eq("week_id", week).limit(1000),
    db.from("weeks").select("lock_at").eq("id", week).maybeSingle(),
    db.from("finalized_weeks").select("scores_finalized_at")
      .eq("week_id", week).maybeSingle(),
    db.from("lineup_status_totals").select("user_id")
      .eq("week_id", week).eq("allocated_points", 100).limit(1000),
  ]);

  const error = assignment.error || profiles.error || scores.error || weekRow.error || finalized.error || lineups.error;
  const profileById = new Map(((profiles.data || []) as Profile[]).map((profile) => [profile.id, profile]));
  const scoreById = new Map(((scores.data || []) as Score[]).map((score) => [score.user_id, Number(score.score)]));
  const groups = new Map<number, RivalryPlayer[]>();
  for (const row of (assignment.data || []) as Assignment[]) {
    const profile = profileById.get(row.user_id);
    if (!profile) continue;
    const group = groups.get(row.rivalry_number) || [];
    group.push({ id: row.user_id, username: profile.username,
      avatarUrl: profile.avatar_url, score: scoreById.get(row.user_id) || 0 });
    groups.set(row.rivalry_number, group);
  }

  const lockAt = weekRow.data?.lock_at || defaultLockAt(week);
  const locked = Date.now() >= new Date(lockAt).getTime();
  const beforeLaunch = week < "2026-10-26";
  const tooFewPlayers = locked && !beforeLaunch &&
    (lineups.data || []).filter((lineup) => profileById.has(lineup.user_id)).length < 2;

  return <div className="rivalries-page">
    <div className="rivalries-intro">
      <Image src="/mooberball-rivalries-logo.png" width={900} height={450}
        alt="Mooberball Rivalries" className="rivalries-logo" priority />
      <p className="muted">Week beginning {formatDate(week)} · Pairings are set after picks lock Monday at 6 a.m. Eastern.</p>
    </div>
    {error ? <div className="panel" role="alert">Rivalries are unavailable right now. Please try again shortly.</div>
      : groups.size ? <RivalriesBoard
          groups={[...groups].map(([number, players]) => ({ number, players }))}
          viewerId={user.id} finalized={Boolean(finalized.data?.scores_finalized_at)} />
      : <div className="panel rivalry-empty">
          <h1>{beforeLaunch ? "Rivalries begin October 26" : tooFewPlayers ? "Not enough players this week" : locked ? "Pairings are on the way" : "Rivalries begin after the lock"}</h1>
          <p>{beforeLaunch
            ? "Submit your complete 100-point lineup for next week before Monday, October 26, at 6 a.m. Eastern. Your first rivalry will appear here after picks lock."
            : tooFewPlayers
            ? "At least two players need complete 100-point lineups at the lock to create a rivalry. Join us again next week!"
            : locked
            ? "The matchups are being assigned from players whose 100-point picks were in on time. Check back shortly."
            : "Finish your 100-point lineup before Monday at 6 a.m. Eastern to join this week's rivalries. Your matchup will appear here once picks lock."}</p>
        </div>}
    <p className="muted rivalry-footnote">Rivalries are for fun and don't change leaderboard points. Scores update as each day's scoring is completed.</p>
  </div>;
}
