"use client";

import { useEffect, useRef, useState } from "react";
import { browserClient } from "../../../lib/supabase";
import { defaultLockAt, formatDate, pickingWeek, weekStart } from "../../../lib/game";

type Category = {
  id: string;
  name: string;
  display_order: number;
  scoring_type: "allocation" | "closest_guess";
};

export default function ScoreThisWeek() {
  const db = browserClient();
  const [allowed, setAllowed] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [otherDayTotals, setOtherDayTotals] = useState<Record<string, number>>({});
  const [selectedDate, setSelectedDate] = useState("");
  const [loadedDate, setLoadedDate] = useState("");
  const loadRequest = useRef(0);
  const mutationPending = useRef(false);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [lockAt, setLockAt] = useState<string | null>(null);
  const [dailyComplete, setDailyComplete] = useState(false);
  const [dailySaving, setDailySaving] = useState(false);
  const [dailyMessage, setDailyMessage] = useState("");
  const [dailyNote, setDailyNote] = useState("");
  const [savedDailyNote, setSavedDailyNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState("");
  const week = weekStart(new Date(now));
  const easternDay = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
  const scoringDate = selectedDate >= week && selectedDate <= easternDay ? selectedDate : easternDay;
  const loading = loadedDate !== scoringDate;
  const busy = loading || Boolean(saving) || finalizing || dailySaving || noteSaving;
  const canFinalize = pickingWeek(new Date(now)) > week;
  const canCloseEarly = !canFinalize && now >= new Date(lockAt || defaultLockAt(week)).getTime();
  const hasUnsavedTotals = categories.some((category) =>
    Number(drafts[category.id]) !== (totals[category.id] || 0),
  );

  async function load() {
    const request = ++loadRequest.current;
    setLoadedDate("");
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return;

    const { data: profile } = await db
      .from("profiles")
      .select("is_commissioner")
      .eq("id", user.id)
      .single();
    if (request !== loadRequest.current || !profile?.is_commissioner) return;
    setAllowed(true);

    const [categoryResult, eventResult, finalizationResult, dailyStatusResult, weekResult] = await Promise.all([
      db
        .from("categories")
        .select("id,name,display_order,scoring_type")
        .eq("active", true)
        .order("display_order")
        .order("name"),
      db
        .from("events")
        .select("category_id,quantity,occurred_at")
        .eq("week_id", week),
      db.from("finalized_weeks").select("scores_finalized_at")
        .eq("week_id", week).maybeSingle(),
      db.from("daily_scoring_status").select("completed_at,commissioner_note")
        .eq("scoring_date", scoringDate).maybeSingle(),
      db.from("weeks").select("lock_at").eq("id", week).maybeSingle(),
    ]);

    if (request !== loadRequest.current) return;
    const loadError = [categoryResult, eventResult, finalizationResult, dailyStatusResult, weekResult].find((result) => result.error)?.error;
    if (loadError) {
      setMessage("Unable to load this show's scoring. Refresh the page to try again.");
      return;
    }
    const nextCategories = ((categoryResult.data || []) as Category[]).sort((a, b) =>
      Number(a.scoring_type === "closest_guess") - Number(b.scoring_type === "closest_guess"),
    );
    const nextTotals: Record<string, number> = {};
    const otherTotals: Record<string, number> = {};
    const dateFormat = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    });
    (eventResult.data || []).forEach((event) => {
      const target = dateFormat.format(new Date(event.occurred_at)) === scoringDate ? nextTotals : otherTotals;
      target[event.category_id] = (target[event.category_id] || 0) + event.quantity;
    });
    setOtherDayTotals(otherTotals);
    setCategories(nextCategories);
    setFinalized(Boolean(finalizationResult.data?.scores_finalized_at));
    setLockAt(weekResult.data?.lock_at || null);
    setDailyComplete(
      Boolean(dailyStatusResult.data?.completed_at),
    );
    const note = dailyStatusResult.data?.commissioner_note || "";
    setDailyNote(note);
    setSavedDailyNote(note);
    setTotals(nextTotals);
    setLoadedDate(scoringDate);
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
    return () => {
      loadRequest.current++;
      window.clearInterval(timer);
    };
  }, [week, scoringDate]);

  async function updateTotal(
    categoryId: string,
    change: { delta: number } | { target: number },
  ) {
    if (busy || mutationPending.current || finalized || dailyComplete) return;
    mutationPending.current = true;
    setSaving(categoryId);
    setMessage("");
    const { data, error } = await db.rpc("adjust_show_occurrences", {
      p_scoring_date: scoringDate,
      p_category_id: categoryId,
      p_delta: "delta" in change ? change.delta : null,
      p_target: "target" in change ? change.target : null,
    });
    mutationPending.current = false;
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
    if (busy || mutationPending.current || finalized || dailyComplete) return;
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
    if (busy || mutationPending.current || finalized || hasUnsavedTotals) return;
    mutationPending.current = true;
    setDailySaving(true);
    setDailyMessage("");
    const nextComplete = !dailyComplete;
    let error: { message: string } | null = null;
    let episodeTitle: string | null = null;
    try {
      if (nextComplete) {
        const response = await fetch("/api/commissioner/daily-scoring", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scoringDate, note: dailyNote.trim() }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to complete this show's scoring");
        episodeTitle = result.episodeTitle;
      } else {
        const result = await db.rpc("set_show_scoring_complete", { p_scoring_date: scoringDate, p_complete: false });
        error = result.error;
      }
    } catch (caught) {
      error = { message: caught instanceof Error ? caught.message : "Unable to complete this show's scoring" };
    }
    mutationPending.current = false;
    setDailySaving(false);
    if (error) {
      setDailyMessage(error.message);
      await load();
      return;
    }
    setDailyComplete(nextComplete);
    if (nextComplete) setSavedDailyNote(dailyNote.trim());
    setDailyMessage(
      nextComplete
        ? `Scoring for ${formatDate(scoringDate)} is now marked complete.${episodeTitle ? ` Episode: ${episodeTitle}` : " No matching episode title was available from the RSS feed."}`
        : `Scoring for ${formatDate(scoringDate)} is now marked incomplete.`,
    );
  }

  async function saveDailyNote() {
    if (!dailyComplete || busy || mutationPending.current || finalized) return;
    mutationPending.current = true;
    setNoteSaving(true);
    setDailyMessage("");
    const note = dailyNote.trim();
    const { error } = await db.rpc("save_show_scoring_note", {
      p_scoring_date: scoringDate, p_note: note,
    });
    mutationPending.current = false;
    setNoteSaving(false);
    if (error) {
      setDailyMessage(error.message);
      return;
    }
    setDailyNote(note);
    setSavedDailyNote(note);
    setDailyMessage("Commissioner note saved.");
  }

  async function finalizeScores(early = false) {
    if (!(early ? canCloseEarly : canFinalize) || finalized || busy || mutationPending.current || hasUnsavedTotals) return;
    const warning = early
      ? "Close this broadcast week early and award birthday bonuses now? All occurrence totals and weekly scores will be frozen. You cannot undo this. Next week’s picks will still open Friday at 5:00 p.m. Eastern."
      : "Finalize this week’s scores and award the birthday bonus? You won’t be able to edit these totals afterward.";
    if (!window.confirm(warning)) return;
    setFinalizing(true);
    setMessage("");
    let result: { finalized?: boolean; players?: number; emailed?: number; deliveryPending?: boolean; error?: string };
    try {
      const response = await fetch("/api/commissioner/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ week, early }),
      });
      result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to finalize scores");
    } catch (error) {
      setFinalizing(false);
      setMessage(error instanceof Error ? error.message : "Unable to finalize scores");
      await load();
      return;
    }
    setFinalizing(false);
    setFinalized(true);
    setMessage(`Scores finalized${early ? " early" : ""} for ${result.players} ${result.players === 1 ? "player" : "players"}. Birthday bonuses have been awarded. ${result.deliveryPending ? "Results emails are queued for another delivery attempt." : `Results emails sent to ${result.emailed} players.`}`);
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
        or enter the count for the selected show directly. Each date keeps its own
        counts, notes, and completion status.
      </p>
      <section className="panel">
        <label htmlFor="scoring-show-date">Date of show being scored (Eastern)</label>
        <input id="scoring-show-date" type="date" value={scoringDate}
          min={week} max={easternDay} disabled={busy}
          onChange={(event) => {
            if (mutationPending.current) return;
            const date = event.target.value;
            if (!date || date < week || date > easternDay) return;
            if ((hasUnsavedTotals || dailyNote.trim() !== savedDailyNote) &&
              !window.confirm("Discard unsaved changes and switch show dates?")) return;
            setSelectedDate(date);
            setLoadedDate("");
            setDailyMessage("");
            setMessage("");
          }} />
        <p className="muted">Choose today or an earlier date this week to catch up on a missed broadcast.</p>
        <h2>Scoring for {formatDate(scoringDate)}</h2>
        <p className="muted">
          Mark the selected show complete after you have finished scoring the podcast.
          The completed day and its topic counts appear in the scoring log.
          Undo completion before making a correction. Each date starts incomplete until you finish scoring it.
        </p>
        <div
          className={`daily-scoring-status ${
            finalized || dailyComplete ? "daily-scoring-complete" : "daily-scoring-pending"
          }`}
          role="status"
        >
          <strong>
            {loading ? "Loading this show’s scoring…" : finalized
              ? "This week’s scores are final."
              : dailyComplete
              ? "This show’s scoring is complete."
              : "This show’s scoring has not yet been completed."}
          </strong>
        </div>
        <label htmlFor="commissioner-daily-note">Commissioner Notes for {formatDate(scoringDate)}</label>
        <textarea
          id="commissioner-daily-note"
          rows={4}
          maxLength={2000}
          value={dailyNote}
          disabled={busy || finalized}
          onChange={(event) => setDailyNote(event.target.value)}
          placeholder="Add context for this show’s scoring (optional)."
        />
        <p className="muted">Visible with the selected show&apos;s counts in the scoring log once you mark the day complete.</p>
        {dailyComplete && !finalized && (
          <button type="button" className="secondary-button"
            disabled={busy || dailyNote.trim() === savedDailyNote}
            onClick={() => void saveDailyNote()}>
            {noteSaving ? "Saving note…" : "Save note"}
          </button>
        )}
        <button
          type="button"
          disabled={busy || finalized || hasUnsavedTotals}
          onClick={() => void toggleDailyScoring()}
        >
          {finalized
            ? "Week finalized"
            : dailySaving
            ? "Updating…"
            : dailyComplete
              ? "Undo: mark this show incomplete"
              : "Mark this show’s scoring complete"}
        </button>
        {dailyMessage && (
          <p className={dailyMessage.includes("now marked") || dailyMessage === "Commissioner note saved." ? "success" : "error"}>
            {dailyMessage}
          </p>
        )}
      </section>
      {categories.map((category) => (
          <div className="panel score-topic" key={category.id}>
            <h2>{category.name}</h2>
            {category.scoring_type === "closest_guess" && (
              <p className="muted">Birthday bonus · Record wishes here. Bonus points are awarded only when you finalize the week.</p>
            )}
            <p className="muted">Show count for {formatDate(scoringDate)} · Weekly total: {(otherDayTotals[category.id] || 0) + (totals[category.id] || 0)}</p>
            <div className="score-controls">
              <button
                className="score-step"
                type="button"
                aria-label={`Subtract one from ${category.name}`}
                disabled={busy || finalized || dailyComplete || (totals[category.id] || 0) === 0}
                onClick={() => updateTotal(category.id, { delta: -1 })}
              >
                −
              </button>
              <input
                className="score-total"
                aria-label={`Occurrences on ${formatDate(scoringDate)} for ${category.name}`}
                inputMode="numeric"
                type="number"
                min="0"
                max="5000"
                step="1"
                value={drafts[category.id] ?? "0"}
                disabled={busy || finalized || dailyComplete}
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
                disabled={busy || finalized || dailyComplete}
                onClick={() => updateTotal(category.id, { delta: 1 })}
              >
                +
              </button>
            </div>
          </div>
      ))}
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
            <button type="button" disabled={!canFinalize || busy || hasUnsavedTotals}
              onClick={() => void finalizeScores()}>
              {finalizing ? "Finalizing…" : "Finalize scores and award birthday bonus"}
            </button>
            {!canFinalize && (
              <button type="button" className="secondary-button"
                disabled={!canCloseEarly || busy || hasUnsavedTotals}
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
