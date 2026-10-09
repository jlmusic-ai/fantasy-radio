import { formatDate } from "../../lib/game";

export const metadata = {
  title: "Changelog | Mooberball",
  description: "New features, improvements, and bug fixes released since Mooberball Season 1 began.",
};

type Release = {
  date: string;
  title: string;
  groups: { label: string; items: string[] }[];
};

// Keep newest releases first. Dates reflect releases in America/New_York.
const releases: Release[] = [
  {
    date: "2026-10-09",
    title: "Score sharing and lineup improvements",
    groups: [
      { label: "Added", items: [
        "Your scores over time lists your finalized weekly scores for Season 1, with your season total and best week.",
        "Share my score card: preview and download a personal weekly score image with your username, points, weekly rank, and season rank. On supported devices, share the image through the device’s share menu, including Facebook where available.",
        "New season high! celebrates a finalized weekly score that beats your best earlier finalized week in the season. It starts after your first completed week; ties do not count as a new record.",
        "New this week labels highlight topics that were not in the previous week’s lineup when picks are open.",
        "Optional qualification subtitles are back for lineup topics, including Bob’s Birthday Wishes. Topics without a subtitle keep their usual appearance.",
        "This Changelog page keeps players informed about updates since Season 1 began.",
      ] },
      { label: "Improved", items: [
        "Your Weekly Score now follows a Sunday–Saturday calendar week in Pittsburgh time. Opening next week’s picks on Friday no longer replaces your current score card, giving you through Saturday night to share it.",
        "Season Profiles now count 200+ point weeks instead of 100+ point weeks, using finalized scores from the official season.",
      ] },
      { label: "Fixed", items: [
        "The locked weekly lineup keeps that week’s saved topics until picks open for the next week. Upcoming topic changes no longer appear early.",
        "Your finalized weekly score and saved point allocations remain intact when lineup topics are changed or removed for an upcoming week.",
      ] },
      { label: "Removed", items: [
        "Removed Share recap from the weekly recap in favor of sharing your own weekly score card.",
      ] },
    ],
  },
  {
    date: "2026-10-06",
    title: "Scoring visibility fixes",
    groups: [
      { label: "Fixed", items: [
        "Weekly player totals and the weekly leaderboard now include a day’s points only after the commissioner marks that day’s scoring complete.",
        "Season totals, season rankings, and Season Profile statistics include a week only after its scores are finalized.",
        "Individual player scorecards now withhold draft occurrence counts and earned points until the day’s scoring is complete, matching the published totals.",
      ] },
      { label: "Improved", items: [
        "The Founding Member badge now uses a blue gemstone diamond icon.",
      ] },
    ],
  },
  {
    date: "2026-10-05",
    title: "Season 1: ranks and founding members",
    groups: [
      { label: "Added", items: [
        "Your weekly score card now displays your current weekly rank and season rank.",
        "Top-three weekly and season ranks receive special gold, silver, and bronze trophy styling.",
        "Players registered when founding status was introduced received a visible Founding Member badge, regardless of whether they submitted picks.",
      ] },
      { label: "Fixed", items: [
        "Topic names in player pick breakdowns stay stable during background refreshes instead of briefly appearing as retired options.",
      ] },
    ],
  },
];

export default function ChangelogPage() {
  return <div className="changelog">
    <div className="changelog-intro">
      <span className="eyebrow">Mooberball updates</span>
      <h1>Changelog</h1>
      <p className="muted">New features, improvements, and bug fixes since Season 1 began on 10-05-2026. Latest updates appear first.</p>
    </div>
    {releases.map((release, index) => <article className="panel changelog-release" key={release.date} aria-labelledby={`release-${release.date}`}>
      <div className="changelog-release-heading">
        <time dateTime={release.date}>{formatDate(release.date)}</time>
        {index === 0 && <span className="changelog-latest">Latest update</span>}
      </div>
      <h2 id={`release-${release.date}`}>{release.title}</h2>
      {release.groups.map((group) => <section className="changelog-group" key={group.label}>
        <h3 className={`changelog-label changelog-label-${group.label.toLowerCase()}`}>{group.label}</h3>
        <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>)}
    </article>)}
  </div>;
}
