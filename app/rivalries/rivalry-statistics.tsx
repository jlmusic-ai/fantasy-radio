import { FIRST_SEASON_START, FIRST_SEASON_END, formatDate } from "../../lib/game";
import type { RivalryStats } from "../../lib/rivalry-stats";

type PlayerRecord = RivalryStats & { username: string };
const recordText = (record: RivalryStats) => `${record.wins}W · ${record.losses}L · ${record.ties}T`;

export default function RivalryStatistics({ records, viewerId, error }: {
  records: PlayerRecord[]; viewerId: string; error: boolean;
}) {
  if (error) return <section className="panel rivalry-statistics" aria-labelledby="rivalry-stats-heading">
    <h2 id="rivalry-stats-heading">Rivalry stats</h2>
    <p role="status">Rivalry stats couldn’t be loaded. Refresh the page to try again.</p>
  </section>;
  const own = records.find((row) => row.userId === viewerId);
  const ranked = [...records].sort((a, b) => b.wins - a.wins || b.winRate - a.winRate ||
    b.played - a.played || a.username.localeCompare(b.username));
  const mostWins = ranked[0]?.wins || 0;
  const leaders = ranked.filter((row) => row.wins === mostWins);
  const ranks = new Map<number, number>();
  ranked.forEach((row, index) => { if (!ranks.has(row.wins)) ranks.set(row.wins, index + 1); });
  const cards = [
    { label: "Rivalries won", value: own?.wins ?? 0 },
    { label: "Rivalries played", value: own?.played ?? 0 },
    { label: "Win rate", value: own ? `${own.winRate}%` : "—" },
    { label: "Current win streak", value: own?.currentStreak ?? 0 },
    { label: "Longest win streak", value: own?.longestStreak ?? 0 },
    { label: "Biggest winning margin", value: own?.biggestWin != null ? `${own.biggestWin} pts` : "—" },
  ];
  return <section className="rivalry-statistics" aria-labelledby="rivalry-stats-heading">
    <div className="rivalry-stats-heading">
      <h2 id="rivalry-stats-heading">Rivalry stats</h2>
      <p className="muted">Season 1 · {formatDate(FIRST_SEASON_START)}–{formatDate(FIRST_SEASON_END)} · Finalized matchups only</p>
    </div>
    <div className="panel">
      <h3>Your rivalry record</h3>
      <p className="rivalry-record">{own ? recordText(own) : "Your record starts with your first completed rivalry."}</p>
      <dl className="rivalry-stat-cards">
        {cards.map((card) => <div className="rivalry-stat-card" key={card.label}>
          <dt>{card.label}</dt><dd>{card.value}</dd>
        </div>)}
      </dl>
      {own && <p className="muted">Your highest rivalry score: <strong>{own.highestScore} pts</strong></p>}
    </div>
    <div className="panel">
      <h3>Most rivalry wins</h3>
      {!ranked.length ? <p className="muted">The leaderboard starts after the first rivalry week is finalized.</p> : <>
        <p className="rivalry-wins-leader">{mostWins === 0 ? "No outright rivalry wins yet."
          : leaders.length === 1 ? `${leaders[0].username} leads with ${mostWins} ${mostWins === 1 ? "win" : "wins"}.`
          : `${leaders.length} players share the lead with ${mostWins} ${mostWins === 1 ? "win" : "wins"} each.`}</p>
        <div className="rivalry-stats-table-wrap" role="region" aria-label="Rivalry wins leaderboard" tabIndex={0}>
          <table className="rivalry-stats-table">
            <caption>Ranked by outright rivalry wins. Equal wins share a rank.</caption>
            <thead><tr><th scope="col">Rank</th><th scope="col">Player</th><th scope="col">Wins</th><th scope="col">Record</th><th scope="col">Win rate</th><th scope="col">Best streak</th></tr></thead>
            <tbody>{ranked.map((row) => <tr key={row.userId} className={row.userId === viewerId ? "rivalry-stats-you" : undefined}>
              <td>#{ranks.get(row.wins)}</td><th scope="row">{row.username}{row.userId === viewerId && <small> · You</small>}</th>
              <td><strong>{row.wins}</strong></td><td>{recordText(row)}</td><td>{row.winRate}%</td><td>{row.longestStreak}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </>}
    </div>
    <p className="muted rivalry-stats-note">A win means finishing alone with the highest score in your matchup. Players tied for the highest score receive a tie; other players receive a loss. Ties and losses end a winning streak. Win rate is wins divided by completed rivalries.</p>
  </section>;
}
