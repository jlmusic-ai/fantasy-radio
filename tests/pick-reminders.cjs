// Run the real reminder handler with mocked database/mail HTTP; sends no emails.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const NativeDate = Date;
const nativeFetch = global.fetch;
const envKeys = ['CRON_SECRET','RESEND_API_KEY','SUPABASE_SECRET_KEY','REMINDER_FROM_EMAIL','NEXT_PUBLIC_SUPABASE_URL'];
const savedEnv = Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
Object.assign(process.env,{CRON_SECRET:'unit-cron',RESEND_API_KEY:'unit-mail',SUPABASE_SECRET_KEY:'unit-db',REMINDER_FROM_EMAIL:'game@example.test',NEXT_PUBLIC_SUPABASE_URL:'https://database.example.test'});
let scenario;
const moduleObject = {exports:{}};
const code=ts.transpileModule(fs.readFileSync('app/api/cron/pick-reminders/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
new Function('require','module','exports',code)(name=>name.endsWith('/email-unsubscribe')?{
  optedOutUsers:async()=>new Set(scenario.optedOut||[]),unsubscribeFooter:()=>'',unsubscribeHeaders:()=>({}),unsubscribeUrl:id=>'https://example.test/unsubscribe/'+id,
}:require(name),moduleObject,moduleObject.exports);
const player=(id,extra={})=>({id,email:id+'@example.test',email_confirmed_at:'confirmed',...extra});
function idsFrom(url){return (url.searchParams.get('user_id')||'').replace(/^in\.\(|\)$/g,'').split(',').filter(Boolean)}
async function run(options={}){
 scenario={users:[player('submitted'),player('hidden-test'),player('missing'),player('late-submit'),player('unsubscribed'),player('unconfirmed',{email_confirmed_at:null}),player('orphan')],visible:['submitted','missing','late-submit','unsubscribed','unconfirmed'],complete:['submitted'],newlyComplete:['late-submit'],optedOut:['unsubscribed'],...options};
 const sends=[],claimed=[],released=[],patched=[],requestedWeeks=[],pages=[];
 const instant=scenario.instant||'2026-11-01T18:15:00Z';
 global.Date=class extends NativeDate {constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant)}};
 global.fetch=async(raw,init={})=>{
   const url=new URL(raw);let data;
   if(url.hostname==='api.resend.com'){sends.push(...JSON.parse(init.body));return Response.json({data:[]},{status:scenario.mailFail?503:200});}
   if(url.pathname==='/auth/v1/admin/users'){
     const offset=(Number(url.searchParams.get('page'))-1)*100;data={users:scenario.users.slice(offset,offset+100)};
   } else if(url.pathname==='/rest/v1/profiles'){
     if(scenario.profileFail)return Response.json({error:'Unavailable'},{status:503});
     const offset=Number(url.searchParams.get('offset'));pages.push(['profiles',offset]);data=scenario.visible.slice(offset,offset+1000).map(id=>({id}));
   } else if(url.pathname==='/rest/v1/weekly_lineup_status'){
     const final=url.searchParams.has('user_id');requestedWeeks.push(url.searchParams.get('week_id'));
     if((!final&&scenario.initialFail)||(final&&scenario.finalFail))return Response.json({error:'Unavailable'},{status:503});
     if(final&&scenario.finalThrows)throw Error('Network');
     const complete=final?[...scenario.complete,...scenario.newlyComplete]:scenario.complete;
     const filtered=final?complete.filter(id=>idsFrom(url).includes(id)):complete;
     const offset=Number(url.searchParams.get('offset'));pages.push(['status',offset]);data=filtered.slice(offset,offset+1000).map(user_id=>({user_id}));
   } else if(url.pathname==='/rest/v1/pick_reminder_sends'){
     if(init.method==='POST'){
       const rows=JSON.parse(init.body).filter(row=>!(scenario.alreadySent||[]).includes(row.user_id));claimed.push(...rows);data=rows;
     }else if(init.method==='DELETE'){released.push(...idsFrom(url));data=[];}
     else if(init.method==='PATCH'){patched.push(...idsFrom(url));data=[];}
   }else throw Error('Unexpected URL '+url.pathname);
   return Response.json(data);
 };
 const result=await moduleObject.exports.GET(new Request('https://example.test/api/cron/pick-reminders',{headers:{authorization:'Bearer unit-cron'}}));
 return {http:result.status,body:await result.json(),sends,claimed,released,patched,requestedWeeks,pages};
}
(async()=>{
 let r=await run();assert.equal(r.http,200);assert.deepEqual(r.sends.map(x=>x.to[0]),['missing@example.test']);
 assert(!r.claimed.some(x=>['submitted','hidden-test','unsubscribed','unconfirmed','orphan'].includes(x.user_id)));
 assert(r.released.includes('late-submit'));assert.equal(r.body.skippedSubmitted,1);assert.deepEqual(r.patched,['missing']);
 assert(r.requestedWeeks.every(x=>x==='eq.2026-11-02'));
 r=await run({complete:[],newlyComplete:[]});assert(r.sends.some(x=>x.to[0]==='submitted@example.test'),'Previous-week picks must not count as this week');
 r=await run({initialFail:true});assert.equal(r.http,502);assert.equal(r.sends.length,0);assert.equal(r.claimed.length,0);
 r=await run({profileFail:true});assert.equal(r.http,502);assert.equal(r.sends.length,0);
 for(const mode of ['finalFail','finalThrows']){r=await run({[mode]:true});assert.equal(r.sends.length,0);assert(r.released.includes('missing'));assert.equal(r.body.success,false);}
 r=await run({alreadySent:['missing','late-submit']});assert.equal(r.sends.length,0);
 r=await run({mailFail:true});assert(r.released.includes('missing'));assert.equal(r.body.sent,0);
 const many=Array.from({length:205},(_,i)=>'user'+i);
 r=await run({users:many.map(id=>player(id)),visible:many,complete:[],newlyComplete:['user100','user204'],optedOut:[]});
 assert.equal(r.sends.length,203);assert.equal(r.body.skippedSubmitted,2);
 assert(!r.sends.some(x=>['user100@example.test','user204@example.test'].includes(x.to[0])));
 const completed=Array.from({length:1001},(_,i)=>'done'+i);
 r=await run({users:[player('done1000')],visible:completed,complete:completed,newlyComplete:[],optedOut:[]});
 assert.equal(r.sends.length,0);assert(r.pages.some(x=>x[0]==='status'&&x[1]===1000));assert(r.pages.some(x=>x[0]==='profiles'&&x[1]===1000));
 r=await run({instant:'2026-10-25T17:15:00Z'});assert(r.requestedWeeks.every(x=>x==='eq.2026-10-26'));
 r=await run({instant:'2026-11-01T17:15:00Z'});assert.equal(r.body.skipped,true);assert.equal(r.sends.length,0);
 console.log('PASS: submitted/hidden/opted-out accounts excluded, pre-send recheck, fail-closed errors, duplicate protection, pagination, batching, and DST target week. No real emails sent.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{global.Date=NativeDate;global.fetch=nativeFetch;for(const key of envKeys){if(savedEnv[key]===undefined)delete process.env[key];else process.env[key]=savedEnv[key];}});
