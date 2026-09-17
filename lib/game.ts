export const ZONE = "America/New_York";
export function weekStart(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  const day = Number(get("day"));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    get("weekday"),
  );
  const utc = new Date(
    Date.UTC(Number(get("year")), Number(get("month")) - 1, day),
  );
  utc.setUTCDate(utc.getUTCDate() - ((weekday + 6) % 7));
  return utc.toISOString().slice(0, 10);
}
export function pickingWeek(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (k: string) => parts.find((p) => p.type === k)!.value;
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    get("weekday"),
  );
  const afterFridayCutoff =
    weekday > 5 || (weekday === 5 && Number(get("hour")) >= 17);
  const monday = new Date(`${weekStart(date)}T12:00:00Z`);
  if (afterFridayCutoff) monday.setUTCDate(monday.getUTCDate() + 7);
  return monday.toISOString().slice(0, 10);
}
export function defaultLockAt(week: string) {
  const local = `${week}T06:00`;
  const guess = new Date(`${local}:00Z`);
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    timeZoneName: "shortOffset",
  })
    .formatToParts(guess)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = zoneName?.match(/GMT([+-])(\d+)(?::(\d+))?/);
  const offset = match
    ? (match[1] === "-" ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3] || 0))
    : -240;
  return new Date(guess.getTime() - offset * 60000).toISOString();
}
export function seasonStart(week: string) {
  const d = new Date(week + "T12:00:00Z");
  const month = Math.floor(d.getUTCMonth() / 3) * 3;
  return `${d.getUTCFullYear()}-${String(month + 1).padStart(2, "0")}-01`;
}
export function validPicks(
  picks: { category_id: string; points: number }[],
  ids: string[],
) {
  return (
    picks.length === ids.length &&
    new Set(picks.map((p) => p.category_id)).size === ids.length &&
    picks.every(
      (p) =>
        ids.includes(p.category_id) &&
        Number.isInteger(p.points) &&
        p.points >= 0 &&
        p.points <= 25,
    ) &&
    picks.reduce((n, p) => n + p.points, 0) === 100
  );
}
export function birthdayBonus(guess: number | null, actual: number) {
  return guess === null ? 0 : Math.max(0, 50 - Math.abs(guess - actual) * 5);
}
