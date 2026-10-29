"use client";

import { Fragment, useState } from "react";

export type RivalryPlayer = {
  id: string;
  username: string;
  avatarUrl: string | null;
  score: number;
};
type Group = { number: number; players: RivalryPlayer[] };

export default function RivalriesBoard({ groups, viewerId, finalized }: {
  groups: Group[];
  viewerId: string;
  finalized: boolean;
}) {
  const mine = groups.find((group) => group.players.some((player) => player.id === viewerId));
  const [selected, setSelected] = useState(mine?.number || groups[0].number);
  const active = groups.find((group) => group.number === selected) || groups[0];
  const top = Math.max(...active.players.map((player) => player.score));
  const leaders = active.players.filter((player) => player.score === top);

  return <div className="rivalries-layout">
    <section className="panel rivalry-feature" aria-live="polite">
      <span className="eyebrow">{mine?.number === active.number ? "Your rivalry" : `Rivalry ${active.number}`}</span>
      <h1>{active.players.length === 3 ? "Three-way rivalry" : "Head-to-head rivalry"}</h1>
      <p className="muted">{finalized ? "Final scores" : "Completed daily scores"}</p>
      <div className="rivalry-players">
        {[...active.players].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username)).map((player) =>
          <div className="rivalry-player" key={player.id}>
            <div className="rivalry-person">
              {player.avatarUrl ? <img src={player.avatarUrl} alt="" className="rivalry-avatar" />
                : <span className="rivalry-avatar rivalry-initial" aria-hidden="true">{player.username.slice(0, 1).toUpperCase()}</span>}
              <span className="rivalry-name">{player.username}{player.id === viewerId && <small> · You</small>}</span>
            </div>
            <strong className="rivalry-score">{player.score} <small>pts</small></strong>
          </div>)}
      </div>
      <p className="rivalry-result">{leaders.length > 1
        ? finalized ? "It's a tie!" : "Currently tied"
        : finalized ? `${leaders[0].username} wins!` : `${leaders[0].username} is in the lead`}</p>
    </section>
    <aside className="panel rivalry-directory">
      <h2>All rivalries</h2>
      <p className="muted">{groups.length} matchups · Select one to see the scores</p>
      <div className="rivalry-list" aria-label="Browse rivalries">
        {groups.map((group) => <button type="button" key={group.number}
          className={`rivalry-list-item ${group.number === active.number ? "selected" : ""}`}
          aria-pressed={group.number === active.number}
          onClick={() => setSelected(group.number)}>
          <span>#{group.number}{mine?.number === group.number && <small> · Yours</small>}</span>
          <span>{group.players.map((player, index) => {
            const winner = finalized && group.players.length > 1 && group.players.every(
              (opponent) => opponent.id === player.id || player.score > opponent.score,
            );
            return <Fragment key={player.id}>
              {index > 0 && " · "}
              {winner
                ? <strong style={{ color: "#82e3a2" }} title="Rivalry winner">{player.username}</strong>
                : player.username}
            </Fragment>;
          })}</span>
        </button>)}
      </div>
    </aside>
  </div>;
}
