'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LabBranchCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const VERSION='1.7.1';

  function parseDate(s){
    const [d,m,y]=String(s).split('.').map(Number);
    return new Date(Date.UTC(y<100?2000+y:y,m-1,d));
  }
  function formatDate(dt){
    return [String(dt.getUTCDate()).padStart(2,'0'),String(dt.getUTCMonth()+1).padStart(2,'0'),String(dt.getUTCFullYear()).slice(-2)].join('.');
  }
  function addDays(s,n){
    const d=parseDate(s);d.setUTCDate(d.getUTCDate()+n);return formatDate(d);
  }
  function combo(d){return [Number(d.a),Number(d.b),Number(d.c)]}
  function key(date,time){return `${date}|${time}`}
  function overlapCount(a,b){
    const ca=Array(10).fill(0),cb=Array(10).fill(0);
    a.forEach(n=>ca[n]++);b.forEach(n=>cb[n]++);
    return ca.reduce((s,n,i)=>s+Math.min(n,cb[i]),0);
  }
  function matchedDigits(a,b){
    const cb=Array(10).fill(0),out=[];b.forEach(n=>cb[n]++);
    a.forEach(n=>{if(cb[n]>0){out.push(n);cb[n]--}});return out;
  }
  function buildMap(draws){const m=new Map();draws.forEach(d=>m.set(key(d.date,d.time),d));return m}
  function normalizeTimes(times){return [...new Set((times||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}
  function inferTimes(draws,targetDate){
    const dates=[];if(targetDate)dates.push(targetDate);
    for(const d of draws||[]){if(!dates.includes(d.date))dates.push(d.date);if(dates.length>=5)break}
    const score=new Map();
    for(const date of dates){
      const t=[...new Set((draws||[]).filter(x=>x.date===date).map(x=>x.time))].sort();
      const sig=t.join(',');if(t.length)score.set(sig,(score.get(sig)||0)+1);
    }
    let best='',n=-1;for(const [sig,c] of score){const len=sig?sig.split(',').length:0;const rank=c*100+len;if(rank>n){n=rank;best=sig}}
    return best?best.split(','):normalizeTimes((draws||[]).map(x=>x.time));
  }
  function shiftTime(time,s,times){
    const list=normalizeTimes(times),i=list.indexOf(time),j=i+Number(s);
    return i<0||j<0||j>=list.length?null:list[j];
  }
  function sourceFor(target,d,s,map,times){
    const sourceDate=addDays(target.date,-Number(d));
    const sourceTime=shiftTime(target.time,Number(s),times);
    if(!sourceTime)return null;
    const draw=map.get(key(sourceDate,sourceTime));
    return draw?{date:sourceDate,time:sourceTime,draw,combo:combo(draw),d:Number(d),s:Number(s)}:null;
  }
  function eventFor(fact,d,s,map,times){
    const src=sourceFor(fact,d,s,map,times);if(!src)return null;
    const factCombo=combo(fact),hit=overlapCount(src.combo,factCombo);
    return {...src,fact,factCombo,hit,success:hit>=2,exact:hit===3};
  }
  function sortFacts(draws){
    return [...draws].sort((a,b)=>Number(b.id||0)-Number(a.id||0)||(`${b.date} ${b.time}`).localeCompare(`${a.date} ${a.time}`));
  }
  function branchStats(draws,d,s,times,limit=30){
    const facts=sortFacts(draws),map=buildMap(draws),events=[];
    for(const fact of facts){
      const ev=eventFor(fact,d,s,map,times);if(!ev)continue;
      events.push(ev);if(events.length>=limit)break;
    }
    let w=1,totalW=0,hitW=0,exactW=0;
    events.forEach(ev=>{totalW+=w;if(ev.success)hitW+=w;if(ev.exact)exactW+=w;w*=.94});
    const rate=totalW?hitW/totalW:0,exactRate=totalW?exactW/totalW:0;
    const score=rate+exactRate*.12+Math.min(events.length,30)/30*.03;
    return {d,s,events,samples:events.length,successes:events.filter(x=>x.success).length,exacts:events.filter(x=>x.exact).length,rate,exactRate,score};
  }
  function branchStreak(draws,d,s,times){
    const facts=sortFacts(draws),map=buildMap(draws);let streak=0,last=null;
    for(const fact of facts){
      const ev=eventFor(fact,d,s,map,times);if(!ev)continue;
      if(!last)last=ev;
      if(ev.success)streak++;else break;
    }
    return {streak,last};
  }
  function allStats(draws,times,minD=1,maxD=7){
    const out=[];for(let d=minD;d<=maxD;d++)for(let s=-2;s<=2;s++){const x=branchStats(draws,d,s,times,30);if(x.samples>=5)out.push(x)}
    return out.sort((a,b)=>b.score-a.score||b.rate-a.rate||b.samples-a.samples||a.d-b.d||Math.abs(a.s)-Math.abs(b.s));
  }
  function rankSourceDigits(draws,d,s,times,sourceCombo){
    const facts=sortFacts(draws),map=buildMap(draws),stat=Array.from({length:10},()=>({seen:0,hit:0,wSeen:0,wHit:0,last:9999}));
    let idx=0,w=1;
    for(const fact of facts){
      const ev=eventFor(fact,d,s,map,times);if(!ev)continue;
      const unique=[...new Set(ev.combo)];
      for(const digit of unique){
        stat[digit].seen++;stat[digit].wSeen+=w;
        if(ev.factCombo.includes(digit)){stat[digit].hit++;stat[digit].wHit+=w;stat[digit].last=Math.min(stat[digit].last,idx)}
      }
      idx++;w*=.97;if(idx>=120)break;
    }
    const candidates=[...new Set(sourceCombo)].map(digit=>{
      const x=stat[digit],rate=(x.wHit+1)/(x.wSeen+2);
      return {digit,rate,last:x.last,seen:x.seen};
    }).sort((a,b)=>b.rate-a.rate||a.last-b.last||b.seen-a.seen||a.digit-b.digit);
    if(candidates.length>=2)return candidates.slice(0,2).map(x=>x.digit);
    if(candidates.length===1){
      const fallback=sourceCombo.find(x=>x!==candidates[0].digit);
      return [candidates[0].digit,Number.isInteger(fallback)?fallback:candidates[0].digit];
    }
    return sourceCombo.slice(0,2);
  }
  function pickPrimary(draws,target,times){
    const stats=allStats(draws,times,1,7);if(!stats.length)return null;
    const latest=sortFacts(draws)[0],map=buildMap(draws);
    const active=[];
    for(const st of stats){
      const ev=latest?eventFor(latest,st.d,st.s,map,times):null;if(!ev||!ev.success)continue;
      const streak=branchStreak(draws,st.d,st.s,times).streak;
      active.push({...st,streak,lastHit:ev.hit});
    }
    active.sort((a,b)=>b.streak-a.streak||b.score-a.score||Math.abs(a.s)-Math.abs(b.s)||a.d-b.d);
    let chosen,decision='JUMP',activeBranch=active[0]||null;
    if(activeBranch){
      decision=activeBranch.streak===2?'JUMP':'CONTINUE';
      if(decision==='CONTINUE')chosen=activeBranch;
      else chosen=stats.find(x=>!(x.d===activeBranch.d&&x.s===activeBranch.s))||activeBranch;
    }else chosen=stats[0];
    const source=sourceFor(target,chosen.d,chosen.s,map,times);if(!source)return null;
    const prediction=rankSourceDigits(draws,chosen.d,chosen.s,times,source.combo);
    const s0Source=sourceFor(target,chosen.d,0,map,times);
    const s0Prediction=s0Source?rankSourceDigits(draws,chosen.d,0,times,s0Source.combo):null;
    return {decision,chosen:{d:chosen.d,s:chosen.s,score:chosen.score,rate:chosen.rate,samples:chosen.samples},active:activeBranch?{d:activeBranch.d,s:activeBranch.s,streak:activeBranch.streak,score:activeBranch.score}:null,streak:activeBranch?.streak||0,source,prediction,s0:s0Source?{source:s0Source,prediction:s0Prediction}:null,ranking:stats.slice(0,8).map(x=>({d:x.d,s:x.s,score:x.score,rate:x.rate,samples:x.samples}))};
  }
  function extendedThread(draws,target,times){
    const latest=sortFacts(draws)[0],map=buildMap(draws);if(!latest)return null;
    const cands=[];
    for(let d=8;d<=14;d++)for(let s=-2;s<=2;s++){
      const ev=eventFor(latest,d,s,map,times);if(!ev||ev.hit<2)continue;
      const st=branchStats(draws,d,s,times,30),next=sourceFor(target,d,s,map,times);
      if(!next)continue;
      cands.push({d,s,hit:ev.hit,score:st.score,rate:st.rate,samples:st.samples,lastSource:{date:ev.date,time:ev.time,combo:ev.combo},nextSource:next});
    }
    cands.sort((a,b)=>b.hit-a.hit||b.score-a.score||Math.abs(a.s)-Math.abs(b.s)||a.d-b.d);
    return cands[0]||null;
  }
  function forecastPlan(draws,target,times){
    const grid=normalizeTimes(times&&times.length?times:inferTimes(draws,target?.date));
    const primary=pickPrimary(draws,target,grid);if(!primary)return null;
    return {version:VERSION,target:{...target},times:grid,primary,extended:extendedThread(draws,target,grid)};
  }
  function selfTest(){
    const times=['12:25','12:55','13:25','13:55','14:25'];
    const target={date:'26.09.26',time:'13:55'};
    const fake=[
      {id:10,date:'21.09.26',time:'13:55',a:9,b:0,c:6},
      {id:9,date:'19.09.26',time:'13:25',a:8,b:0,c:0},
      {id:8,date:'18.09.26',time:'13:25',a:8,b:5,c:0}
    ];
    const map=buildMap(fake);
    const a=sourceFor(target,5,0,map,times),b=sourceFor(target,7,-1,map,times),c=sourceFor(target,8,-1,map,times);
    const checks=[
      ['D5 date/time',!!a&&a.date==='21.09.26'&&a.time==='13:55'],
      ['D7 S-1',!!b&&b.date==='19.09.26'&&b.time==='13:25'],
      ['D8 S-1',!!c&&c.date==='18.09.26'&&c.time==='13:25'],
      ['overlap multiset',overlapCount([8,5,0],[8,0,5])===3],
      ['shift bounds',shiftTime('12:25',-1,times)===null]
    ];
    return {pass:checks.every(x=>x[1]),checks};
  }

  return {VERSION,parseDate,formatDate,addDays,combo,key,overlapCount,matchedDigits,buildMap,normalizeTimes,inferTimes,shiftTime,sourceFor,eventFor,branchStats,branchStreak,allStats,rankSourceDigits,pickPrimary,extendedThread,forecastPlan,selfTest};
});
