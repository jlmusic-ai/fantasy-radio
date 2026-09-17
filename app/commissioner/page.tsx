"use client";
import { useEffect, useRef, useState } from "react";
import { browserClient } from "../../lib/supabase";
import { pickingWeek, seasonStart } from "../../lib/game";
type Category = {
  id: string;
  name: string;
  description: string;
  scoring_type: "allocation" | "closest_guess";
  display_order: number;
};
type Event = {
  id: string;
  category_id: string;
  quantity: number;
  note: string;
  occurred_at: string;
};
const PITTSBURGH = "America/New_York";

function formatPittsburghDateTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PITTSBURGH,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function pittsburghDateTimeToUtc(local: string) {
  const guess = new Date(`${local}:00Z`);
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: PITTSBURGH,
    timeZoneName: "shortOffset",
  })
    .formatToParts(guess)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = zoneName?.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const offsetMinutes = match
    ? (match[1] === "-" ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3] || 0))
    : -240;
  return new Date(guess.getTime() - offsetMinutes * 60_000).toISOString();
}

function DatePicker({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: "date" | "datetime-local";
  value: string;
  onChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label>
      {label}
      <div className="date-picker">
        <input
          ref={input}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          aria-label={`Open calendar for ${label}`}
          onClick={() => input.current?.showPicker?.()}
        >
          📅 Choose
        </button>
      </div>
    </label>
  );
}

export default function Commissioner() {
  const db = browserClient();
  const [allowed, setAllowed] = useState(false),
    [categories, setCategories] = useState<Category[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [week, setWeek] = useState(pickingWeek(new Date())),
    [category, setCategory] = useState(""),
    [quantity, setQuantity] = useState(1),
    [note, setNote] = useState(""),
    [occurred, setOccurred] = useState(""),
    [msg, setMsg] = useState(""),
    [weekMsg, setWeekMsg] = useState(""),
    [savingWeek, setSavingWeek] = useState(false),
    [topicMsg, setTopicMsg] = useState(""),
    [newTopicName, setNewTopicName] = useState(""),
    [newTopicDescription, setNewTopicDescription] = useState(""),
    [addingTopic, setAddingTopic] = useState(false),
    [lock, setLock] = useState(`${pickingWeek(new Date())}T06:00`);
  async function load() {
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return;
    const { data: p } = await db
      .from("profiles")
      .select("is_commissioner")
      .eq("id", user.id)
      .single();
    if (!p?.is_commissioner) return;
    setAllowed(true);
    const [c, e, savedWeek] = await Promise.all([
      db
        .from("categories")
        .select("id,name,description,scoring_type,display_order")
        .eq("active", true)
        .order("display_order")
        .order("name"),
      db
        .from("events")
        .select("id,category_id,quantity,note,occurred_at")
        .eq("week_id", week)
        .order("occurred_at", { ascending: false }),
      db.from("weeks").select("lock_at").eq("id", week).maybeSingle(),
    ]);
    setCategories(c.data || []);
    setEvents(e.data || []);
    setLock(
      savedWeek.data?.lock_at
        ? formatPittsburghDateTime(savedWeek.data.lock_at)
        : `${week}T06:00`,
    );
  }
  useEffect(() => {
    load();
  }, [week]);
  async function add() {
    const r = await fetch("/api/commissioner/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        week_id: week,
        category_id: category,
        quantity,
        note,
        occurred_at: occurred
          ? new Date(occurred).toISOString()
          : new Date().toISOString(),
      }),
    });
    const d = await r.json();
    setMsg(r.ok ? "Event recorded" : d.error);
    if (r.ok) {
      setNote("");
      load();
    }
  }
  async function remove(id: string) {
    if (!confirm("Delete this event and recalculate all scores?")) return;
    const r = await fetch("/api/commissioner/events", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (r.ok) load();
    else setMsg("Could not delete event");
  }
  async function createWeek() {
    if (!lock) {
      setWeekMsg("Choose a lineup lock date and time.");
      return;
    }
    setSavingWeek(true);
    setWeekMsg("");
    const utc = pittsburghDateTimeToUtc(lock);
    const { error } = await db
      .from("weeks")
      .upsert({ id: week, lock_at: utc, season_start: seasonStart(week) });
    setSavingWeek(false);
    setWeekMsg(
      error
        ? `Could not update week: ${error.message}`
        : `Week updated. Picks ${new Date(utc).getTime() > Date.now() ? "are open" : "remain locked because the deadline has passed"}.`,
    );
    if (!error) await load();
  }
  async function lockWeekNow() {
    if (!confirm(`Lock picks immediately for the week of ${week}?`)) return;
    setSavingWeek(true);
    setWeekMsg("");
    const now = new Date().toISOString();
    const { error } = await db
      .from("weeks")
      .upsert({ id: week, lock_at: now, season_start: seasonStart(week) });
    setSavingWeek(false);
    setWeekMsg(
      error
        ? `Could not lock picks: ${error.message}`
        : "Picks are now locked.",
    );
    if (!error) await load();
  }
  function editTopic(id: string, field: "name" | "description", value: string) {
    setCategories((items) =>
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    );
  }
  async function saveTopic(item: Category) {
    const name = item.name.trim();
    const description = item.description.trim();
    if (!name || !description) {
      setTopicMsg("Topic and subtitle are required.");
      return;
    }
    const { error } = await db
      .from("categories")
      .update({ name, description })
      .eq("id", item.id);
    setTopicMsg(error ? error.message : "Weekly lineup topic saved.");
    if (!error) load();
  }
  async function addTopic() {
    const name = newTopicName.trim();
    const description = newTopicDescription.trim();
    if (!name || !description) {
      setTopicMsg("Topic and subtitle are required.");
      return;
    }
    setAddingTopic(true);
    setTopicMsg("");
    const nextOrder =
      Math.max(0, ...categories.map((item) => item.display_order)) + 10;
    const { error } = await db.from("categories").insert({
      name,
      description,
      active: true,
      scoring_type: "allocation",
      display_order: nextOrder,
    });
    setAddingTopic(false);
    if (error) {
      setTopicMsg(error.message);
      return;
    }
    setNewTopicName("");
    setNewTopicDescription("");
    setTopicMsg("New weekly lineup topic added.");
    await load();
  }
  async function moveTopic(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (destination < 0 || destination >= categories.length) return;
    const reordered = [...categories];
    [reordered[index], reordered[destination]] = [
      reordered[destination],
      reordered[index],
    ];
    const numbered = reordered.map((item, position) => ({
      ...item,
      display_order: (position + 1) * 10,
    }));
    setCategories(numbered);
    const results = await Promise.all(
      numbered.map((item) =>
        db
          .from("categories")
          .update({ display_order: item.display_order })
          .eq("id", item.id),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    setTopicMsg(error ? error.message : "Weekly lineup order updated.");
    if (error) load();
  }
  return !allowed ? (
    <div className="panel">
      <h1>Commissioner dashboard</h1>
      <p>Log in with an authorized commissioner account to access this page.</p>
    </div>
  ) : (
    <>
      <h1>Commissioner dashboard</h1>
      <div className="panel">
        <h2>Weekly picking schedule</h2>
        <p className="muted">
          Automatic schedule: next week opens every Friday at 5:00 p.m. and
          locks Monday at 6:00 a.m., Pittsburgh time. Use these controls only
          when you need to override that schedule.
        </p>
        <DatePicker
          label="Week beginning Monday"
          type="date"
          value={week}
          onChange={setWeek}
        />
        <DatePicker
          label="Lineup lock date and time (Pittsburgh)"
          type="datetime-local"
          value={lock}
          onChange={setLock}
        />
        <div className="topic-actions">
          <button disabled={!lock || savingWeek} onClick={createWeek}>
            {savingWeek ? "Saving…" : "Save deadline override"}
          </button>
          <button disabled={savingWeek} onClick={lockWeekNow}>
            Lock picks now
          </button>
        </div>
        {lock &&
          new Date(pittsburghDateTimeToUtc(lock)).getTime() <= Date.now() && (
            <p className="error">
              This deadline has already passed, so picks will be locked.
            </p>
          )}
        {weekMsg && <p>{weekMsg}</p>}
        <p className="muted">
          Deadline overrides take effect immediately and may affect fairness
          after players have submitted picks.
        </p>
      </div>
      <div className="panel">
        <h2>Weekly lineup topics</h2>
        <p className="muted">
          Add, edit, and reorder the topics players see in their weekly lineup.
        </p>
        <div className="topic-editor">
          <h3>Add a new topic</h3>
          <label>
            Topic
            <input
              maxLength={100}
              placeholder="Enter the topic title"
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
            />
          </label>
          <label>
            Subtitle
            <textarea
              maxLength={250}
              placeholder="Explain what counts for this topic"
              value={newTopicDescription}
              onChange={(e) => setNewTopicDescription(e.target.value)}
            />
          </label>
          <button
            disabled={
              addingTopic || !newTopicName.trim() || !newTopicDescription.trim()
            }
            onClick={addTopic}
          >
            {addingTopic ? "Adding…" : "Add topic"}
          </button>
        </div>
        {topicMsg && <p>{topicMsg}</p>}
        {categories.map((item, index) => (
          <div className="topic-editor" key={item.id}>
            <label>
              Topic
              <input
                maxLength={100}
                value={item.name}
                onChange={(e) => editTopic(item.id, "name", e.target.value)}
              />
            </label>
            <label>
              Subtitle
              <textarea
                maxLength={250}
                value={item.description}
                onChange={(e) =>
                  editTopic(item.id, "description", e.target.value)
                }
              />
            </label>
            <div className="topic-actions">
              <button
                disabled={index === 0}
                onClick={() => moveTopic(index, -1)}
              >
                ↑ Move up
              </button>
              <button
                disabled={index === categories.length - 1}
                onClick={() => moveTopic(index, 1)}
              >
                ↓ Move down
              </button>
              <button onClick={() => saveTopic(item)}>Save topic</button>
            </div>
          </div>
        ))}
      </div>
      <div className="panel">
        <h2>Record an occurrence</h2>
        <label>
          Category
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">Select category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Occurrences
          <input
            type="number"
            min="1"
            max="100"
            value={quantity}
            onChange={(e) => setQuantity(Number(e.target.value))}
          />
        </label>
        <DatePicker
          label="Broadcast time (optional; defaults to now)"
          type="datetime-local"
          value={occurred}
          onChange={setOccurred}
        />
        <label>
          Notes
          <textarea
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button disabled={!category} onClick={add}>
          Record event
        </button>
        <p>{msg}</p>
      </div>
      <div className="panel">
        <h2>Recorded events</h2>
        {events.map((e) => (
          <div className="row" key={e.id}>
            <p>
              {categories.find((c) => c.id === e.category_id)?.name} ×{" "}
              {e.quantity}
              <br />
              <small className="muted">
                {new Date(e.occurred_at).toLocaleString()} · {e.note}
              </small>
            </p>
            <button onClick={() => remove(e.id)}>Delete</button>
          </div>
        ))}
      </div>
    </>
  );
}
