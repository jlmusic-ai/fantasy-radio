const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const mod = { exports: {} };
const js = ts.transpileModule(fs.readFileSync('lib/leaderboards.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
const { buildLeaderboard, loadSeasonParticipants } = mod.exports;
const profiles = ['never', 'zero', 'new', 'winner', 'draft'].map(id => ({ id, username: id, avatar_url: null, founding_member: true }));
const scores = [{ user_id: 'zero', score: 0 }, { user_id: 'winner', score: 50 }];
let rows = buildLeaderboard(scores, profiles, new Set(['new']));
assert.deepEqual(rows.map(p => [p.user_id, p.score]), [['winner', 50], ['new', 0], ['zero', 0]]);
assert(rows.every(p => p.founding_member));
rows = buildLeaderboard(scores, profiles, new Set(['new', 'never']));
assert(rows.some(p => p.user_id === 'never' && p.score === 0));
assert(!rows.some(p => p.user_id === 'draft'));
assert.deepEqual(buildLeaderboard([], profiles, new Set()), []);
(async () => {
  const pages = [], filters = [];
  const data = Array.from({ length: 1501 }, (_, n) => ({ user_id: `p${n}`, week_id: '2026-11-09' }));
  const db = { from(table) {
    assert.equal(table, 'weekly_lineup_status');
    const q = { select: () => q, eq: (...a) => (filters.push(a), q), gte: (...a) => (filters.push(a), q), lte: (...a) => (filters.push(a), q), order: () => q,
      range: (lo, hi) => { pages.push([lo, hi]); return Promise.resolve({ data: data.slice(lo, hi + 1), error: null }); } };
    return q;
  } };
  const users = await loadSeasonParticipants(db, '2026-10-05', '2026-11-20');
  assert.equal(users.size, 1501);
  assert(users.has('p1500'));
  assert.deepEqual(pages, [[0,999], [1000,1999]]);
  assert(filters.some(a => a[0] === 'allocated_points' && a[1] === 100));
  assert(filters.some(a => a[0] === 'week_id' && a[1] === '2026-10-05'));
  console.log('Leaderboard eligibility and pagination checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
