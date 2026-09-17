export default function RulesContent() {
  return (
    <>
      <section className="rules-hero">
        <p className="eyebrow">Welcome to</p>
        <h1>Mooberball</h1>
        <p className="rules-intro">
          Mooberball is a fan-made fantasy game built around the wonderfully
          unpredictable world of the Mikey and Bob show. Make your predictions,
          listen for the moments you picked, and see how your lineup stacks up
          against the rest of the league.
        </p>
        <div className="rules-actions">
          <a className="button" href="/signup">
            Sign up to play
          </a>
          <a className="button secondary-button" href="/login">
            Log in
          </a>
        </div>
      </section>

      <section className="panel rules-panel">
        <h2>How to play</h2>
        <ol className="rules-list">
          <li>
            <strong>Build one lineup each week.</strong>
            <span>
              Choose how confident you are in each weekly topic by assigning
              points to it.
            </span>
          </li>
          <li>
            <strong>Allocate exactly 100 points.</strong>
            <span>
              Your regular lineup must total exactly 100 points, with no more
              than 25 points assigned to any single topic.
            </span>
          </li>
          <li>
            <strong>Submit before the weekly deadline.</strong>
            <span>
              Picks for the following week open automatically every Friday at
              5:00 p.m. Eastern Time and lock Monday at 6:00 a.m. Eastern Time.
              You may update your lineup any time before it locks.
            </span>
          </li>
          <li>
            <strong>Earn points for every verified occurrence.</strong>
            <span>
              The points assigned to a topic are multiplied by the number of
              times that event occurs during the week. For example, a 20-point
              pick occurring three times earns 60 points.
            </span>
          </li>
          <li>
            <strong>Make your Bob&apos;s Birthday Wishes prediction.</strong>
            <span>
              Guess how many times Bob will be wished a happy birthday that
              week. An exact guess earns 50 bonus points. Each number away from
              the correct total subtracts five points, down to a minimum of
              zero. This prediction does not use any of your 100 lineup points.
            </span>
          </li>
          <li>
            <strong>Follow the verified scoring log.</strong>
            <span>
              The commissioner records qualifying moments and their occurrence
              counts. Scores update automatically, and the scoring log shows
              what has been counted.
            </span>
          </li>
          <li>
            <strong>Climb the standings.</strong>
            <span>
              Weekly standings rank that week&apos;s scores. Season standings
              combine each player&apos;s points across the full season.
            </span>
          </li>
        </ol>
      </section>

      <section className="panel season-callout">
        <p className="eyebrow">Inaugural season</p>
        <h2>10-01-2026 through 11-27-2026</h2>
        <p className="muted">
          The first Mooberball season will run for eight weeks. Join before the
          opening week so you do not miss your first chance to score.
        </p>
      </section>
    </>
  );
}
