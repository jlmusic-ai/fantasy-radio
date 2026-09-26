export const ZONE = "America/New_York";
export const FIRST_SEASON_START = "2026-10-05";
export const FIRST_SEASON_END = "2026-11-20";

export function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${match[2]}-${match[3]}-${match[1]}` : value;
}

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
export function isBroadcastScoringWindow(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value;
  const day = get("weekday");
  const hour = Number(get("hour"));
  return day === "Mon" ? hour >= 6
    : day === "Fri" ? hour < 17
    : day === "Tue" || day === "Wed" || day === "Thu";
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
  return week >= FIRST_SEASON_START && week <= FIRST_SEASON_END
    ? FIRST_SEASON_START
    : week;
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
  return guess === null ? 0 : Math.max(5, 50 - Math.abs(guess - actual) * 2);
}
