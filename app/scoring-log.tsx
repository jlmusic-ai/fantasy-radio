"use client";

import { useEffect, useMemo, useState } from "react";
import { browserClient } from "../lib/supabase";
import { formatDate } from "../lib/game";

type CompletedDay = { scoring_date: string; week_id: string };
type DailyLine = {
  scoring_date: string;
  category_id: string;
  topic_name: string;
  scoring_type: string;
  quantity: number;
};

export default function ScoringLog({ currentWeek }: { currentWeek: string }) {
  const db = useMemo(() => browserClient(), []);
  const [selectedWeek, setSelectedWeek] = useState(currentWeek);
  const [days, setDays] = useState<CompletedDay[]>([]);
  const [lines, setLines] = useState<DailyLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => setSelectedWeek(currentWeek), [currentWeek]);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const [completed, counts] = await Promise.all([
        db.from("daily_scoring_status")
          .select("scoring_date,week_id")
          .order("scoring_date", { ascending: false })
          .limit(500),
        db.from("daily_scoring_lines")
          .select("scoring_date,category_id,topic_name,scoring_type,quantity")
          .eq("week_id", selectedWeek)
          .order("scoring_date", { ascending: false }),
      ]);
      if (!active) return;
      setLoading(false);
      if (completed.error || counts.error) {
        setError("The completed daily scores could not be loaded. Please try again.");
        return;
      }
      setError("");
      setDays((completed.data || []) as CompletedDay[]);
      setLines((counts.data || []) as DailyLine[]);
    }
    setLoading(true);
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [db, selectedWeek]);

  const weeks = [...new Set([currentWeek, ...days.map((day) => day.week_id)])]
    .sort((a, b) => b.localeCompare(a));
  const selectedDays = days.filter((day) => day.week_id === selectedWeek);

  return (
    <section className="panel scoring-history">
      <div className="row scoring-history-heading">
        <div>
          <h2>Scoring log</h2>
          <p className="muted">Daily counts appear after the commissioner marks that day’s scoring complete.</p>
        </div>
        <label>
          Week
          <select aria-label="Scoring log week" value={selectedWeek}
            onChange={(event) => setSelectedWeek(event.target.value)}>
            {weeks.map((week) => (
              <option value={week} key={week}>Week beginning {formatDate(week)}</option>
            ))}
          </select>
        </label>
      </div>
      {loading ? <p>Loading daily scores…</p> : error ? (
        <p className="error" role="alert">{error}</p>
      ) : selectedDays.length === 0 ? (
        <p className="muted">No days have been marked complete for this week yet.</p>
      ) : selectedDays.map((day) => {
        const dayLines = lines.filter((line) => line.scoring_date === day.scoring_date);
        const ordinary = dayLines.filter((line) => line.scoring_type !== "closest_guess");
        const bonus = dayLines.filter((line) => line.scoring_type === "closest_guess");
        return (
          <section className="scoring-day" key={day.scoring_date}>
            <div className="row scoring-day-heading">
              <h3>{formatDate(day.scoring_date)}</h3>
              <span className="scoring-day-complete">✓ Scoring complete</span>
            </div>
            {dayLines.length === 0 && <p className="muted">No qualifying occurrences recorded.</p>}
            {[...ordinary, ...bonus].map((line) => (
              <div className="row scoring-day-line" key={line.category_id}>
                <span>{line.scoring_type === "closest_guess" ? `Bonus topic: ${line.topic_name}` : line.topic_name}</span>
                <strong>{line.quantity} {line.quantity === 1 ? "occurrence" : "occurrences"}</strong>
              </div>
            ))}
          </section>
        );
      })}
      {selectedDays.length > 0 && (
        <p className="muted scoring-history-note">Birthday bonus points are awarded when the week is finalized.</p>
      )}
    </section>
  );
}
