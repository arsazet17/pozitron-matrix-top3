'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(root)root.LabThreeColumnsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const VERSION='1.0.0';
  const CUTOVER_ID=267756;

  function parseDate(s){
    const [d,m,y]=String(s).split('.').map(Number);
    return new Date(Date.UTC(y<100?2000+y:y,m-1,d));
  }
  function formatDate(dt){
    return [String(dt.getUTCDate()).padStart(2,'0'),String(dt.getUTCMonth()+1).padStart(2,'0'),String(dt.getUTCFullYear()).slice(-2)].join('.');
  }
  function addDays(s,n){const d=parseDate(s);d.setUTCDate(d.getUTCDate()+n);return formatDate(d)}
  function combo(d){return [Number(d.a),Number(d.b),Number(d.c)]}
  function comboKey(c){return (c||[]).join('')}
  function exactCombo(a,b){return Array.isArray(a)&&Array.isArray(b)&&a.length===3&&b.length===3&&a.every((n,i)=>Number(n)===Number(b[i]))}
  function mod10(n){return ((Number(n)%10)+10)%10}
  function modAdd(a,b){return a.map((n,i)=>mod10(n+Number(b[i]||0)))}
  function modSub(a,b){return a.map((n,i)=>mod10(n-Number(b[i]||0)))}
  function overlapCount(a,b){
    const ca=Array(10).fill(0),cb=Array(10).fill(0);
    (a||[]).forEach(n=>ca[Number(n)]++);(b||[]).forEach(n=>cb[Number(n)]++);
    return ca.reduce((s,n,i)=>s+Math.min(n,cb[i]),0);
  }
  function matchedDigits(a,b){
    const cb=Array(10).fill(0),out=[];(b||[]).forEach(n=>cb[Number(n)]++);
    (a||[]).forEach(n=>{n=Number(n);if(cb[n]>0){out.push(n);cb[n]--}});return out;
  }
  function positionHits(a,b){return (a||[]).reduce((n,x,i)=>n+(Number(x)===Number((b||[])[i])?1:0),0)}
  function normalizeTimes(times){return [...new Set((times||[]).filter(Boolean))].sort((a,b)=>a.localeCompare(b))}
  function inferTimes(draws,targetDate){
    const era=(draws||[]).filter(d=>Number(d.id)>=CUTOVER_ID);
    const src=era.length?era:draws||[];
    const dates=[];if(targetDate)dates.push(targetDate);
    for(const d of src){if(!dates.includes(d.date))dates.push(d.date);if(dates.length>=5)break}
    const score=new Map();
    for(const date of dates){
      const t=[...new Set(src.filter(x=>x.date===date).map(x=>x.time))].sort();
      const sig=t.join(',');if(t.length)score.set(sig,(score.get(sig)||0)+1);
    }
    let best='',rank=-1;for(const [sig,count] of score){const len=sig?sig.split(',').length:0,v=count*100+len;if(v>rank){rank=v;best=sig}}
    return best?best.split(','):normalizeTimes(src.map(x=>x.time));
  }
  function sortAsc(draws){return [...(draws||[])].sort((a,b)=>Number(a.id||0)-Number(b.id||0))}
  function sortDesc(draws){return [...(draws||[])].sort((a,b)=>Number(b.id||0)-Number(a.id||0))}
  function latestDraw(draws){return sortDesc((draws||[]).filter(d=>Number(d.id)>=CUTOVER_ID))[0]||sortDesc(draws)[0]||null}
  function targetAfterLatest(draws,times){
    const latest=latestDraw(draws);if(!latest)return null;
    const grid=normalizeTimes(times&&times.length?times:inferTimes(draws,latest.date));
    const i=grid.indexOf(latest.time);if(i<0||!grid.length)return null;
    if(i<grid.length-1)return {id:Number(latest.id)+1,date:latest.date,time:grid[i+1]};
    return {id:Number(latest.id)+1,date:addDays(latest.date,1),time:grid[0]};
  }
  function findPreviousExact(draws,current){
    if(!current)return null;
    const curCombo=combo(current),ascending=sortAsc(draws);
    const candidates=ascending.filter(d=>Number(d.id)<Number(current.id)&&exactCombo(combo(d),curCombo));
    return candidates[candidates.length-1]||null;
  }
  function nextAfter(draws,source){
    if(!source)return null;
    const ascending=sortAsc(draws),idx=ascending.findIndex(d=>Number(d.id)===Number(source.id));
    if(idx<0)return null;
    return ascending[idx+1]||null;
  }
  function findSameTimeD2(draws,current){
    if(!current)return null;
    const date=addDays(current.date,-2);
    return (draws||[]).find(d=>d.date===date&&d.time===current.time)||null;
  }
  function planForTarget(draws,target){
    const current=latestDraw(draws);if(!current||!target)return null;
    const currentCombo=combo(current);
    const previous=findPreviousExact(draws,current),follower=nextAfter(draws,previous);
    const d2=findSameTimeD2(draws,current);
    const repeat=(previous&&follower)?{
      kind:'repeat-add',label:'ПОВТОР +',previous:{id:previous.id,date:previous.date,time:previous.time,combo:combo(previous)},
      follower:{id:follower.id,date:follower.date,time:follower.time,combo:combo(follower)},prediction:modAdd(currentCombo,combo(follower))
    }:null;
    const vertical=d2?{
      kind:'d2-sub',label:'ВЕРТИКАЛЬ D2 −',source:{id:d2.id,date:d2.date,time:d2.time,combo:combo(d2)},prediction:modSub(currentCombo,combo(d2))
    }:null;
    return {version:VERSION,current:{id:current.id,date:current.date,time:current.time,combo:currentCombo},target:{...target},repeat,vertical};
  }
  function plan(draws,times){
    const target=targetAfterLatest(draws,times);
    return target?planForTarget(draws,target):null;
  }
  function evaluatePrediction(prediction,factCombo){
    if(!prediction)return null;
    const hit=overlapCount(prediction,factCombo);
    return {hit,result:`${hit}/3`,matched:matchedDigits(prediction,factCombo),positions:positionHits(prediction,factCombo),familyHit:hit===3};
  }
  function selfTest(){
    const draws=[
      {id:100,date:'22.09.26',time:'15:55',a:9,b:4,c:2},
      {id:101,date:'22.09.26',time:'16:25',a:2,b:8,c:7},
      {id:200,date:'24.09.26',time:'15:55',a:0,b:2,c:2},
      {id:300,date:'26.09.26',time:'15:55',a:9,b:4,c:2}
    ];
    const p=plan(draws,['15:55','16:25']);
    const checks=[
      p&&comboKey(p.repeat?.prediction)==='129',
      p&&comboKey(p.vertical?.prediction)==='920',
      overlapCount([1,2,9],[9,1,2])===3,
      overlapCount([0,0,7],[7,0,5])===2
    ];
    return {ok:checks.every(Boolean),checks,repeat:p?.repeat?.prediction,vertical:p?.vertical?.prediction};
  }
  return {VERSION,CUTOVER_ID,parseDate,formatDate,addDays,combo,comboKey,exactCombo,modAdd,modSub,overlapCount,matchedDigits,positionHits,normalizeTimes,inferTimes,latestDraw,targetAfterLatest,findPreviousExact,nextAfter,findSameTimeD2,planForTarget,plan,evaluatePrediction,selfTest};
});
