// Exercise the commissioner component with Election Week dates and a fake database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const hooks = [];
let cursor = 0, dirty = true, tree;
const effects = [];
const rpcCalls = [];
const events = [
  { category_id: 'topic', quantity: 5, occurred_at: '2026-11-02T17:00:00Z' },
  { category_id: 'topic', quantity: 2, occurred_at: '2026-11-03T17:00:00Z' },
  { category_id: 'topic', quantity: 7, occurred_at: '2026-11-04T17:00:00Z' },
];
const status = new Map();
const db = {
  auth: { getUser: async () => ({ data: { user: { id: 'commissioner' } } }) },
  from(table) {
    const filters = {};
    const query = {
      select() { return query; }, eq(key, value) { filters[key] = value; return query; },
      order() { return query; }, single() { return query; }, maybeSingle() { return query; },
      then(resolve) {
        const data = {
          profiles: { is_commissioner: true },
          categories: [{ id: 'topic', name: 'Topic', display_order: 1, scoring_type: 'allocation' }],
          events,
          finalized_weeks: null,
          daily_scoring_status: status.get(filters.scoring_date) || null,
          weeks: { lock_at: '2026-11-02T11:00:00Z' },
        }[table];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return query;
  },
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'adjust_show_occurrences') {
      const event = events.find(e => e.occurred_at.startsWith(args.p_scoring_date));
      event.quantity = args.p_target ?? Math.max(0, event.quantity + args.p_delta);
      return { data: event.quantity, error: null };
    }
    if (name === 'save_show_scoring_note') status.set(args.p_scoring_date, {
      commissioner_note: args.p_note, completed_at: '2026-11-04T17:00:00Z',
    });
    if (name === 'set_show_scoring_complete') status.delete(args.p_scoring_date);
    return { error: null };
  },
};
const fakeReact = {
  ...React,
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; dirty = true; }];
  },
  useRef(initial) { const index = cursor++; return hooks[index] ||= { current: initial }; },
  useEffect(effect, deps) {
    const index = cursor++;
    const old = hooks[index];
    if (!old || deps.some((value, i) => value !== old.deps[i])) {
      old?.cleanup?.();
      hooks[index] = { deps };
      effects.push(() => { hooks[index].cleanup = effect(); });
    }
  },
};
const originalNow = Date.now;
Date.now = () => new Date('2026-11-04T17:00:00Z').getTime();
global.window = { setInterval: () => 1, clearInterval() {}, confirm: () => true };
const game = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync('lib/game.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(require, game, game.exports);
const mod = { exports: {} };
const req = name => name === 'react' ? fakeReact : name.endsWith('/supabase') ? { browserClient: () => db }
  : name.endsWith('/game') ? game.exports : require(name);
new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync('app/commissioner/score/page.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText)(req, mod, mod.exports);
async function settle() {
  for (let i = 0; i < 30; i++) {
    if (dirty) { dirty = false; cursor = 0; tree = mod.exports.default(); }
    while (effects.length) effects.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }
}
function find(predicate, node = tree) {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const result = find(predicate, child); if (result) return result;
  }
  return null;
}
const input = () => find(n => n.type === 'input' && n.props.type === 'number');
const dateInput = () => find(n => n.props?.id === 'scoring-show-date');
(async () => {
  await settle();
  assert.equal(dateInput().props.value, '2026-11-04');
  assert.equal(dateInput().props.min, '2026-11-02');
  assert.equal(dateInput().props.max, '2026-11-04');
  assert.equal(input().props.value, '7', 'Default date must load Wednesday counts');
  dateInput().props.onChange({ target: { value: '2026-11-03' } });
  await settle();
  assert.equal(input().props.value, '2', 'Election Day must load its own saved counts');
  assert.match(input().props['aria-label'], /11-03-2026/);
  await find(n => n.type === 'button' && n.props['aria-label'] === 'Add one to Topic').props.onClick();
  await settle();
  assert.equal(input().props.value, '3');
  assert.equal(rpcCalls.at(-1).args.p_scoring_date, '2026-11-03');
  const complete = find(n => n.type === 'button' && n.props.children === 'Mark this show’s scoring complete');
  await complete.props.onClick(); await settle();
  assert.equal(rpcCalls.at(-1).name, 'save_show_scoring_note');
  assert.equal(rpcCalls.at(-1).args.p_scoring_date, '2026-11-03');
  assert.equal(input().props.disabled, true, 'Completed selected show must lock');
  dateInput().props.onChange({ target: { value: '2026-11-04' } });
  await settle();
  assert.equal(input().props.value, '7', 'Wednesday counts must remain unchanged');
  assert.equal(input().props.disabled, false, 'Tuesday completion must not complete Wednesday');
  dateInput().props.onChange({ target: { value: '2026-11-05' } }); await settle();
  assert.equal(dateInput().props.value, '2026-11-04', 'Future dates must be rejected');
  dateInput().props.onChange({ target: { value: '2026-10-30' } }); await settle();
  assert.equal(dateInput().props.value, '2026-11-04', 'Previous-week dates must be rejected');
  console.log('PASS: Wednesday catch-up for Election Day, separate counts/completion, date bounds, and selected-date RPCs.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { Date.now = originalNow; });
