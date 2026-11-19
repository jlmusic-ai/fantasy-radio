import { STUFF_A_BUS_PICK_OPEN, STUFF_A_BUS_WEEK } from "../lib/game";
import { emailDatabase } from "../lib/email-unsubscribe";
import { loadSeasonPodium, type PodiumEntry } from "../lib/season-results";

type BusResult = { username: string; guess: number; buses: number; distance: number };

export default async function SeasonAnnouncements() {
  const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const now = new Date();
  let podium: PodiumEntry[] = [];
  let busResults: BusResult[] = [];
  try {
    podium = await loadSeasonPodium(secret);
    if (now >= new Date("2026-12-04T05:00:00Z")) {
      const response = await emailDatabase("/rest/v1/stuff_a_bus_results?select=username,guess,buses,distance&order=distance.asc,username.asc&limit=1000", secret);
      if (!response.ok) throw new Error("Unable to load Stuff a Bus standings");
      busResults = await response.json();
    }
  } catch (error) {
    console.error("Unable to load season announcements:", error);
  }
  const champions = podium.filter((entry) => entry.place === 1);
  const busWinners = busResults.filter((entry) => entry.distance === busResults[0]?.distance);
  const showSpecial = now < new Date("2026-12-05T05:00:00Z") &&
    (champions.length > 0 || now >= new Date(STUFF_A_BUS_PICK_OPEN));

  if (!champions.length && !showSpecial && !busWinners.length) return null;
  return (
    <section className="panel" aria-label="Mooberball seasons">
      {champions.length > 0 && (
        <>
          <h2>🏆 Season One {champions.length === 1 ? "Champion" : "Co-champions"}</h2>
          <p>Congratulations to <strong>{champions.map(({ username }) => username).join(" and ")}</strong>, finishing Season One with <strong>{champions[0].score.toLocaleString("en-US")} points</strong>!</p>
          <p className="muted">Season One is complete. Thanks for playing, Moobers!</p>
        </>
      )}
      {busWinners.length > 0 ? (
        <>
          <h2>Stuff a Bus {busWinners.length === 1 ? "winner" : "co-winners"}</h2>
          <p>Mikey and Bob filled <strong>{busWinners[0].buses} {busWinners[0].buses === 1 ? "bus" : "buses"}</strong> with toys for Toys for Tots.</p>
          <p>Closest {busWinners.length === 1 ? "guess" : "guesses"}: {busWinners.map(({ username, guess }) => `${username} (${guess})`).join(", ")}.</p>
          <p><a href="/stuff-a-bus">See the Stuff a Bus standings</a></p>
        </>
      ) : showSpecial && (
        <>
          <h2><a href="/stuff-a-bus">Stuff a Bus · Nov. 30–Dec. 4</a></h2>
          <p>Make your regular picks and enter one guess for how many buses Mikey and Bob will fill with toys for Toys for Tots. Closest guess wins the Stuff a Bus challenge.</p>
          {now < new Date(STUFF_A_BUS_PICK_OPEN) && <p className="muted">Picks open Friday, Nov. 27 at 5 p.m. Eastern.</p>}
          {now >= new Date(STUFF_A_BUS_PICK_OPEN) && now < new Date(`${STUFF_A_BUS_WEEK}T11:00:00Z`) && (
            <p className="muted">Picks lock Monday, Nov. 30 at 6 a.m. Eastern.</p>
          )}
        </>
      )}
    </section>
  );
}
