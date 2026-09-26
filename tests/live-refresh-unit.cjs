const vm=require('node:vm');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
(async()=>{
 const events={},elements={},timers=[];
 let payload=JSON.parse(fs.readFileSync(path.join(root,'top3-live.json'))),failure=false,requests=0,rendered=0,release;
 const original=structuredClone(payload);
 const sandbox={console,AbortController,Date,Map,Set,JSON,localStorage:{getItem:()=>null},document:{hidden:false,querySelector:s=>elements[s]??=( {} ),addEventListener:(k,f)=>events[k]=f},window:{TOP3_SEED:[],scrollX:0,scrollY:500,scrollTo:({left,top})=>{sandbox.window.scrollX=left;sandbox.window.scrollY=top},addEventListener:(k,f)=>events[k]=f},setTimeout,clearTimeout,setInterval:(f,ms)=>timers.push({f,ms}),fetch:async()=>{requests++;if(release)await new Promise(r=>release=r);if(failure)throw Error('offline');return {ok:true,json:async()=>structuredClone(payload)}}};
 const ctx=vm.createContext(sandbox),run=s=>vm.runInContext(s,ctx);
 run(fs.readFileSync(path.join(root,'app.js'),'utf8'));
 sandbox.render=()=>rendered++;
 run('renderAll=()=>render();applyFacts=()=>{}');
 await run('load()');assert.equal(rendered,1);
 run("state.tab='horizontal';state.mode='B';state.activeDigits.add(7);startLiveRefresh()");
 assert.equal(timers[0].ms,30000);
 await run('load()');assert.equal(rendered,1);
 const latest=payload.draws[0];
 payload={...payload,updatedAt:new Date(Date.parse(payload.updatedAt)+1800000).toISOString(),draws:[{...latest,id:latest.id+1,time:'10:25'},...payload.draws]};
 timers[0].f();await run('liveRequest');assert.equal(rendered,2);assert.equal(run('state.draws[0].id'),latest.id+1);
 assert.equal(run('state.tab'),'horizontal');assert.equal(run('state.mode'),'B');assert(run('state.activeDigits.has(7)'));assert.equal(sandbox.window.scrollY,500);
 failure=true;await run('load()');failure=false;
 payload={draws:[]};await run('load()');payload=original;await run('load()');assert.equal(rendered,2);assert.equal(run('state.draws[0].id'),latest.id+1);
 sandbox.document.hidden=true;const count=requests;timers[0].f();assert.equal(requests,count);
 sandbox.document.hidden=false;events.visibilitychange();await run('liveRequest');assert.equal(requests,count+1);
 release=true;events.online();events.online();assert.equal(requests,count+2);release();release=null;await run('liveRequest');
 // Initial offline load remains usable and recovers on the next poll.
 run('liveLoaded=false;state.draws=[];state.updatedAt=null');failure=true;await run('load()');failure=false;await run('load()');assert.equal(run('state.draws[0].id'),latest.id);
 console.log('PASS: 30-second scheduling, new results, unchanged no-render, view/filter preservation, offline/malformed/stale protection, hidden/resume, request deduplication, initial offline recovery.');
 const handlers={},cache=new Map();let networkFails=false;
 const sw=vm.createContext({URL,Error,Promise,self:{location:{href:'https://test.local/sw.js'},addEventListener:(k,f)=>handlers[k]=f},caches:{open:async()=>({put:async(k,v)=>cache.set(k,v)}),match:async k=>cache.get(k)},fetch:async()=>{if(networkFails)throw Error('offline');return {ok:true,clone(){return this}}}});
 vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),sw);
 for(let i=0;i<3;i++){let response;const waits=[];handlers.fetch({request:{method:'GET',url:'https://test.local/top3-live.json?t='+i},respondWith:p=>response=p,waitUntil:p=>waits.push(p)});assert((await response).ok);await Promise.all(waits)}
 assert.equal(cache.size,1);assert(cache.has('https://test.local/top3-live.json'));
 networkFails=true;let response;handlers.fetch({request:{method:'GET',url:'https://test.local/top3-live.json?t=offline'},respondWith:p=>response=p,waitUntil:()=>{}});assert((await response).ok);
 console.log('PASS: service worker retains one live cache entry and returns its last good copy offline.');
})().catch(e=>{console.error(e);process.exitCode=1});
