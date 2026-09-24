"use client";

import { useEffect, useState } from "react";
import { browserClient } from "../../../lib/supabase";
import { defaultLockAt, formatDate, pickingWeek, weekStart } from "../../../lib/game";

type Category = {
  id: string;
  name: string;
  display_order: number;
};

export default function ScoreThisWeek() {
  const db = browserClient();
  const [allowed, setAllowed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [lockAt, setLockAt] = useState<string | null>(null);
  const [dailyComplete, setDailyComplete] = useState(false);
  const [dailySaving, setDailySaving] = useState(false);
  const [dailyMessage, setDailyMessage] = useState("");
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const week = weekStart(new Date(now));
  const canFinalize = pickingWeek(new Date(now)) > week;
  const canCloseEarly = !canFinalize && now >= new Date(lockAt || defaultLockAt(week)).getTime();
  const hasUnsavedTotals = categories.some((category) =>
    Number(drafts[category.id]) !== (totals[category.id] || 0),
  );

  async function load() {
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return;

    const { data: profile } = await db
      .from("profiles")
      .select("is_commissioner")
      .eq("id", user.id)
      .single();
    if (!profile?.is_commissioner) return;
    setAllowed(true);

    const [categoryResult, eventResult, finalizationResult, dailyStatusResult, weekResult] = await Promise.all([
      db
        .from("categories")
        .select("id,name,display_order")
        .eq("active", true)
        .order("display_order")
        .order("name"),
      db
        .from("events")
        .select("category_id,quantity")
        .eq("week_id", week),
      db.from("finalized_weeks").select("scores_finalized_at")
        .eq("week_id", week).maybeSingle(),
      db.rpc("today_scoring_status").single(),
      db.from("weeks").select("lock_at").eq("id", week).maybeSingle(),
    ]);

    const nextCategories = (categoryResult.data || []) as Category[];
    const nextTotals: Record<string, number> = {};
    (eventResult.data || []).forEach((event) => {
      nextTotals[event.category_id] =
        (nextTotals[event.category_id] || 0) + event.quantity;
    });
    setCategories(nextCategories);
    setFinalized(Boolean(finalizationResult.data?.scores_finalized_at));
    setLockAt(weekResult.data?.lock_at || null);
    setDailyComplete(
      Boolean((dailyStatusResult.data as { completed?: boolean } | null)?.completed),
    );
    setTotals(nextTotals);
    setDrafts(
      Object.fromEntries(
        nextCategories.map((category) => [
          category.id,
          String(nextTotals[category.id] || 0),
        ]),
      ),
    );
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [week]);

  async function updateTotal(
    categoryId: string,
    change: { delta: number } | { target: number },
  ) {
    if (finalized || finalizing) return;
    setSaving(categoryId);
    setMessage("");
    const { data, error } = await db.rpc("adjust_weekly_occurrences", {
      p_week: week,
      p_category_id: categoryId,
      p_delta: "delta" in change ? change.delta : null,
      p_target: "target" in change ? change.target : null,
    });
    setSaving(null);
    if (error) {
      setMessage(error.message);
      setDrafts((current) => ({
        ...current,
        [categoryId]: String(totals[categoryId] || 0),
      }));
      return;
    }
    const nextTotal = Number(data);
    setTotals((current) => ({ ...current, [categoryId]: nextTotal }));
    setDrafts((current) => ({
      ...current,
      [categoryId]: String(nextTotal),
    }));
    setMessage("Score updated.");
  }

  function saveDraft(categoryId: string) {
    if (finalized || finalizing) return;
    const value = Number(drafts[categoryId]);
    if (!Number.isInteger(value) || value < 0 || value > 5000) {
      setMessage("Enter a whole number between 0 and 5000.");
      setDrafts((current) => ({
        ...current,
        [categoryId]: String(totals[categoryId] || 0),
      }));
      return;
    }
    if (value !== (totals[categoryId] || 0)) {
      updateTotal(categoryId, { target: value });
    }
  }

  async function toggleDailyScoring() {
    if (dailySaving) return;
    setDailySaving(true);
    setDailyMessage("");
    const nextComplete = !dailyComplete;
    const { error } = await db.rpc("set_today_scoring_complete", {
      p_complete: nextComplete,
    });
    setDailySaving(false);
    if (error) {
      setDailyMessage(error.message);
      await load();
      return;
    }
    setDailyComplete(nextComplete);
    setDailyMessage(
      nextComplete
        ? "Today’s scoring is now marked complete."
        : "Today’s scoring is now marked incomplete.",
    );
  }

  async function finalizeScores(early = false) {
    if (!(early ? canCloseEarly : canFinalize) || finalized || finalizing || saving || hasUnsavedTotals) return;
    const warning = early
      ? "Close this broadcast week early and award birthday bonuses now? All occurrence totals and weekly scores will be frozen. You cannot undo this. Next week’s picks will still open Friday at 5:00 p.m. Eastern."
      : "Finalize this week’s scores and award the birthday bonus? You won’t be able to edit these totals afterward.";
    if (!window.confirm(warning)) return;
    setFinalizing(true);
    setMessage("");
    const { data, error } = await db.rpc(
      early ? "finalize_week_scores_early" : "finalize_week_scores",
      { p_week: week },
    );
    setFinalizing(false);
    if (error) {
      setMessage(error.message);
      await load();
      return;
    }
    setFinalized(true);
    setMessage(`Scores finalized${early ? " early" : ""} for ${Number(data)} ${Number(data) === 1 ? "player" : "players"}. Birthday bonuses have been awarded.`);
  }

  if (!allowed) {
    return (
      <div className="panel">
        <h1>Score this week</h1>
        <p>Log in with an authorized commissioner account to access this page.</p>
      </div>
    );
  }

  return (
    <>
      <h1>Score this week</h1>
      <p className="muted">
        Week beginning {formatDate(week)}. Tap plus or minus as moments happen,
        or enter the weekly total directly.
      </p>
      <section className="panel">
        <h2>Today’s scoring status</h2>
        <p className="muted">
          Mark today complete after you have finished scoring the podcast.
          You can undo this if you need to make a correction. A new day
          automatically starts as incomplete at midnight Eastern.
        </p>
        <div
          className={`daily-scoring-status ${
            finalized || dailyComplete ? "daily-scoring-complete" : "daily-scoring-pending"
          }`}
          role="status"
        >
          <strong>
            {finalized
              ? "This week’s scores are final."
              : dailyComplete
              ? "Today’s scoring is complete."
              : "Today’s scoring has not yet been completed."}
          </strong>
        </div>
        <button
          type="button"
          disabled={dailySaving || finalized}
          onClick={() => void toggleDailyScoring()}
        >
          {finalized
            ? "Week finalized"
            : dailySaving
            ? "Updating…"
            : dailyComplete
              ? "Undo: mark today incomplete"
              : "Mark today’s scoring complete"}
        </button>
        {dailyMessage && (
          <p className={dailyMessage.includes("now marked") ? "success" : "error"}>
            {dailyMessage}
          </p>
        )}
      </section>
      {categories.map((category) => {
        const busy = saving === category.id;
        return (
          <div className="panel score-topic" key={category.id}>
            <h2>{category.name}</h2>
            <div className="score-controls">
              <button
                className="score-step"
                type="button"
                aria-label={`Subtract one from ${category.name}`}
                disabled={busy || finalizing || finalized || (totals[category.id] || 0) === 0}
                onClick={() => updateTotal(category.id, { delta: -1 })}
              >
                −
              </button>
              <input
                className="score-total"
                aria-label={`Total occurrences for ${category.name}`}
                inputMode="numeric"
                type="number"
                min="0"
                max="5000"
                step="1"
                value={drafts[category.id] ?? "0"}
                disabled={busy || finalizing || finalized}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [category.id]: event.target.value,
                  }))
                }
                onBlur={() => saveDraft(category.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
              <button
                className="score-step"
                type="button"
                aria-label={`Add one to ${category.name}`}
                disabled={busy || finalizing || finalized}
                onClick={() => updateTotal(category.id, { delta: 1 })}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
      <section className="panel">
        <h2>Finalize scores</h2>
        <p className="muted">
          Check every occurrence total before finalizing to award the birthday bonus.
          You can close a short broadcast week early after Monday&apos;s picks lock.
          An exact guess earns
          50 points; each number away earns two fewer, with a minimum of five.
          Scores and occurrence totals cannot be changed after finalization.
        </p>
        {finalized ? (
          <p className="success">This week’s scores are finalized. Birthday bonuses are included.</p>
        ) : (
          <div className="score-finalize-actions">
            <button type="button" disabled={!canFinalize || finalizing || Boolean(saving) || hasUnsavedTotals}
              onClick={() => void finalizeScores()}>
              {finalizing ? "Finalizing…" : "Finalize scores and award birthday bonus"}
            </button>
            {!canFinalize && (
              <button type="button" className="secondary-button"
                disabled={!canCloseEarly || finalizing || Boolean(saving) || hasUnsavedTotals}
                onClick={() => void finalizeScores(true)}>
                {finalizing ? "Closing week…" : "Close this week early and award bonus"}
              </button>
            )}
          </div>
        )}
        {!canFinalize && !finalized && (
          <p className="muted">Normal finalization is available Friday at 5:00 p.m. Eastern. Early closing freezes this week’s scores now; next week’s picks still open Friday at 5:00 p.m.</p>
        )}
        {hasUnsavedTotals && !finalized && <p className="muted">Save your edited occurrence totals before closing the week.</p>}
      </section>
      {message && (
        <p className={message === "Score updated." || message.startsWith("Scores finalized") ? "success" : "error"}>
          {message}
        </p>
      )}
    </>
  );
}
