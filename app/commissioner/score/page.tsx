"use client";

import { useEffect, useState } from "react";
import { browserClient } from "../../../lib/supabase";
import { formatDate, weekStart } from "../../../lib/game";

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
  const [message, setMessage] = useState("");
  const week = weekStart(new Date());

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

    const [categoryResult, eventResult] = await Promise.all([
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
    ]);

    const nextCategories = (categoryResult.data || []) as Category[];
    const nextTotals: Record<string, number> = {};
    (eventResult.data || []).forEach((event) => {
      nextTotals[event.category_id] =
        (nextTotals[event.category_id] || 0) + event.quantity;
    });
    setCategories(nextCategories);
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
    load();
  }, []);

  async function updateTotal(
    categoryId: string,
    change: { delta: number } | { target: number },
  ) {
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
                disabled={busy || (totals[category.id] || 0) === 0}
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
                disabled={busy}
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
                disabled={busy}
                onClick={() => updateTotal(category.id, { delta: 1 })}
              >
                +
              </button>
            </div>
          </div>
        );
      })}
      {message && (
        <p className={message === "Score updated." ? "success" : "error"}>
          {message}
        </p>
      )}
    </>
  );
}
