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
type SeasonWeekScore = {
  user_id: string;
  week_id: string;
  score: number;
};
type SeasonStats = {
  weeksPlayed: number;
  longestStreak: number;
  highestWeeklyScore: number;
  averageWeeklyScore: number;
  bestWeek: string | null;
  hundredPointWeeks: number;
};
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function longestWeeklyStreak(weeks: string[]) {
  const uniqueWeeks = [...new Set(weeks)].sort();
  let longest = 0;
  let current = 0;
  let previous: number | null = null;
  uniqueWeeks.forEach((week) => {
    const time = new Date(`${week}T12:00:00Z`).getTime();
    current = previous !== null && time - previous === WEEK_MS ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = time;
  });
  return longest;
}
export default function Game() {
  const db = browserClient();
  const [user, setUser] = useState<string | null>(null),
    [categories, setCategories] = useState<Category[]>([]),
    [picks, setPicks] = useState<Record<string, number>>({}),
    [birthdayGuess, setBirthdayGuess] = useState<number | null>(null),
    [events, setEvents] = useState<Record<string, number>>({}),
    [completedPickUsers, setCompletedPickUsers] = useState<Set<string>>(
      new Set(),
    ),
    [leaders, setLeaders] = useState<Score[]>([]),
    [seasonLeaders, setSeasonLeaders] = useState<Score[]>([]),
    [seasonStats, setSeasonStats] = useState<Record<string, SeasonStats>>({}),
    [selectedSeasonUserId, setSelectedSeasonUserId] = useState<string | null>(null),
    [week, setWeek] = useState(pickingWeek(new Date())),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("picks"),
    [loading, setLoading] = useState(true);
  const weekRef = useRef(week);

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
    }
    const [cats, ws, ev, lb, sl, profiles, lineupStatus, seasonWeekScores] =
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
        .limit(100),
      db
        .from("season_scores")
        .select("username,avatar_url,score,user_id")
        .eq("season_start", FIRST_SEASON_START)
        .order("score", { ascending: false })
        .limit(100),
      db
        .from("profiles")
        .select("id,username,avatar_url")
        .order("username"),
      db.from("picks").select("user_id,points").eq("week_id", w),
      db
        .from("weekly_scores")
        .select("user_id,week_id,score")
        .gte("week_id", FIRST_SEASON_START)
        .lte("week_id", FIRST_SEASON_END)
        .order("week_id"),
    ]);
    setCategories((cats.data || []) as Category[]);
    const lockAt =
      pickWindowData?.closes_at || ws.data?.lock_at || defaultLockAt(w);
    setLocked(
      pickWindowData?.is_locked ??
        Date.now() >= new Date(lockAt).getTime(),
    );
    const counts: Record<string, number> = {};
    (ev.data || []).forEach(
      (e) =>
        (counts[e.category_id] = (counts[e.category_id] || 0) + e.quantity),
    );
    setEvents(counts);
    const allocatedPoints = new Map<string, number>();
    (lineupStatus.data || []).forEach((pick) => {
      allocatedPoints.set(
        pick.user_id,
        (allocatedPoints.get(pick.user_id) || 0) + pick.points,
      );
    });
    setCompletedPickUsers(
      new Set(
        [...allocatedPoints.entries()]
          .filter(([, points]) => points === 100)
          .map(([userId]) => userId),
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
    const scoresByPlayer = new Map<string, SeasonWeekScore[]>();
    ((seasonWeekScores.data || []) as SeasonWeekScore[]).forEach((row) => {
      const rows = scoresByPlayer.get(row.user_id) || [];
      rows.push(row);
      scoresByPlayer.set(row.user_id, rows);
    });
    const nextSeasonStats: Record<string, SeasonStats> = {};
    allPlayers.forEach((player) => {
      const rows = (scoresByPlayer.get(player.id) || []).sort((a, b) =>
        a.week_id.localeCompare(b.week_id),
      );
      const totalScore = rows.reduce((sum, row) => sum + row.score, 0);
      const best = rows.reduce<SeasonWeekScore | null>(
        (currentBest, row) =>
          !currentBest || row.score > currentBest.score ? row : currentBest,
        null,
      );
      nextSeasonStats[player.id] = {
        weeksPlayed: rows.length,
        longestStreak: longestWeeklyStreak(rows.map((row) => row.week_id)),
        highestWeeklyScore: best?.score ?? 0,
        averageWeeklyScore: rows.length ? Math.round(totalScore / rows.length) : 0,
        bestWeek: best?.week_id ?? null,
        hundredPointWeeks: rows.filter((row) => row.score >= 100).length,
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
    const signedAvatars = new Map<string, string>();
    if (avatarPaths.length) {
      const { data } = await db.storage
        .from("avatars")
        .createSignedUrls(avatarPaths, 3600);
      (data || []).forEach((item) => {
        if (item.path && item.signedUrl)
          signedAvatars.set(item.path, item.signedUrl);
      });
    }
    const withSignedAvatar = (player: Score) => ({
      ...player,
      avatar_url: player.avatar_url
        ? signedAvatars.get(player.avatar_url) || null
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
    const rolloverCheck = window.setInterval(
      () => load({ showLoading: false, hydratePicks: false }),
      60_000,
    );
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
    birthdayScored =
      birthdayCategory !== undefined &&
      Object.prototype.hasOwnProperty.call(events, birthdayCategory.id),
    birthdayActual = birthdayCategory ? events[birthdayCategory.id] || 0 : 0,
    bonus = birthdayScored ? birthdayBonus(birthdayGuess, birthdayActual) : 0,
    score = baseScore + bonus,
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
            {baseScore} lineup points · {bonus} birthday bonus
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
                {birthdayScored
                  ? `${birthdayActual} occurrences · ${bonus} bonus points earned`
                  : "Bonus pending until this week is scored."}
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
                Exact guess: 50 bonus points. Each number away subtracts 5
                points, down to 0.
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
                        ) : (
                          <span>{p.username}</span>
                        )}
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
