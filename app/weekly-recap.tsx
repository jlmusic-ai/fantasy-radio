"use client";

import { useEffect, useState } from "react";
import { browserClient } from "../lib/supabase";
import { FIRST_SEASON_END, FIRST_SEASON_START, formatDate } from "../lib/game";

type Player = { user_id: string; score: number; profiles: { username: string } | null };
type JoinedPlayer = Omit<Player, "profiles"> & { profiles: { username: string }[] | { username: string } | null };
function joinedProfile(value: JoinedPlayer["profiles"]): Player["profiles"] {
  return Array.isArray(value) ? value[0] || null : value;
}
type Detail = {
  user_id: string;
  topic_name: string;
  scoring_type: "allocation" | "closest_guess";
  allocated_points: number;
  occurrences: number;
  earned: number;
  guess: number | null;
  profiles: { username: string } | null;
};
type Recap = {
  week: string;
  winner: Player;
  tiedWinners: number;
  mover: { name: string; places: number } | null;
  standout: Detail | null;
  birthday: Detail | null;
  myScore: number | null;
  myRank: number | null;
  myDetails: Detail[];
};

function name(player: { profiles: { username: string } | null }) {
  return player.profiles?.username || "Player";
}

export default function WeeklyRecap({ userId, finalized }: { userId: string | null; finalized: boolean }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const db = browserClient();
      const latest = await db.from("finalized_weeks")
        .select("week_id")
        .not("scores_finalized_at", "is", null)
        .gte("week_id", FIRST_SEASON_START)
        .lte("week_id", FIRST_SEASON_END)
        .order("week_id", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (latest.error) { setError("Weekly recap is unavailable right now."); setLoading(false); return; }
      const week = latest.data?.week_id;
      if (!week) { setRecap(null); setLoading(false); return; }

      const previousMonday = new Date(`${week}T12:00:00Z`);
      previousMonday.setUTCDate(previousMonday.getUTCDate() - 7);
      const previousWeek = previousMonday.toISOString().slice(0, 10);
      const [current, previous, bestPick, bestBonus, ownDetails] = await Promise.all([
        db.from("weekly_score_snapshots")
          .select("user_id,score,profiles(username)").eq("week_id", week)
          .order("score", { ascending: false }).limit(1000),
        previousWeek >= FIRST_SEASON_START
          ? db.from("weekly_score_snapshots")
            .select("user_id,score,profiles(username)").eq("week_id", previousWeek)
            .order("score", { ascending: false }).limit(1000)
          : Promise.resolve({ data: [] as Player[], error: null }),
        db.from("weekly_score_details")
          .select("user_id,topic_name,scoring_type,allocated_points,occurrences,earned,guess,profiles(username)")
          .eq("week_id", week).eq("scoring_type", "allocation")
          .order("earned", { ascending: false }).limit(1).maybeSingle(),
        db.from("weekly_score_details")
          .select("user_id,topic_name,scoring_type,allocated_points,occurrences,earned,guess,profiles(username)")
          .eq("week_id", week).eq("scoring_type", "closest_guess")
          .order("earned", { ascending: false }).limit(1).maybeSingle(),
        db.from("weekly_score_details")
          .select("user_id,topic_name,scoring_type,allocated_points,occurrences,earned,guess,profiles(username)")
          .eq("week_id", week).eq("user_id", userId)
          .order("earned", { ascending: false }),
      ]);
      if (cancelled) return;
      if ([current, previous, bestPick, bestBonus, ownDetails].some((result) => result.error)) {
        setError("Weekly recap is unavailable right now."); setLoading(false); return;
      }
      const normalizePlayers = (rows: JoinedPlayer[]): Player[] => rows.map((row) => ({
        ...row, profiles: joinedProfile(row.profiles),
      }));
      const players = normalizePlayers((current.data || []) as JoinedPlayer[]);
      const lastPlayers = normalizePlayers((previous.data || []) as JoinedPlayer[]);
      if (!players.length) { setRecap(null); setLoading(false); return; }
      const byScore = (a: Player, b: Player) => b.score - a.score || name(a).localeCompare(name(b));
      players.sort(byScore);
      lastPlayers.sort(byScore);
      const priorRanks = new Map(lastPlayers.map((player, index) => [player.user_id, index + 1]));
      const climber = players.map((player, index) => ({
        name: name(player), places: (priorRanks.get(player.user_id) ?? index + 1) - (index + 1),
        playedBefore: priorRanks.has(player.user_id),
      })).filter((player) => player.playedBefore && player.places > 0)
        .sort((a, b) => b.places - a.places || a.name.localeCompare(b.name))[0];
      const myRankIndex = players.findIndex((player) => player.user_id === userId);
      setRecap({
        week, winner: players[0],
        tiedWinners: players.filter((player) => player.score === players[0].score).length,
        mover: climber ? { name: climber.name, places: climber.places } : null,
        standout: bestPick.data ? { ...bestPick.data, profiles: joinedProfile(bestPick.data.profiles) } as Detail : null,
        birthday: bestBonus.data ? { ...bestBonus.data, profiles: joinedProfile(bestBonus.data.profiles) } as Detail : null,
        myScore: myRankIndex >= 0 ? players[myRankIndex].score : null,
        myRank: myRankIndex >= 0 ? myRankIndex + 1 : null,
        myDetails: (ownDetails.data || []).map((line) => ({ ...line, profiles: joinedProfile(line.profiles) })) as Detail[],
      });
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [userId, finalized]);

  async function share() {
    if (!recap) return;
    const summary = `Mooberball week of ${formatDate(recap.week)}: ${name(recap.winner)} led with ${recap.winner.score} points. ` +
      (recap.standout ? `Top pick: ${name(recap.standout)} earned ${recap.standout.earned} points on ${recap.standout.topic_name}. ` : "") +
      "Play at https://mooberball.com";
    try {
      if (navigator.share) await navigator.share({ title: "Mooberball weekly recap", text: summary });
      else { await navigator.clipboard.writeText(summary); setShareMessage("Recap copied to clipboard."); }
    } catch (cause) {
      if ((cause as DOMException).name !== "AbortError") setShareMessage("Unable to share right now.");
    }
  }

  if (!userId || (!recap && !loading && !error)) return null;
  return (
    <section className="panel weekly-recap" aria-label="Weekly recap">
      <div className="recap-heading">
        <div><span className="eyebrow">Final scores · {recap ? formatDate(recap.week) : ""}</span><h2>Weekly recap</h2></div>
        {recap && <button type="button" className="secondary-button" onClick={() => void share()}>Share recap</button>}
      </div>
      {loading && !recap && <p>Loading the latest recap…</p>}
      {error && <p className="error">{error}</p>}
      {recap && <>
        <div className="recap-grid">
          <div><span>🏆 Weekly winner{recap.tiedWinners > 1 ? " (tie)" : ""}</span><strong>{name(recap.winner)}</strong><small>{recap.winner.score} points</small></div>
          <div><span>📈 Biggest climb</span><strong>{recap.mover?.name || "—"}</strong><small>{recap.mover ? `Up ${recap.mover.places} ${recap.mover.places === 1 ? "place" : "places"} from last week` : "No returning player climbed yet"}</small></div>
          <div><span>🎯 Strongest pick</span><strong>{recap.standout ? name(recap.standout) : "—"}</strong><small>{recap.standout ? `${recap.standout.earned} points · ${recap.standout.topic_name}` : "No points earned on lineup topics"}</small></div>
          <div><span>🎂 Birthday bonus leader</span><strong>{recap.birthday ? name(recap.birthday) : "—"}</strong><small>{recap.birthday ? `${recap.birthday.earned} bonus points · guessed ${recap.birthday.guess}, actual ${recap.birthday.occurrences}` : "No birthday guesses"}</small></div>
        </div>
        {recap.myScore !== null && <div className="recap-my-score">
          <div><strong>Your week: {recap.myScore} points</strong><span className="muted">Rank #{recap.myRank} · {recap.winner.score - recap.myScore} points behind the lead</span></div>
          <button type="button" className="secondary-button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded}>
            {expanded ? "Hide my breakdown" : "See how I scored"}
          </button>
        </div>}
        {expanded && recap.myDetails.length > 0 && <div className="recap-breakdown">
          <div className="weekly-breakdown-header muted"><span>Topic</span><span>Allocated</span><span>Occurrences</span><span>Earned</span></div>
          {recap.myDetails.map((line) => <div className="weekly-breakdown-row" key={`${line.user_id}-${line.topic_name}`}>
            <strong>{line.scoring_type === "closest_guess" ? `Bonus: ${line.topic_name}` : line.topic_name}</strong>
            <span>{line.scoring_type === "closest_guess" ? `Guess ${line.guess}` : line.allocated_points}</span>
            <span>{line.occurrences}</span><strong>{line.earned}</strong>
          </div>)}
          <div className="weekly-breakdown-total"><strong>Official weekly score</strong><strong>{recap.myScore} pts</strong></div>
          {recap.myDetails.some((line) => line.scoring_type === "closest_guess") &&
            <p className="muted recap-note">Birthday bonus: an exact guess earns 50 points; each number away subtracts 2, with a minimum of 5.</p>}
        </div>}
        {shareMessage && <p role="status" className="muted recap-note">{shareMessage}</p>}
      </>}
    </section>
  );
}
