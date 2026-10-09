"use client";
import { useEffect, useState } from "react";
import { browserClient } from "../lib/supabase";
import { calendarScoreWeek, defaultLockAt, FIRST_SEASON_START, FIRST_SEASON_END, formatDate } from "../lib/game";
import ShareScore from "./share-score";
import SeasonTrophy from "./season-trophy";

type WeekScore = { week_id: string; score: number };
type Card = { userId: string | null; week: string; username: string; score: number; lineup: number; bonus: number; finalized: boolean; submitted: boolean; rank: number; tied: boolean; players: number };

export default function PersonalScores({ userId, revision, seasonRank, seasonPlayers }: {
  userId: string | null; revision: number; seasonRank: number; seasonPlayers: number;
}) {
  const [week, setWeek] = useState(() => calendarScoreWeek(new Date()));
  const [card, setCard] = useState<Card | null>(null);
  const [history, setHistory] = useState<WeekScore[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setInterval(() => setWeek(calendarScoreWeek(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!userId) { setCard(null); setHistory([]); return; }
    let cancelled = false;
    async function load() {
      const db = browserClient();
      const [scores, status, finalized, picks, lines, profile, details, currentFinal] = await Promise.all([
        db.from("weekly_scores").select("user_id,score").eq("week_id", week).order("score", { ascending: false }).limit(1000),
        db.from("weekly_lineup_status").select("user_id,allocated_points").eq("week_id", week).limit(1000),
        db.from("finalized_weeks").select("week_id").not("scores_finalized_at", "is", null)
          .gte("week_id", FIRST_SEASON_START).lte("week_id", FIRST_SEASON_END).order("week_id", { ascending: false }).limit(52),
        db.from("picks").select("category_id,points").eq("week_id", week).eq("user_id", userId),
        db.from("daily_scoring_lines").select("category_id,quantity").eq("week_id", week),
        db.from("profiles").select("username").eq("id", userId).single(),
        db.from("weekly_score_details").select("scoring_type,earned").eq("week_id", week).eq("user_id", userId),
        db.from("finalized_weeks").select("scores_finalized_at").eq("week_id", week).maybeSingle(),
      ]);
      if (cancelled) return;
      if (!profile.data || [scores, status, finalized, picks, lines, profile, details, currentFinal].some((r) => r.error)) {
        setError("Your score card and history could not be refreshed. Please try again shortly."); return;
      }
      const finalWeeks = (finalized.data || []).map((row) => row.week_id);
      const saved = finalWeeks.length
        ? await db.from("weekly_score_snapshots").select("week_id,score").eq("user_id", userId)
          .in("week_id", finalWeeks).order("week_id", { ascending: false }).limit(52)
        : { data: [] as WeekScore[], error: null };
      if (cancelled) return;
      if (saved.error) { setError("Your score history could not be refreshed. Please try again shortly."); return; }
      const eligible = new Set((status.data || []).filter((row) => row.allocated_points === 100).map((row) => row.user_id));
      const participants = (scores.data || []).filter((row) => eligible.has(row.user_id));
      const own = participants.find((row) => row.user_id === userId);
      const isFinal = Boolean(currentFinal.data?.scores_finalized_at);
      const counts = new Map<string, number>();
      for (const line of lines.data || []) counts.set(line.category_id, (counts.get(line.category_id) || 0) + line.quantity);
      const lineup = isFinal
        ? (details.data || []).filter((line) => line.scoring_type === "allocation").reduce((sum, line) => sum + line.earned, 0)
        : (picks.data || []).reduce((sum, pick) => sum + pick.points * (counts.get(pick.category_id) || 0), 0);
      const bonus = isFinal ? (details.data || []).filter((line) => line.scoring_type === "closest_guess").reduce((sum, line) => sum + line.earned, 0) : 0;
      const score = own?.score ?? saved.data?.find((row) => row.week_id === week)?.score ?? lineup + bonus;
      setCard({ userId, week, username: profile.data.username, score, lineup, bonus, finalized: isFinal,
        submitted: eligible.has(userId), rank: own ? participants.findIndex((row) => row.score === own.score) + 1 : 0,
        tied: own ? participants.filter((row) => row.score === own.score).length > 1 : false, players: participants.length });
      setHistory(saved.data || []); setError("");
    }
    void load();
    return () => { cancelled = true; };
  }, [userId, week, revision]);

  const current = card?.week === week && card.userId === userId ? card : null;
  const locked = Date.now() >= new Date(defaultLockAt(week)).getTime();
  const weeklyRank = current?.rank ? `${current.tied ? "Tied for " : ""}#${current.rank} of ${current.players}` : "No submitted lineup";
  const seasonRankText = seasonRank ? `#${seasonRank} of ${seasonPlayers}` : "Not ranked yet";
  return <div className="panel personal-scores">
    <div className="muted">YOUR WEEKLY SCORE</div>
    {error && <p className="error" role="status">{error}</p>}
    {!current ? <p>{userId ? "Loading your weekly score…" : "Log in to see your weekly score."}</p> : <>
      <div className="score">{current.score} pts</div>
      <div className="weekly-rank" role="status">
        <div className="rank-row"><span>Weekly rank:</span><span className={locked && current.rank > 0 && current.rank <= 3 ? `rank-highlight rank-highlight-${current.rank}` : undefined}>
          {locked && current.rank > 0 && current.rank <= 3 && <SeasonTrophy rank={current.rank} />}{locked ? weeklyRank : "Starts when picks lock"}</span></div>
        <div className="rank-row"><span>Season rank:</span><span className={seasonRank > 0 && seasonRank <= 3 ? `rank-highlight rank-highlight-${seasonRank}` : undefined}>
          {seasonRank > 0 && seasonRank <= 3 && <SeasonTrophy rank={seasonRank} />}{seasonRankText}</span></div>
      </div>
      <div className="muted">{current.lineup} lineup points · {current.finalized ? `${current.bonus} birthday bonus` : "Birthday bonus pending"}</div>
      <div className="muted">Week beginning {formatDate(week)}</div>
      <div className="muted">{current.finalized ? "Final score · This card stays here through Saturday night." : "Points update after each day’s scoring is complete."}</div>
      {current.submitted && locked && !error && <ShareScore card={{ ...current, weeklyRank, seasonRank: seasonRankText }} />}
    </>}
    <details className="personal-score-history">
      <summary>Your scores over time</summary>
      <p className="muted">Season 1 · {formatDate(FIRST_SEASON_START)}–{formatDate(FIRST_SEASON_END)} · Finalized weeks only</p>
      {history.length ? <>
        <div className="score-history-summary"><strong>{history.reduce((sum, row) => sum + row.score, 0)} season points</strong><span>Best week: {Math.max(...history.map((row) => row.score))} pts</span></div>
        <ol className="score-history-list">{history.map((row) => <li key={row.week_id}><span>Week beginning {formatDate(row.week_id)}</span><strong>{row.score} pts</strong></li>)}</ol>
      </> : <p className="muted">Your finalized weekly scores will appear here after you complete a week.</p>}
    </details>
  </div>;
}
