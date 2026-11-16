import Link from "next/link";
import { redirect } from "next/navigation";
import { STUFF_A_BUS_PICK_OPEN, STUFF_A_BUS_WEEK } from "../../lib/game";
import { serverClient } from "../../lib/server";

export const metadata = { title: "Stuff a Bus · Mooberball" };

export default async function StuffABusPage() {
  const db = await serverClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const [finalization, schedule] = await Promise.all([
    db.from("finalized_weeks").select("scores_finalized_at").eq("week_id", STUFF_A_BUS_WEEK).maybeSingle(),
    db.from("weeks").select("lock_at,stuff_a_bus_total").eq("id", STUFF_A_BUS_WEEK).maybeSingle(),
  ]);
  const total = schedule.data?.stuff_a_bus_total;
  const finalized = Boolean(finalization.data?.scores_finalized_at);
  const today = Date.now();
  const picking = today >= Date.parse(STUFF_A_BUS_PICK_OPEN) &&
    today < Date.parse(schedule.data?.lock_at ?? "2026-11-30T11:00:00Z");
  const loadFailed = Boolean(finalization.error || schedule.error);
  const showResults = finalized && total != null;
  return (
    <div className="panel">
      <h1>Stuff a Bus</h1>
      <p>November 30–December 4, 2026</p>
      <p>Guess how many buses Mikey and Bob will fill with toys for Toys for Tots. The closest guess wins. Equally close guesses share the win.</p>
      {loadFailed ? <p role="alert">Stuff a Bus results are temporarily unavailable.</p>
        : showResults ? <StuffABusResults db={db} total={total} />
        : picking ? <p><Link href="/">Submit your lineup and prediction</Link></p>
        : today < Date.parse(STUFF_A_BUS_PICK_OPEN)
          ? <p>Picks open Friday, November 27 at 5:00 p.m. Eastern.</p>
          : <p>Results will appear here after the final number of buses is confirmed and scores are finalized.</p>}
    </div>
  );
}

async function StuffABusResults({ db, total }: { db: Awaited<ReturnType<typeof serverClient>>; total: number }) {
  const predictions: { user_id: string; guess: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("weekly_score_details").select("user_id,guess")
      .eq("week_id", STUFF_A_BUS_WEEK).eq("scoring_type", "closest_guess").not("guess", "is", null)
      .order("user_id").range(offset, offset + 499);
    if (error) return <p role="alert">Unable to load Stuff a Bus results.</p>;
    predictions.push(...data);
    if (data.length < 500) break;
  }
  const eligible: { username: string; guess: number; difference: number; id: string }[] = [];
  for (let offset = 0; offset < predictions.length; offset += 100) {
    const guesses = new Map(predictions.slice(offset, offset + 100)
      .map(({ user_id, guess }) => [user_id, Number(guess)]));
    const ids = [...guesses.keys()];
    const [profiles, lineups] = await Promise.all([
      db.from("profiles").select("id,username").eq("hide_from_leaderboards", false).in("id", ids),
      db.from("weekly_lineup_status").select("user_id").eq("week_id", STUFF_A_BUS_WEEK)
        .eq("allocated_points", 100).in("user_id", ids),
    ]);
    if (profiles.error || lineups.error) return <p role="alert">Unable to load Stuff a Bus results.</p>;
    const completed = new Set(lineups.data.map(({ user_id }) => user_id));
    for (const { id, username } of profiles.data) {
      const guess = guesses.get(id);
      if (guess !== undefined && completed.has(id)) {
        eligible.push({ id, username, guess, difference: Math.abs(guess - total) });
      }
    }
  }
  eligible.sort((a, b) => a.difference - b.difference || a.username.localeCompare(b.username));
  const places = new Map<number, number>();
  eligible.forEach(({ difference }, index) => {
    if (!places.has(difference)) places.set(difference, index + 1);
  });
  const winners = eligible.filter(({ difference }) => places.get(difference) === 1);
  return (
    <>
      <h2>{total} {total === 1 ? "bus" : "buses"} stuffed</h2>
      {winners.length > 0 ? (
        <>
          <p><strong>{winners.length === 1 ? "Winner" : "Tied winners"}</strong> · {winners.map(({ username }) => username).join(", ")}</p>
          <table>
            <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Guess</th><th scope="col">Buses off</th></tr></thead>
            <tbody>{eligible.map(({ id, username, guess, difference }) => (
              <tr key={id}>
                <td>{places.get(difference)}</td>
                <td>{username}</td><td>{guess}</td><td>{difference}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      ) : <p>No eligible predictions were submitted.</p>}
    </>
  );
}
