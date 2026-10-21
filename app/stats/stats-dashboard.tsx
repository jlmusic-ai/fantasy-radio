"use client";

import { useMemo, useState } from "react";
import { FIRST_SEASON_END, FIRST_SEASON_START, formatDate } from "../../lib/game";

export type StatsWeek = {
  week: string;
  players: number;
  totalPoints: number;
  averageScore: number;
  topScore: number;
  occurrences: number;
  scoredDays: number;
  topics: { id: string; name: string; count: number; birthday: boolean }[];
};
export type TopicTrend = {
  id: string;
  name: string;
  birthday: boolean;
  total: number;
  weeks: Record<string, number>;
};

export default function StatsDashboard({ weeks, topics, uniquePlayers }: {
  weeks: StatsWeek[]; topics: TopicTrend[]; uniquePlayers: number;
}) {
  const [topicSort, setTopicSort] = useState<"total" | "name" | "weeks">("total");
  const [archiveSort, setArchiveSort] = useState<"newest" | "oldest" | "average" | "activity">("newest");
  const sortedTopics = useMemo(() => [...topics].sort((a, b) => topicSort === "name"
    ? a.name.localeCompare(b.name)
    : topicSort === "weeks"
      ? Object.keys(b.weeks).length - Object.keys(a.weeks).length || b.total - a.total
      : b.total - a.total || a.name.localeCompare(b.name)), [topics, topicSort]);
  const sortedWeeks = useMemo(() => [...weeks].sort((a, b) => archiveSort === "oldest"
    ? a.week.localeCompare(b.week)
    : archiveSort === "average"
      ? b.averageScore - a.averageScore || b.week.localeCompare(a.week)
      : archiveSort === "activity"
        ? b.occurrences - a.occurrences || b.week.localeCompare(a.week)
        : b.week.localeCompare(a.week)), [weeks, archiveSort]);
  const totalOccurrences = weeks.reduce((sum, week) => sum + week.occurrences, 0);
  const totalPlayerWeeks = weeks.reduce((sum, week) => sum + week.players, 0);
  const totalPoints = weeks.reduce((sum, week) => sum + week.totalPoints, 0);
  const averageScore = totalPlayerWeeks ? Math.round(totalPoints / totalPlayerWeeks * 10) / 10 : 0;
  const maxAverage = Math.max(1, ...weeks.map((week) => week.averageScore));
  const maxOccurrences = Math.max(1, ...weeks.map((week) => week.occurrences));
  const maxTopic = Math.max(1, ...topics.map((topic) => topic.total));

  return <div className="stats-page">
    <div className="stats-intro">
      <span className="eyebrow">Mooberball by the numbers</span>
      <h1>Stats</h1>
      <p className="muted">Season 1 · {formatDate(FIRST_SEASON_START)} through {formatDate(FIRST_SEASON_END)}</p>
      <p className="muted">Only finalized weeks are included. Today's scores join these stats after the week is finalized.</p>
    </div>

    <div className="stats-summary" aria-label="Season summary">
      <div className="panel stats-kpi"><span>Weeks completed</span><strong>{weeks.length}</strong></div>
      <div className="panel stats-kpi"><span>Players so far</span><strong>{uniquePlayers}</strong></div>
      <div className="panel stats-kpi"><span>Things scored</span><strong>{totalOccurrences}</strong></div>
      <div className="panel stats-kpi"><span>Average weekly score</span><strong>{averageScore}</strong></div>
    </div>

    {!weeks.length ? <div className="panel"><h2>The archive is warming up</h2>
      <p>Charts and past weeks will appear here after the first official week is finalized.</p>
    </div> : <>
      <div className="stats-charts">
        <section className="panel" aria-labelledby="stats-score-chart">
          <h2 id="stats-score-chart">Average score by week</h2>
          <p className="muted">Average among players who submitted picks that week.</p>
          <div className="stats-chart" role="list">
            {weeks.map((week) => <div className="stats-chart-row" role="listitem" key={week.week}>
              <span>{formatDate(week.week)}</span>
              <div className="stats-chart-track"><div className="stats-chart-fill" style={{ width: `${week.averageScore / maxAverage * 100}%` }} /></div>
              <strong>{week.averageScore}</strong>
            </div>)}
          </div>
        </section>
        <section className="panel" aria-labelledby="stats-activity-chart">
          <h2 id="stats-activity-chart">Things scored by week</h2>
          <p className="muted">How many lineup occurrences were recorded.</p>
          <div className="stats-chart" role="list">
            {weeks.map((week) => <div className="stats-chart-row" role="listitem" key={week.week}>
              <span>{formatDate(week.week)}</span>
              <div className="stats-chart-track"><div className="stats-chart-fill stats-chart-fill-blue" style={{ width: `${week.occurrences / maxOccurrences * 100}%` }} /></div>
              <strong>{week.occurrences}</strong>
            </div>)}
          </div>
        </section>
      </div>

      <section className="panel" aria-labelledby="stats-topics">
        <div className="stats-section-heading">
          <div><h2 id="stats-topics">Topic trends</h2><p className="muted">Only topics that were scored in finalized weeks appear here.</p></div>
          <label>Sort topics
            <select value={topicSort} onChange={(event) => setTopicSort(event.target.value as typeof topicSort)}>
              <option value="total">Most occurrences</option><option value="weeks">Most weeks scored</option><option value="name">Topic name</option>
            </select>
          </label>
        </div>
        <div className="stats-topic-list">
          {sortedTopics.map((topic) => <div className="stats-topic-row" key={topic.id}>
            <div className="stats-topic-name"><strong>{topic.name}</strong>{topic.birthday && <span className="stats-bonus-label">Birthday bonus</span>}
              <span className="muted">{Object.keys(topic.weeks).length} {Object.keys(topic.weeks).length === 1 ? "week" : "weeks"} scored</span></div>
            <div className="stats-topic-track" aria-hidden="true"><div style={{ width: `${topic.total / maxTopic * 100}%` }} /></div>
            <strong className="stats-topic-count">{topic.total} <span className="muted">occurrences</span></strong>
          </div>)}
        </div>
      </section>

      <section className="panel" aria-labelledby="stats-archive">
        <div className="stats-section-heading">
          <div><h2 id="stats-archive">Completed weeks</h2><p className="muted">Open a week to see exactly what was scored.</p></div>
          <label>Sort weeks
            <select value={archiveSort} onChange={(event) => setArchiveSort(event.target.value as typeof archiveSort)}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
              <option value="average">Highest average score</option><option value="activity">Most occurrences</option>
            </select>
          </label>
        </div>
        <div className="stats-archive">
          {sortedWeeks.map((week) => <details key={week.week} className="stats-week">
            <summary><strong>Week of {formatDate(week.week)}</strong>
              <span>{week.players} active {week.players === 1 ? "player" : "players"}</span>
              <span>{week.occurrences} occurrences</span>
              <span>Avg {week.averageScore} pts</span></summary>
            <div className="stats-week-details">
              <p className="muted">Top score: {week.topScore} pts · Total points awarded: {week.totalPoints} · {week.scoredDays} scored {week.scoredDays === 1 ? "day" : "days"}</p>
              {week.topics.length ? <ul>{week.topics.map((topic) => <li key={topic.id}><span>{topic.name}{topic.birthday && <em> · birthday bonus</em>}</span><strong>{topic.count}</strong></li>)}</ul>
                : <p>No occurrences were recorded this week.</p>}
            </div>
          </details>)}
        </div>
      </section>
    </>}
  </div>;
}
