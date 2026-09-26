'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Core=require('../lab-branch-core.js');

const ROOT=path.resolve(__dirname,'..');
const LIVE_PATH=path.join(ROOT,'top3-live.json');
const ARCHIVE_PATH=path.join(ROOT,'branch-archive-top3.json');
const CUTOVER_ID=267756;
const ENGINE='LAB BRANCH SERVER v1.8.0';

function clone(v){return JSON.parse(JSON.stringify(v));}
function targetKey(t){return `${t.id||''}|${t.date}|${t.time}`;}
function currentTimes(draws,target){
  const era=(draws||[]).filter(d=>Number(d.id)>=CUTOVER_ID);
  return Core.inferTimes(era.length?era:draws,target?.date);
}
function branchTargetDraw(draws){
  const list=(draws||[]).filter(d=>Number(d.id)>=CUTOVER_ID).sort((a,b)=>Number(b.id)-Number(a.id));
  const latest=list[0]||(draws||[]).slice().sort((a,b)=>Number(b.id)-Number(a.id))[0];
  if(!latest)return null;
  const times=currentTimes(draws,latest),i=times.indexOf(latest.time);
  if(i<0||!times.length)return null;
  if(i<times.length-1)return {id:Number(latest.id)+1,date:latest.date,time:times[i+1]};
  return {id:Number(latest.id)+1,date:Core.addDays(latest.date,1),time:times[0]};
}
function targetEpoch(t){
  if(!t?.date||!t?.time)return NaN;
  const [d,m,y]=String(t.date).split('.').map(Number),[h,n]=String(t.time).split(':').map(Number);
  if([d,m,y,h,n].some(x=>!Number.isFinite(x)))return NaN;
  const yyyy=y<100?2000+y:y;
  return Date.parse(`${String(yyyy).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}:00+03:00`);
}
function findFact(draws,target){
  return (draws||[]).find(d=>(target.id&&Number(d.id)===Number(target.id))||(d.date===target.date&&d.time===target.time))||null;
}
function closePending(records,draws,nowIso){
  let changed=false;
  for(const r of records){
    if(r.status!=='pending')continue;
    const fact=findFact(draws,r.target);if(!fact)continue;
    const factCombo=Core.combo(fact),hit=Core.overlapCount(r.prediction,factCombo);
    r.status='closed';
    r.fact={id:fact.id,date:fact.date,time:fact.time,combo:factCombo};
    r.hit=hit;r.result=`${hit}/2`;r.matched=Core.matchedDigits(r.prediction,factCombo);r.closedAt=nowIso;
    changed=true;
  }
  return changed;
}
function makeFrozen(draws,target,nowIso){
  const times=currentTimes(draws,target),plan=Core.forecastPlan(draws,target,times);if(!plan)return null;
  const p=plan.primary;
  return {
    key:targetKey(target),status:'pending',savedAt:nowIso,engine:ENGINE,serverFrozen:true,storage:'branch-archive-top3.json',
    target:{id:target.id,date:target.date,time:target.time},decision:p.decision,streak:p.streak,
    branch:{d:p.chosen.d,s:p.chosen.s,score:Number(p.chosen.score.toFixed(5)),rate:Number(p.chosen.rate.toFixed(5)),samples:p.chosen.samples},
    source:{date:p.source.date,time:p.source.time,combo:[...p.source.combo]},prediction:[...p.prediction],
    s0:p.s0?{source:{date:p.s0.source.date,time:p.s0.source.time,combo:[...p.s0.source.combo]},prediction:[...p.s0.prediction]}:null,
    extended:p.extended?{d:p.extended.d,s:p.extended.s,hit:p.extended.hit,lastSource:p.extended.lastSource,nextSource:{date:p.extended.nextSource.date,time:p.extended.nextSource.time,combo:[...p.extended.nextSource.combo]}}:null,
    ranking:p.ranking
  };
}
function normalizeArchive(input){
  const a=input&&typeof input==='object'?clone(input):{};
  a.schema=1;a.method='lab-branch-ds-v1';a.storage='github-main';a.records=Array.isArray(a.records)?a.records:[];
  return a;
}
function updateArchive(live,archiveInput,now=new Date()){
  const draws=Array.isArray(live?.draws)?live.draws:[];
  const archive=normalizeArchive(archiveInput),records=archive.records;
  const nowIso=now.toISOString();
  let changed=closePending(records,draws,nowIso);
  const target=branchTargetDraw(draws);
  if(target){
    const existing=records.find(r=>r.key===targetKey(target));
    const open=Number.isFinite(targetEpoch(target))&&now.getTime()<targetEpoch(target);
    if(!existing&&open){
      const frozen=makeFrozen(draws,target,nowIso);
      if(frozen){records.unshift(frozen);changed=true;}
    }
  }
  const latestHistoryDraw=draws.reduce((m,d)=>Math.max(m,Number(d.id)||0),0)||null;
  if(archive.latestHistoryDraw!==latestHistoryDraw){archive.latestHistoryDraw=latestHistoryDraw;changed=true;}
  if(changed)archive.updatedAt=nowIso;
  return {archive,changed,target};
}
function loadJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;}}
function main(){
  const live=loadJson(LIVE_PATH,{draws:[]}),existing=loadJson(ARCHIVE_PATH,{records:[]});
  const out=updateArchive(live,existing,new Date());
  if(!out.changed){console.log('BRANCH ARCHIVE: already current');return;}
  fs.writeFileSync(ARCHIVE_PATH,JSON.stringify(out.archive,null,2)+'\n');
  console.log(`BRANCH ARCHIVE: updated · records=${out.archive.records.length} · latest=${out.archive.latestHistoryDraw}`);
  const pending=out.archive.records.find(r=>r.status==='pending');
  if(pending)console.log(`SERVER FROZEN: #${pending.target.id} ${pending.target.date} ${pending.target.time} → ${pending.prediction.join(',')}`);
}

if(require.main===module)main();
module.exports={targetKey,currentTimes,branchTargetDraw,targetEpoch,findFact,closePending,makeFrozen,normalizeArchive,updateArchive};
