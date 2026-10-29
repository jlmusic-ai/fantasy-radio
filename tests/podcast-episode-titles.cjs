const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  new Function('require', 'module', 'exports', js)(name => mocks[name] || require(name), mod, mod.exports);
  return mod.exports;
}
const podcast = load('lib/podcast-feed.ts');
const item = (title, date, type = 'full') => `<item><title>${title}</title><pubDate>${date}</pubDate><itunes:episodeType>${type}</itunes:episodeType></item>`;
const rss = (...items) => `<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><title>Mikey and Bob</title>${items.join('')}</channel></rss>`;
assert.equal(podcast.episodeTitleForDate(rss(item('Tuesday &amp; Bob &#39;26', 'Tue, 03 Nov 2026 16:00:00 GMT')), '2026-11-03'), "Tuesday & Bob '26");
assert.equal(podcast.episodeTitleForDate(rss(item('<![CDATA[Breakfast & Bob]]>', 'Wed, 04 Nov 2026 00:30:00 GMT')), '2026-11-03'), 'Breakfast & Bob');
assert.equal(podcast.episodeTitleForDate(rss(item('DST boundary', 'Mon, 02 Nov 2026 04:30:00 GMT')), '2026-11-01'), 'DST boundary');
assert.equal(podcast.episodeTitleForDate(rss(item('Other day', 'Wed, 04 Nov 2026 17:00:00 GMT')), '2026-11-03'), null);
assert.equal(podcast.episodeTitleForDate(rss(item('Trailer', 'Tue, 03 Nov 2026 17:00:00 GMT', 'trailer')), '2026-11-03'), null);
assert.equal(podcast.episodeTitleForDate(rss(item('Same title', 'Tue, 03 Nov 2026 17:00:00 GMT'),item('Same title', 'Tue, 03 Nov 2026 18:00:00 GMT')), '2026-11-03'), 'Same title');
assert.equal(podcast.episodeTitleForDate(rss(item('First', 'Tue, 03 Nov 2026 17:00:00 GMT'),item('Second', 'Tue, 03 Nov 2026 18:00:00 GMT')), '2026-11-03'), null);
assert.equal(podcast.episodeTitleForDate(rss(item('Unknown date', 'bad date')), '2026-11-03'), null);
assert.throws(() => podcast.episodeTitleForDate('<rss>', '2026-11-03'));
assert.throws(() => podcast.episodeTitleForDate('<!DOCTYPE rss [<!ENTITY x "oops">]><rss/>', '2026-11-03'));
assert.equal(podcast.isShowDate('2026-02-30'), false);
assert.equal(podcast.isShowDate('2026-11-03'), true);

const realFetch = global.fetch;
(async () => {
  global.fetch = async () => new Response(rss(item('Tuesday episode', 'Tue, 03 Nov 2026 16:00:00 GMT')));
  assert.equal(await podcast.fetchEpisodeTitle('2026-11-03'), 'Tuesday episode');
  global.fetch = async () => new Response('Unavailable', { status: 503 });
  await assert.rejects(podcast.fetchEpisodeTitle('2026-11-03'));
  global.fetch = realFetch;

  // Server endpoint: authorize before lookup, use selected date, and tolerate RSS failure.
  const showDate = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let allowed = true, finalized = false, failFeed = false, requestedDate, saved;
  const db = { from() {const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{scores_finalized_at:finalized?'final':null},error:null})};return q;},
    rpc:async(name,args)=>{saved={name,args};return {error:null};} };
  const route = load('app/api/commissioner/daily-scoring/route.ts', {
    '../../../../lib/server': {commissioner:async()=>({db,allowed})},
    '../../../../lib/game': {weekStart:()=>showDate},
    '../../../../lib/podcast-feed': {isShowDate:podcast.isShowDate,fetchEpisodeTitle:async(date)=>{requestedDate=date;if(failFeed)throw Error('Unavailable');return 'Selected episode';}},
  });
  const req = body => new Request('https://mooberball.com/api/commissioner/daily-scoring', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let response = await route.POST(req({scoringDate:showDate,note:'Catch-up'}));
  assert.equal(response.status,200);assert.equal(requestedDate,showDate);
  assert.equal(saved.name,'complete_show_with_episode');assert.equal(saved.args.p_episode_title,'Selected episode');
  failFeed=true;response=await route.POST(req({scoringDate:showDate,note:''}));
  assert.equal(response.status,200);assert.equal(saved.args.p_episode_title,null);
  allowed=false;saved=null;requestedDate=null;
  assert.equal((await route.POST(req({scoringDate:showDate,note:''}))).status,403);
  assert.equal(saved,null);assert.equal(requestedDate,null);
  allowed=true;finalized=true;
  assert.equal((await route.POST(req({scoringDate:showDate,note:''}))).status,400);
  assert.equal(saved,null);
  assert.equal((await route.POST(req({scoringDate:'2026-02-30',note:''}))).status,400);

  // Render real ScoringLog markup with completed-day fixtures.
  let stateIndex=0;
  const states=['2026-11-02',[
    {scoring_date:'2026-11-03',week_id:'2026-11-02',commissioner_note:'',podcast_episode_title:'Tuesday <script>alert(1)</script>'},
    {scoring_date:'2026-11-04',week_id:'2026-11-02',commissioner_note:'',podcast_episode_title:null},
  ],[],false,''];
  const ScoringLog=load('app/scoring-log.tsx',{
    react:{...React,useMemo:()=>db,useEffect:()=>{},useState:()=>[states[stateIndex++],()=>{}]},
    '../lib/supabase':{browserClient:()=>db},'../lib/game':{formatDate:d=>d},
  }).default;
  const html=renderToStaticMarkup(React.createElement(ScoringLog,{currentWeek:'2026-11-02'}));
  assert.match(html,/2026-11-03<span class="scoring-episode-title"> · Tuesday &lt;script&gt;/);
  assert.match(html,/<h3>2026-11-04<\/h3>/);
  assert(!html.includes('<script>'));
  console.log('PASS: RSS dates/DST, XML decoding, duplicates/ambiguity, feed failures, authorization, selected-date completion, and scoring-log titles.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{global.fetch=realFetch;});
