"use client";
import { useEffect, useState } from "react";
import { browserClient } from "../../lib/supabase";
import { weekStart, seasonStart } from "../../lib/game";
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
export default function Commissioner() {
  const db = browserClient();
  const [allowed, setAllowed] = useState(false),
    [categories, setCategories] = useState<Category[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [week, setWeek] = useState(weekStart(new Date())),
    [category, setCategory] = useState(""),
    [quantity, setQuantity] = useState(1),
    [note, setNote] = useState(""),
    [occurred, setOccurred] = useState(""),
    [msg, setMsg] = useState(""),
    [lock, setLock] = useState("06:00");
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
    const [c, e] = await Promise.all([
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
    ]);
    setCategories(c.data || []);
    setEvents(e.data || []);
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
    const monday = new Date(week + "T06:00:00Z");
    const local = `${week}T${lock}:00`;
    const offset =
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        timeZoneName: "shortOffset",
      })
        .formatToParts(monday)
        .find((x) => x.type === "timeZoneName")?.value || "GMT-4";
    const match = offset.match(/GMT([+-])(\d+)(?::(\d+))?/);
    const mins = match
      ? (match[1] === "-" ? -1 : 1) *
        (Number(match[2]) * 60 + Number(match[3] || 0))
      : -240;
    const utc = new Date(Date.parse(local + "Z") - mins * 60000).toISOString();
    const { error } = await db
      .from("weeks")
      .upsert({ id: week, lock_at: utc, season_start: seasonStart(week) });
    setMsg(error ? error.message : "Week created or updated");
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
      setMsg("Topic and subtitle are required");
      return;
    }
    const { error } = await db
      .from("categories")
      .update({ name, description })
      .eq("id", item.id);
    setMsg(error ? error.message : "Weekly lineup topic saved");
    if (!error) load();
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
    setMsg(error ? error.message : "Weekly lineup order updated");
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
        <label>
          Week beginning Monday
          <input
            type="date"
            value={week}
            onChange={(e) => setWeek(e.target.value)}
          />
        </label>
        <label>
          Lineup lock (Pittsburgh local time)
          <input
            type="time"
            value={lock}
            onChange={(e) => setLock(e.target.value)}
          />
        </label>
        <button onClick={createWeek}>Create / update week</button>
        <p className="muted">
          Create each week before players submit picks. Updating a lock after
          submissions may affect fairness.
        </p>
      </div>
      <div className="panel">
        <h2>Weekly lineup topics</h2>
        <p className="muted">
          Edit each topic and subtitle, or use the arrows to change its display
          order.
        </p>
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
        <label>
          Broadcast time (optional; defaults to now)
          <input
            type="datetime-local"
            value={occurred}
            onChange={(e) => setOccurred(e.target.value)}
          />
        </label>
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
