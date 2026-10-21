import { formatDate } from "../../lib/game";

export const metadata = {
  title: "Updates | Mooberball",
  description: "New features, improvements, and bug fixes released since Mooberball Season 1 began.",
};

type Release = {
  date: string;
  groups: { label: string; items: string[] }[];
};

// Keep newest releases first. Dates reflect releases in America/New_York.
const releases: Release[] = [
  {
    date: "2026-10-21",
    groups: [{ label: "Added", items: [
      "A new Stats page shows how the season is going: weekly score and scoring trends, topic counts, and an archive of completed weeks. Stats use finalized results, so scores in progress stay out of the archive.",
    ] }],
  },
  {
    date: "2026-10-20",
    groups: [{ label: "Fixed", items: [
      "Fixed an issue where Your Weekly Score compared your rank with everyone who signed up. It now shows your place among players who submitted a complete lineup for that week, including on the score card you can share.",
    ] }],
  },
  {
    date: "2026-10-19",
    groups: [{ label: "Fixed", items: [
      "Fixed an issue where the Play page could briefly say picks were open after they had locked. It now says “Checking lineup…” until it knows whether you can make changes.",
    ] }],
  },
  {
    date: "2026-10-18",
    groups: [{ label: "Added", items: [
      "Commissioners can now give another registered player commissioner access, or remove that access, from the Registered Users page. This lets someone else help manage the game when needed.",
    ] }],
  },
  {
    date: "2026-10-15",
    groups: [{ label: "Improved", items: [
      "The Changelog page is now called Updates, so it’s easier to find what’s new.",
      "If a week ends early, the results email now clearly says that next week’s picks open Friday at 5 p.m. Eastern time.",
      "Reminder and results emails now make it easier to unsubscribe. The link at the bottom asks you to confirm, so opening it by accident won’t unsubscribe you.",
    ] }],
  },
  {
    date: "2026-10-10",
    groups: [{ label: "Fixed", items: [
      "Fixed an issue where password reset links could fail if you opened them in an email app or a different browser. You’ll also get a clearer message if a link has expired or has already been used.",
    ] }],
  },
  {
    date: "2026-10-09",
    groups: [
      { label: "Added", items: [
        "You can now see your scores from earlier weeks, your season total, and your best week in one place.",
        "You can turn your weekly score card into an image to download or share. It shows your name, score, and weekly and season ranks. If your device offers Facebook in its share menu, you can share it there.",
        "After your first completed week, you’ll see a “New season high!” message whenever your finalized score beats your previous best. A tie won’t trigger it.",
        "When picks open, new lineup topics are marked “New this week” so you can spot them quickly.",
        "Some lineup topics, including Bob’s Birthday Wishes, can now include a short explanation of what counts. Topics without an explanation look the same as before.",
        "This Updates page shows what’s changed since Season 1 began.",
      ] },
      { label: "Improved", items: [
        "Forgot your password? The login page now has a reset link right below the password field.",
        "The weekly leaderboard shows everyone, even players with zero points. Once next week’s picks open, the badge beside each name shows whether that player has finished their picks.",
        "You can keep viewing this week’s leaderboard and player picks through Saturday night, even after next week’s picks open on Friday.",
        "“Open for picks” now appears in green so it’s easier to see when you can make your lineup.",
        "Your Weekly Score card stays on the current week through Saturday night, giving you more time to share it after next week’s picks open.",
        "Season Profiles now show how many official weeks you scored at least 200 points.",
      ] },
      { label: "Fixed", items: [
        "Fixed an issue where next week’s lineup changes could appear on the Play page before picks opened. You’ll see this week’s topics until it’s time to pick for next week.",
        "Fixed an issue where changing or removing a topic for a future week could affect how earlier picks or scores appeared. Your past results stay as they were.",
      ] },
      { label: "Removed", items: [
        "The old Share recap option has been removed. You can share an image of your own weekly score card instead.",
      ] },
    ],
  },
  {
    date: "2026-10-06",
    groups: [
      { label: "Fixed", items: [
        "Fixed an issue where a day’s points could appear on your score and the weekly leaderboard before the commissioner finished scoring that day.",
        "Fixed an issue where a week’s points could appear in season rankings before that week’s scores were final.",
        "Fixed an issue where score cards could show things that had happened that day before the commissioner finished scoring. Score cards now match the published totals.",
      ] },
      { label: "Improved", items: [
        "The Founding Member badge now has a blue gemstone icon.",
      ] },
    ],
  },
  {
    date: "2026-10-05",
    groups: [
      { label: "Added", items: [
        "Your weekly score card now shows where you stand for both the week and the season.",
        "The top three players get gold, silver, or bronze trophy icons next to their ranks.",
        "Players who were signed up when the Founding Member badge launched received it, even if they hadn’t made picks yet.",
      ] },
      { label: "Fixed", items: [
        "Fixed an issue where topic names could briefly change to “Retired option” while a player’s picks were loading.",
      ] },
    ],
  },
];

export default function UpdatesPage() {
  return <div className="changelog">
    <div className="changelog-intro">
      <span className="eyebrow">Mooberball updates</span>
      <h1>Updates</h1>
      <p className="muted">See what’s new in Mooberball since Season 1 began on 10-05-2026. The newest changes are at the top.</p>
    </div>
    {releases.map((release, index) => <article className="panel changelog-release" key={release.date} aria-label={`Updates for ${formatDate(release.date)}`}>
      <div className="changelog-release-heading">
        <time dateTime={release.date}>{formatDate(release.date)}</time>
        {index === 0 && <span className="changelog-latest">Latest update</span>}
      </div>
      {release.groups.map((group) => <section className="changelog-group" key={group.label}>
        <h3 className={`changelog-label changelog-label-${group.label.toLowerCase()}`}>{group.label}</h3>
        <ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>)}
    </article>)}
  </div>;
}
