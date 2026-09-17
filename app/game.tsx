"use client";
import { useEffect, useState } from "react";
import { browserClient } from "../lib/supabase";
import {
  birthdayBonus,
  defaultLockAt,
  formatDate,
  pickingWeek,
  seasonStart,
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
type Score = {
  username: string;
  avatar_url: string | null;
  score: number;
  user_id: string;
};
export default function Game() {
  const db = browserClient();
  const [user, setUser] = useState<string | null>(null),
    [categories, setCategories] = useState<Category[]>([]),
    [picks, setPicks] = useState<Record<string, number>>({}),
    [birthdayGuess, setBirthdayGuess] = useState<number | null>(null),
    [events, setEvents] = useState<Record<string, number>>({}),
    [leaders, setLeaders] = useState<Score[]>([]),
    [seasonLeaders, setSeasonLeaders] = useState<Score[]>([]),
    [week, setWeek] = useState(pickingWeek(new Date())),
    [locked, setLocked] = useState(false),
    [message, setMessage] = useState(""),
    [tab, setTab] = useState("picks"),
    [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    const {
      data: { user: u },
    } = await db.auth.getUser();
    setUser(u?.id || null);
    const w = pickingWeek(new Date());
    setWeek(w);
    const [cats, ws, ev, lb, sl] = await Promise.all([
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
        .eq("season_start", seasonStart(w))
        .order("score", { ascending: false })
        .limit(100),
    ]);
    setCategories((cats.data || []) as Category[]);
    const lockAt = ws.data?.lock_at || defaultLockAt(w);
    setLocked(Date.now() >= new Date(lockAt).getTime());
    const counts: Record<string, number> = {};
    (ev.data || []).forEach(
      (e) =>
        (counts[e.category_id] = (counts[e.category_id] || 0) + e.quantity),
    );
    setEvents(counts);
    const rawLeaders = (lb.data || []) as Score[];
    const rawSeasonLeaders = (sl.data || []) as Score[];
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
    if (u) {
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
      const values: Record<string, number> = {};
      (savedPicks.data || []).forEach(
        (p) => (values[p.category_id] = p.points),
      );
      setPicks(values);
      setBirthdayGuess(savedGuess.data?.guess ?? null);
    }
    setLoading(false);
  }
  useEffect(() => {
    load();
    const rolloverCheck = window.setInterval(load, 60_000);
    const channel = db
      .channel("scores")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "events" },
        () => load(),
      )
      .subscribe();
    return () => {
      window.clearInterval(rolloverCheck);
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
    bonus = birthdayBonus(birthdayGuess, birthdayActual),
    score = baseScore + bonus;
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
    if (response.ok) load();
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
          onClick={() => setTab("weekly")}
        >
          Weekly standings
        </button>
        <button
          className={tab === "season" ? "active" : ""}
          onClick={() => setTab("season")}
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
          {allocationCategories.map((c) => (
            <div key={c.id} className="panel">
              <div className="row">
                <strong>{c.name}</strong>
                <strong>{picks[c.id] || 0} pts</strong>
              </div>
              <p className="muted">
                {events[c.id] || 0} occurrences ·{" "}
                {(picks[c.id] || 0) * (events[c.id] || 0)} points earned
              </p>
              <input
                aria-label={`Points for ${c.name}`}
                type="range"
                min="0"
                max="25"
                step="1"
                value={picks[c.id] || 0}
                disabled={locked || !user}
                onChange={(e) =>
                  setPicks((p) => ({ ...p, [c.id]: Number(e.target.value) }))
                }
              />
            </div>
          ))}
          {birthdayCategory && (
            <div className="panel">
              <h3>{birthdayCategory.name}</h3>
              <p className="muted">
                {birthdayActual} occurrences · {bonus} bonus points earned
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
            <strong>{100 - total} points remaining</strong>
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
                      {p.username}
                    </span>
                  </td>
                  <td>{p.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
