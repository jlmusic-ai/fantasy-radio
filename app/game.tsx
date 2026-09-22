"use client";
import { useEffect, useRef, useState } from "react";
import { browserClient } from "../lib/supabase";
import {
  birthdayBonus,
  defaultLockAt,
  FIRST_SEASON_END,
  FIRST_SEASON_START,
  formatDate,
  pickingWeek,
} from "../lib/game";
import Avatar from "./avatar";
type Category = {
  id: string;
  name: string;
  description: string;
  scoring_type: "allocation" | "closest_guess";
  display_order: number;
};
type Pick = { category_id: string; points: number };
type WeeklyBreakdown = { picks: Pick[]; guess: number | null };
type PlayerProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
};
type Score = {
  username: string;
  avatar_url: string | null;
  score: number;
  user_id: string;
};
type PickWindow = {
  active_week: string;
  closes_at: string;
  is_locked: boolean;
};
type SeasonStatsRow = {
  user_id: string;
  weeks_played: number;
  longest_streak: number;
  highest_weekly_score: number;
  average_weekly_score: number;
  best_week: string | null;
  hundred_point_weeks: number;
};
type SeasonStats = {
  weeksPlayed: number;
  longestStreak: number;
  highestWeeklyScore: number;
  averageWeeklyScore: number;
  bestWeek: string | null;
  hundredPointWeeks: number;
};
function SeasonTrophy({ rank }: { rank: number }) {
  if (rank > 3) return null;
  const names = ["Gold", "Silver", "Bronze"];
  return (
    <span
      className={`season-trophy season-trophy-${rank}`}
      aria-label={`${names[rank - 1]} trophy`}
      title={`${names[rank - 1]} trophy`}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7 3h10v3h3v2a5 5 0 0 1-5 4.9A5 5 0 0 1 13 15.58V19h3v2H8v-2h3v-3.42A5 5 0 0 1 9 12.9 5 5 0 0 1 4 8V6h3V3Zm10 5v2.73A3 3 0 0 0 18 8h-1ZM6 8a3 3 0 0 0 1 2.73V8H6Z" />
      </svg>
    </span>
  );
}
export default function Game() {
  const db = browserClient();
  const [user, setUser] = useState<string | null>(null),
    [categories, setCategories] = useState<Category[]>([]),
    [picks, setPicks] = useState<Record<string, number>>({}),
    [birthdayGuess, setBirthdayGuess] = useState<number | null>(null),
    [bonusFinalized, setBonusFinalized] = useState(false),
    [events, setEvents] = useState<Record<string, number>>({}),
    [completedPickUsers, setCompletedPickUsers] = useState<Set<string>>(
      new Set(),
    ),
    [leaders, setLeaders] = useState<Score[]>([]),
    [seasonLeaders, setSeasonLeaders] = useState<Score[]>([]),
    [seasonStats, setSeasonStats] = useState<Record<string, SeasonStats>>({}),
    [selectedSeasonUserId, setSelectedSeasonUserId] = useState<string | null>(null),
    [selectedWeeklyUserId, setSelectedWeeklyUserId] = useState<string | null>(null),
    [weeklyBreakdown, setWeeklyBreakdown] = useState<WeeklyBreakdown | null>(null),
    [breakdownLoading, setBreakdownLoading] = useState(false),
    [breakdownError, setBreakdownError] = useState(""),
    [week, setWeek] = useState(pickingWeek(new Date())),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("picks"),
    [loading, setLoading] = useState(true);
  const weekRef = useRef(week);
  const bonusFinalizedRef = useRef(false);
  const breakdownRequestRef = useRef(0);
  const avatarCacheRef = useRef(
    new Map<string, { url: string; expiresAt: number }>(),
  );

  async function load({
    showLoading = true,
    hydratePicks = true,
  }: {
    showLoading?: boolean;
    hydratePicks?: boolean;
  } = {}) {
    if (showLoading) setLoading(true);
    const [
      {
        data: { user: u },
      },
      pickWindow,
    ] = await Promise.all([
      db.auth.getUser(),
      db.rpc("active_pick_window").single(),
    ]);
    setUser(u?.id || null);
    const pickWindowData = pickWindow.data as PickWindow | null;
    const w = pickWindowData?.active_week || pickingWeek(new Date());
    const weekChanged = weekRef.current !== w;
    if (weekChanged) {
      weekRef.current = w;
      setWeek(w);
      setSelectedWeeklyUserId(null);
      setWeeklyBreakdown(null);
      breakdownRequestRef.current++;
    }
    const [cats, ws, ev, lb, sl, profiles, lineupStatus, seasonStatsRows, finalization] =
      await Promise.all([
      db
        .from("categories")
        .select("id,name,description,scoring_type,display_order")
        .eq("active", true)
        .order("display_order")
        .order("name"),
      db.from("weeks").select("lock_at").eq("id", w).maybeSingle(),
      db.from("events").select("category_id,quantity").eq("week_id", w),
      db
        .from("weekly_scores")
        .select("username,avatar_url,score,user_id")
        .eq("week_id", w)
        .order("score", { ascending: false })
        .limit(1000),
      db
        .from("season_scores")
        .select("username,avatar_url,score,user_id")
        .eq("season_start", FIRST_SEASON_START)
        .order("score", { ascending: false })
        .limit(1000),
      db
        .from("profiles")
        .select("id,username,avatar_url")
        .order("username")
        .limit(1000),
      db
        .from("weekly_lineup_status")
        .select("user_id,allocated_points")
        .eq("week_id", w)
        .limit(1000),
      db
        .from("season_player_stats")
        .select("user_id,weeks_played,longest_streak,highest_weekly_score,average_weekly_score,best_week,hundred_point_weeks")
        .limit(1000),
      db.from("finalized_weeks").select("scores_finalized_at")
        .eq("week_id", w).maybeSingle(),
    ]);
    setCategories((cats.data || []) as Category[]);
    bonusFinalizedRef.current = Boolean(finalization.data?.scores_finalized_at);
    setBonusFinalized(bonusFinalizedRef.current);
    const lockAt =
      pickWindowData?.closes_at || ws.data?.lock_at || defaultLockAt(w);
    const isLocked = Date.now() >= new Date(lockAt).getTime();
    setLocked(isLocked);
    if (!isLocked) {
      setSelectedWeeklyUserId(null);
      setWeeklyBreakdown(null);
      breakdownRequestRef.current++;
    }
    const counts: Record<string, number> = {};
    (ev.data || []).forEach(
      (e) =>
        (counts[e.category_id] = (counts[e.category_id] || 0) + e.quantity),
    );
    setEvents(counts);
    setCompletedPickUsers(
      new Set(
        (lineupStatus.data || [])
          .filter((lineup) => lineup.allocated_points === 100)
          .map((lineup) => lineup.user_id),
      ),
    );
    const allPlayers = (profiles.data || []) as PlayerProfile[];
    const includeZeroScores = (scoredPlayers: Score[]) => {
      if (!allPlayers.length) return scoredPlayers;
      const scoresByUser = new Map(
        scoredPlayers.map((player) => [player.user_id, player.score]),
      );
      return allPlayers
        .map((player) => ({
          user_id: player.id,
          username: player.username,
          avatar_url: player.avatar_url,
          score: scoresByUser.get(player.id) ?? 0,
        }))
        .sort(
          (a, b) =>
            b.score - a.score || a.username.localeCompare(b.username),
        );
    };
    const rawLeaders = includeZeroScores((lb.data || []) as Score[]);
    const rawSeasonLeaders = includeZeroScores((sl.data || []) as Score[]);
    const statsByPlayer = new Map(
      ((seasonStatsRows.data || []) as SeasonStatsRow[]).map((row) => [
        row.user_id,
        row,
      ]),
    );
    const nextSeasonStats: Record<string, SeasonStats> = {};
    allPlayers.forEach((player) => {
      const row = statsByPlayer.get(player.id);
      nextSeasonStats[player.id] = {
        weeksPlayed: row?.weeks_played ?? 0,
        longestStreak: row?.longest_streak ?? 0,
        highestWeeklyScore: row?.highest_weekly_score ?? 0,
        averageWeeklyScore: row?.average_weekly_score ?? 0,
        bestWeek: row?.best_week ?? null,
        hundredPointWeeks: row?.hundred_point_weeks ?? 0,
      };
    });
    setSeasonStats(nextSeasonStats);
    const avatarPaths = [
      ...new Set(
        [...rawLeaders, ...rawSeasonLeaders]
          .map((player) => player.avatar_url)
          .filter((path): path is string => Boolean(path)),
      ),
    ];
    const now = Date.now();
    const pathsToSign = avatarPaths.filter((path) => {
      const cached = avatarCacheRef.current.get(path);
      return !cached || cached.expiresAt <= now + 5 * 60_000;
    });
    const batches = Array.from(
      { length: Math.ceil(pathsToSign.length / 100) },
      (_, index) => pathsToSign.slice(index * 100, index * 100 + 100),
    );
    const signedBatches = await Promise.all(
      batches.map((batch) =>
        db.storage.from("avatars").createSignedUrls(batch, 3600),
      ),
    );
    signedBatches.forEach(({ data }) => {
      (data || []).forEach((item) => {
        if (item.path && item.signedUrl) {
          avatarCacheRef.current.set(item.path, {
            url: item.signedUrl,
            expiresAt: now + 3600_000,
          });
        }
      });
    });
    const withSignedAvatar = (player: Score) => ({
      ...player,
      avatar_url: player.avatar_url
        ? avatarCacheRef.current.get(player.avatar_url)?.url || null
        : null,
    });
    setLeaders(rawLeaders.map(withSignedAvatar));
    setSeasonLeaders(rawSeasonLeaders.map(withSignedAvatar));
    if (u && (hydratePicks || weekChanged)) {
      const [savedPicks, savedGuess] = await Promise.all([
        db
          .from("picks")
          .select("category_id,points")
          .eq("week_id", w)
          .eq("user_id", u.id),
        db
          .from("birthday_predictions")
          .select("guess")
          .eq("week_id", w)
          .eq("user_id", u.id)
          .maybeSingle(),
      ]);
      if (savedPicks.error || savedGuess.error) {
        setMessage(
          "Your saved lineup could not be refreshed. The displayed points have been retained.",
        );
      } else {
        const values: Record<string, number> = {};
        (savedPicks.data || []).forEach(
          (p) => (values[p.category_id] = p.points),
        );
        setPicks(values);
        setBirthdayGuess(savedGuess.data?.guess ?? null);
      }
    } else if (!u && weekChanged) {
      setPicks({});
      setBirthdayGuess(null);
    }
    if (showLoading) setLoading(false);
  }
  useEffect(() => {
    load();
    const refreshPickWindow = async () => {
      const { data } = await db.rpc("active_pick_window").single();
      const nextWindow = data as PickWindow | null;
      if (!nextWindow) return;
      if (nextWindow.active_week !== weekRef.current) {
        await load({ showLoading: false, hydratePicks: true });
      } else {
        const { data: finalization } = await db.from("finalized_weeks")
          .select("scores_finalized_at").eq("week_id", nextWindow.active_week)
          .maybeSingle();
        if (Boolean(finalization?.scores_finalized_at) !== bonusFinalizedRef.current) {
          await load({ showLoading: false, hydratePicks: false });
          return;
        }
        const isLocked = Date.now() >= new Date(nextWindow.closes_at).getTime();
        setLocked(isLocked);
        if (!isLocked) {
          setSelectedWeeklyUserId(null);
          setWeeklyBreakdown(null);
          breakdownRequestRef.current++;
        }
      }
    };
    const rolloverCheck = window.setInterval(refreshPickWindow, 60_000);
    const refreshVisibleData = () =>
      load({ showLoading: false, hydratePicks: false });
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshVisibleData();
    };
    window.addEventListener("focus", refreshVisibleData);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const channel = db
      .channel("scores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        refreshVisibleData,
      )
      .subscribe();
    return () => {
      window.clearInterval(rolloverCheck);
      window.removeEventListener("focus", refreshVisibleData);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      db.removeChannel(channel);
    };
  }, []);
  const allocationCategories = categories.filter(
      (c) => c.scoring_type === "allocation",
    ),
    birthdayCategory = categories.find(
      (c) => c.scoring_type === "closest_guess",
    ),
    total = allocationCategories.reduce((a, c) => a + (picks[c.id] || 0), 0),
    baseScore = allocationCategories.reduce(
      (a, c) => a + (picks[c.id] || 0) * (events[c.id] || 0),
      0,
    ),
    birthdayActual = birthdayCategory ? events[birthdayCategory.id] || 0 : 0,
    bonus = bonusFinalized ? birthdayBonus(birthdayGuess, birthdayActual) : 0,
    score = baseScore + bonus,
    selectedWeeklyPlayer = leaders.find(
      (player) => player.user_id === selectedWeeklyUserId,
    ),
    selectedSeasonPlayer = seasonLeaders.find(
      (player) => player.user_id === selectedSeasonUserId,
    ),
    selectedSeasonPlayerStats = selectedSeasonPlayer
      ? seasonStats[selectedSeasonPlayer.user_id]
      : undefined,
    selectedSeasonRank = selectedSeasonPlayer
      ? seasonLeaders.findIndex(
          (player) => player.user_id === selectedSeasonPlayer.user_id,
        ) + 1
      : 0;
  async function showWeeklyBreakdown(playerId: string) {
    if (!locked) return;
    if (selectedWeeklyUserId === playerId) {
      breakdownRequestRef.current++;
      setSelectedWeeklyUserId(null);
      setWeeklyBreakdown(null);
      return;
    }
    const requestId = ++breakdownRequestRef.current;
    setSelectedWeeklyUserId(playerId);
    setWeeklyBreakdown(null);
    setBreakdownError("");
    setBreakdownLoading(true);
    const [savedPicks, savedGuess] = await Promise.all([
      db.from("picks").select("category_id,points")
        .eq("week_id", week).eq("user_id", playerId),
      db.from("birthday_predictions").select("guess")
        .eq("week_id", week).eq("user_id", playerId).maybeSingle(),
    ]);
    if (requestId !== breakdownRequestRef.current) return;
    // The database enforces the lock too, including for direct API requests.
    if (savedPicks.error || savedGuess.error) {
      setBreakdownError("Unable to load this lineup right now.");
    } else {
      setWeeklyBreakdown({
        picks: (savedPicks.data || []) as Pick[],
        guess: savedGuess.data?.guess ?? null,
      });
    }
    setBreakdownLoading(false);
  }
  async function save() {
    setMessage("");
    const body: Pick[] = allocationCategories.map((c) => ({
      category_id: c.id,
      points: picks[c.id] || 0,
    }));
    const response = await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week,
        picks: body,
        birthday_guess: birthdayGuess,
      }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? "Lineup and birthday guess saved successfully."
        : data.error || "Unable to save",
    );
    if (response.ok) {
      await load({ showLoading: false, hydratePicks: true });
    }
  }
  return (
    <>
      <h1>Mooberball</h1>
      <p className="muted">
        Make your picks. Follow the show. Climb the leaderboard. · 100 points
        per week · 25 points maximum per category
      </p>
      <div className="grid">
        <div className="panel">
          <div className="muted">YOUR WEEKLY SCORE</div>
          <div className="score">{score} pts</div>
          <div className="muted">
            {baseScore} lineup points · {bonusFinalized ? `${bonus} birthday bonus` : "Birthday bonus pending"}
          </div>
          <div className="muted">Week beginning {formatDate(week)}</div>
        </div>
        <div className="panel">
          <div className="muted">LINEUP STATUS</div>
          <h2>{locked ? "Locked" : "Open for picks"}</h2>
          <div className="muted">{total} / 100 points allocated</div>
        </div>
      </div>
      <div className="tabs">
        <button
          className={tab === "picks" ? "active" : ""}
          onClick={() => setTab("picks")}
        >
          My picks
        </button>
        <button
          className={tab === "weekly" ? "active" : ""}
          onClick={() => {
            setTab("weekly");
            void load({ showLoading: false, hydratePicks: false });
          }}
        >
          Weekly standings
        </button>
        <button
          className={tab === "season" ? "active" : ""}
          onClick={() => {
            setTab("season");
            void load({ showLoading: false, hydratePicks: false });
          }}
        >
          Season standings
        </button>
        <button
          className={tab === "log" ? "active" : ""}
          onClick={() => setTab("log")}
        >
          Scoring log
        </button>
      </div>
      {loading ? (
        <p>Loading game…</p>
      ) : tab === "picks" ? (
        <div className="panel">
          <h2>Weekly lineup</h2>
          {!user && (
            <p>
              <a href="/signup">Create an account</a> or{" "}
              <a href="/login">log in</a> to save your picks.
            </p>
          )}
          {allocationCategories.length < 4 && (
            <p className="error">
              Commissioner: add at least four active point categories before
              accepting lineups.
            </p>
          )}
          {allocationCategories.map((c) => {
            const currentPoints = picks[c.id] || 0;
            const pointsRemaining = Math.max(0, 100 - total);
            return (
              <div key={c.id} className="panel">
                <div className="row">
                  <strong>{c.name}</strong>
                  <strong>{currentPoints} pts</strong>
                </div>
                <p className="muted">
                  {events[c.id] || 0} occurrences ·{" "}
                  {currentPoints * (events[c.id] || 0)} points earned
                </p>
                <input
                  aria-label={`Points for ${c.name}`}
                  type="range"
                  min="0"
                  max="25"
                  step="1"
                  value={currentPoints}
                  disabled={locked || !user}
                  onChange={(e) => {
                    const requestedPoints = Number(e.target.value);
                    setPicks((currentPicks) => {
                      const otherPoints = allocationCategories.reduce(
                        (sum, category) =>
                          category.id === c.id
                            ? sum
                            : sum + (currentPicks[category.id] || 0),
                        0,
                      );
                      return {
                        ...currentPicks,
                        [c.id]: Math.min(
                          requestedPoints,
                          25,
                          Math.max(0, 100 - otherPoints),
                        ),
                      };
                    });
                  }}
                />
                <div className="slider-status" aria-live="polite">
                  <span>{currentPoints} points on this topic</span>
                  <strong>{pointsRemaining} points left</strong>
                </div>
              </div>
            );
          })}
          {birthdayCategory && (
            <div className="panel">
              <h3>{birthdayCategory.name}</h3>
              <p className="muted">
                {bonusFinalized
                  ? `${birthdayActual} occurrences · ${bonus} bonus points earned`
                  : "Bonus points are awarded after the commissioner finalizes this week’s scores."}
              </p>
              <label>
                Your guess
                <input
                  aria-label="Birthday wishes guess"
                  type="number"
                  min="0"
                  max="500"
                  step="1"
                  value={birthdayGuess ?? ""}
                  disabled={locked || !user}
                  onChange={(e) =>
                    setBirthdayGuess(
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                />
              </label>
              <p className="muted">
                Exact guess: 50 bonus points. Each number away subtracts 2
                points, down to a minimum of 5. Awarded only when this week’s
                scores are finalized.
              </p>
            </div>
          )}
          <div className="row">
            <strong>{Math.max(0, 100 - total)} points remaining</strong>
            <button
              disabled={
                !user ||
                locked ||
                total !== 100 ||
                allocationCategories.length < 4 ||
                birthdayGuess === null
              }
              onClick={save}
            >
              Save lineup
            </button>
          </div>
          {message && (
            <p className={message.includes("success") ? "success" : "error"}>
              {message}
            </p>
          )}
        </div>
      ) : tab === "weekly" || tab === "season" ? (
        <div className="panel">
          <h2>{tab === "weekly" ? "Weekly" : "Season"} leaderboard</h2>
          <div
            className="leaderboard-scroll"
            tabIndex={0}
            aria-label={`${tab === "weekly" ? "Weekly" : "Season"} leaderboard, scroll for more players`}
          >
            <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Player</th>
                <th>Points</th>
              </tr>
            </thead>
            <tbody>
              {(tab === "weekly" ? leaders : seasonLeaders).map((p, i) => (
                <tr key={p.user_id}>
                  <td>{i + 1}</td>
                  <td>
                    <span className="player-cell">
                      <Avatar name={p.username} url={p.avatar_url} size={34} />
                      <span className="player-name-line">
                        {tab === "season" ? (
                          <button
                            type="button"
                            className="leaderboard-user-button"
                            onClick={() =>
                              setSelectedSeasonUserId((selected) =>
                                selected === p.user_id ? null : p.user_id,
                              )
                            }
                            aria-expanded={selectedSeasonUserId === p.user_id}
                          >
                            {p.username}
                          </button>
                        ) : locked ? (
                          <button
                            type="button"
                            className="leaderboard-user-button"
                            onClick={() => void showWeeklyBreakdown(p.user_id)}
                            aria-expanded={selectedWeeklyUserId === p.user_id}
                          >
                            {p.username}
                          </button>
                        ) : (
                          <span>{p.username}</span>
                        )}
                        {tab === "season" && <SeasonTrophy rank={i + 1} />}
                        {tab === "weekly" && (
                          <span
                            className={`pick-status-badge ${
                              completedPickUsers.has(p.user_id)
                                ? "pick-status-complete"
                                : "pick-status-incomplete"
                            }`}
                            data-tooltip={
                              completedPickUsers.has(p.user_id)
                                ? "Picks are in!"
                                : "Points still remaining."
                            }
                            aria-label={
                              completedPickUsers.has(p.user_id)
                                ? "Picks are in!"
                                : "Points still remaining."
                            }
                            role="img"
                            tabIndex={0}
                          >
                            {completedPickUsers.has(p.user_id) ? "✓" : "?"}
                          </span>
                        )}
                      </span>
                    </span>
                  </td>
                  <td>{p.score}</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          {tab === "weekly" && locked && selectedWeeklyPlayer && (
            <section className="season-stats-card" aria-live="polite">
              <div className="season-stats-heading">
                <div className="profile-heading">
                  <Avatar name={selectedWeeklyPlayer.username} url={selectedWeeklyPlayer.avatar_url} size={48} />
                  <div>
                    <span className="eyebrow">Week beginning {formatDate(week)}</span>
                    <h3>{selectedWeeklyPlayer.username}&apos;s lineup</h3>
                  </div>
                </div>
                <button type="button" className="season-stats-close"
                  onClick={() => { breakdownRequestRef.current++; setSelectedWeeklyUserId(null); setWeeklyBreakdown(null); }}
                  aria-label="Close weekly lineup">×</button>
              </div>
              {breakdownLoading ? <p>Loading lineup…</p> : breakdownError ? (
                <p className="error">{breakdownError}</p>
              ) : weeklyBreakdown ? (
                weeklyBreakdown.picks.length === 0 ? <p>No lineup submitted for this week.</p> : (
                  <>
                    <div className="weekly-breakdown-header muted">
                      <span>Topic</span><span>Allocated</span><span>Occurrences</span><span>Earned</span>
                    </div>
                    {weeklyBreakdown.picks.map((pick) => {
                      const topic = categories.find((c) => c.id === pick.category_id);
                      const count = events[pick.category_id] || 0;
                      return (
                        <div className="weekly-breakdown-row" key={pick.category_id}>
                          <strong>{topic?.name || "Retired topic"}</strong>
                          <span>{pick.points}</span><span>{count}</span>
                          <strong>{pick.points * count}</strong>
                        </div>
                      );
                    })}
                    {birthdayCategory && (
                      <div className="weekly-breakdown-row">
                        <strong>{birthdayCategory.name}</strong>
                        <span>Guess: {weeklyBreakdown.guess ?? "—"}</span>
                        <span>{bonusFinalized ? birthdayActual : "Pending"}</span>
                        <strong>{bonusFinalized ? birthdayBonus(weeklyBreakdown.guess, birthdayActual) : "Pending"}</strong>
                      </div>
                    )}
                    <div className="weekly-breakdown-total">
                      <strong>Weekly score</strong><strong>{selectedWeeklyPlayer.score} pts</strong>
                    </div>
                  </>
                )
              ) : null}
            </section>
          )}
          {tab === "season" &&
            selectedSeasonPlayer &&
            selectedSeasonPlayerStats && (
              <section className="season-stats-card" aria-live="polite">
                <div className="season-stats-heading">
                  <div className="profile-heading">
                    <Avatar
                      name={selectedSeasonPlayer.username}
                      url={selectedSeasonPlayer.avatar_url}
                      size={48}
                    />
                    <div>
                      <span className="eyebrow">Season profile</span>
                      <h3>{selectedSeasonPlayer.username}</h3>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="season-stats-close"
                    onClick={() => setSelectedSeasonUserId(null)}
                    aria-label="Close season statistics"
                  >
                    ×
                  </button>
                </div>
                <div className="season-stats-grid">
                  <div className="season-stat"><span>Season rank</span><strong>#{selectedSeasonRank}</strong></div>
                  <div className="season-stat"><span>Total points</span><strong>{selectedSeasonPlayer.score}</strong></div>
                  <div className="season-stat"><span>Weeks played</span><strong>{selectedSeasonPlayerStats.weeksPlayed}</strong></div>
                  <div className="season-stat"><span>Longest streak</span><strong>{selectedSeasonPlayerStats.longestStreak} {selectedSeasonPlayerStats.longestStreak === 1 ? "week" : "weeks"}</strong></div>
                  <div className="season-stat"><span>Highest weekly score</span><strong>{selectedSeasonPlayerStats.highestWeeklyScore}</strong></div>
                  <div className="season-stat"><span>Average per week</span><strong>{selectedSeasonPlayerStats.averageWeeklyScore}</strong></div>
                  <div className="season-stat"><span>Best week</span><strong>{selectedSeasonPlayerStats.bestWeek ? formatDate(selectedSeasonPlayerStats.bestWeek) : "—"}</strong></div>
                  <div className="season-stat"><span>100+ point weeks</span><strong>{selectedSeasonPlayerStats.hundredPointWeeks}</strong></div>
                </div>
                {selectedSeasonPlayerStats.weeksPlayed === 0 && (
                  <p className="muted season-stats-note">No official season weeks played yet.</p>
                )}
                <p className="muted season-stats-note">
                  Official season: {formatDate(FIRST_SEASON_START)} through {formatDate(FIRST_SEASON_END)}
                </p>
              </section>
            )}
        </div>
      ) : (
        <div className="panel">
          <h2>Verified occurrences this week</h2>
          {categories.map((c) => (
            <div className="row" key={c.id}>
              <p>{c.name}</p>
              <strong>{events[c.id] || 0}</strong>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
