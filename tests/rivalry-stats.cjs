const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
function load(path,mocks={}) {
  const mod={exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require','module','exports',js)(name=>mocks[name]||require(name),mod,mod.exports);
  return mod.exports;
}
const {calculateRivalryStats,loadRivalryStats}=load('lib/rivalry-stats.ts');
const assignments=[],snapshots=[];
function match(week,number,players){for(const [user,score] of players){assignments.push({week_id:week,rivalry_number:number,user_id:user});if(score!==null)snapshots.push({week_id:week,user_id:user,score});}}
match('2026-10-26',1,[['a',100],['b',80]]);
match('2026-11-02',1,[['a',90],['b',90],['c',10]]);
match('2026-11-09',1,[['a',120],['b',60],['c',110]]);
match('2026-11-16',1,[['a',140],['b',150]]);
match('2026-11-23',1,[['a',900],['b',10]]); // Unfinished: no win yet.
match('2026-11-09',2,[['d',0],['e',0]]);
match('2026-11-09',3,[['missing',100],['incomplete',null]]);
match('2026-11-09',4,[['solo',100]]);
const final=['2026-10-26','2026-11-02','2026-11-09','2026-11-16'];
const stats=calculateRivalryStats([...assignments].reverse(),snapshots,final);
const a=stats.find(x=>x.userId==='a'), b=stats.find(x=>x.userId==='b'),c=stats.find(x=>x.userId==='c');
assert.deepEqual(a,{userId:'a',played:4,wins:2,losses:1,ties:1,winRate:50,currentStreak:0,longestStreak:1,biggestWin:20,highestScore:140});
assert.deepEqual(b,{userId:'b',played:4,wins:1,losses:2,ties:1,winRate:25,currentStreak:1,longestStreak:1,biggestWin:10,highestScore:150});
assert.equal(c.losses,2);assert.equal(c.ties,0); // A third-place finisher loses when the leaders tie.
assert.equal(stats.find(x=>x.userId==='d').ties,1);assert.equal(stats.find(x=>x.userId==='d').biggestWin,null);
assert(!stats.some(x=>['missing','incomplete','solo'].includes(x.userId)));
assert.equal(calculateRivalryStats(assignments,snapshots,[]).length,0);
const winStreak=calculateRivalryStats(
 ['2026-10-26','2026-11-02','2026-11-09'].flatMap(week=>[{week_id:week,rivalry_number:1,user_id:'a'},{week_id:week,rivalry_number:1,user_id:'b'}]),
 ['2026-10-26','2026-11-02','2026-11-09'].flatMap(week=>[{week_id:week,user_id:'a',score:10},{week_id:week,user_id:'b',score:5}]),
 ['2026-10-26','2026-11-02','2026-11-09'],
).find(x=>x.userId==='a');
assert.equal(winStreak.currentStreak,3);assert.equal(winStreak.longestStreak,3);

(async()=>{
  const manyAssignments=[],manySnapshots=[],ranges=[];
  for(let n=0;n<2002;n++){manyAssignments.push({week_id:'2026-10-26',rivalry_number:Math.floor(n/2)+1,user_id:String(n)});manySnapshots.push({week_id:'2026-10-26',user_id:String(n),score:n%2});}
  let fail=false;
  const db={from(table){let lo=0,hi=Infinity;const q={select:()=>q,gte:()=>q,lte:()=>q,not:()=>q,in:()=>q,order:()=>q,range(a,b){lo=a;hi=b;ranges.push([table,a,b]);return q;},then(resolve){return Promise.resolve({data:table==='finalized_weeks'?[{week_id:'2026-10-26'}]:(table==='weekly_rivalries'?manyAssignments:manySnapshots).slice(lo,hi+1),error:fail&&table==='weekly_score_snapshots'?{message:'Unavailable'}:null}).then(resolve)}};return q}};
  const many=await loadRivalryStats(db,'2026-10-05','2026-11-20');
  assert.equal(many.length,2002);assert.equal(many.reduce((sum,s)=>sum+s.wins,0),1001);assert.equal(ranges.length,6);
  fail=true;await assert.rejects(loadRivalryStats(db,'2026-10-05','2026-11-20'));

  const game=load('lib/game.ts');
  const Component=load('app/rivalries/rivalry-statistics.tsx',{'../../lib/game':game}).default;
  const records=stats.map(row=>({...row,username:'Player '+row.userId}));
  let html=renderToStaticMarkup(React.createElement(Component,{records,viewerId:'a',error:false}));
  assert.match(html,/2W · 1L · 1T/);assert.match(html,/50%/);assert.match(html,/20 pts/);assert.match(html,/Player a leads with 2 wins/);
  html=renderToStaticMarkup(React.createElement(Component,{records:[],viewerId:'new',error:false}));
  assert.match(html,/record starts with your first completed rivalry/);assert.match(html,/leaderboard starts after the first rivalry week/);assert(!html.includes('NaN'));
  html=renderToStaticMarkup(React.createElement(Component,{records,viewerId:'a',error:true}));assert.match(html,/couldn’t be loaded/);
  const tied=Array.from({length:12},(_,i)=>({...a,userId:String(i),username:'Player '+String(i).padStart(2,'0'),wins:2}));
  html=renderToStaticMarkup(React.createElement(Component,{records:tied,viewerId:'11',error:false}));
  assert.match(html,/12 players share the lead with 2 wins each/);assert.match(html,/Ranked by outright rivalry wins/);assert.match(html,/Player 11/);
  assert.equal((html.match(/<td>#1<\/td>/g)||[]).length,12);
  console.log('PASS: finalized wins/losses/ties, three-player results, zero ties, missing opponents, win streaks/margins, 2,002-player pagination, and stats markup.');
})().catch(e=>{console.error(e);process.exitCode=1});
