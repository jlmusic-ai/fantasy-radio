import Link from "next/link";
import { redirect } from "next/navigation";
import { STUFF_A_BUS_PICK_OPEN, STUFF_A_BUS_WEEK } from "../../lib/game";
import { serverClient } from "../../lib/server";

export const metadata = { title: "Stuff a Bus · Mooberball" };

export default async function StuffABusPage() {
  const db = await serverClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect("/login");

  const [finalization, schedule, busResult] = await Promise.all([
    db.from("finalized_weeks").select("scores_finalized_at").eq("week_id", STUFF_A_BUS_WEEK).maybeSingle(),
    db.from("weeks").select("lock_at").eq("id", STUFF_A_BUS_WEEK).maybeSingle(),
    db.from("stuff_a_bus_totals").select("buses").eq("week_id", STUFF_A_BUS_WEEK).maybeSingle(),
  ]);
  const total = busResult.data?.buses;
  const finalized = Boolean(finalization.data?.scores_finalized_at);
  const today = Date.now();
  const picking = today >= Date.parse(STUFF_A_BUS_PICK_OPEN) &&
    today < Date.parse(schedule.data?.lock_at ?? "2026-11-30T11:00:00Z");
  const loadFailed = Boolean(finalization.error || schedule.error || busResult.error);
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
  const eligible: { user_id: string; username: string; guess: number; distance: number }[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from("stuff_a_bus_results").select("user_id,username,guess,distance")
      .order("distance").order("username").order("user_id").range(offset, offset + 499);
    if (error) return <p role="alert">Unable to load Stuff a Bus results.</p>;
    eligible.push(...data);
    if (data.length < 500) break;
  }
  const places = new Map<number, number>();
  eligible.forEach(({ distance }, index) => {
    if (!places.has(distance)) places.set(distance, index + 1);
  });
  const winners = eligible.filter(({ distance }) => places.get(distance) === 1);
  return (
    <>
      <h2>{total} {total === 1 ? "bus" : "buses"} stuffed</h2>
      {winners.length > 0 ? (
        <>
          <p><strong>{winners.length === 1 ? "Winner" : "Tied winners"}</strong> · {winners.map(({ username }) => username).join(", ")}</p>
          <table>
            <thead><tr><th scope="col">Place</th><th scope="col">Player</th><th scope="col">Guess</th><th scope="col">Buses off</th></tr></thead>
            <tbody>{eligible.map(({ user_id, username, guess, distance }) => (
              <tr key={user_id}>
                <td>{places.get(distance)}</td>
                <td>{username}</td><td>{guess}</td><td>{distance}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      ) : <p>No eligible predictions were submitted.</p>}
    </>
  );
}
