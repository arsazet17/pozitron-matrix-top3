'use strict';

const fs=require('node:fs');
const path=require('node:path');
const Core=require('../lab-three-columns-core.js');

const ROOT=path.resolve(__dirname,'..');
const LIVE_PATH=path.join(ROOT,'top3-live.json');
const ARCHIVE_PATH=path.join(ROOT,'three-columns-archive-top3.json');
const CUTOVER_ID=Core.CUTOVER_ID;
const ENGINE='LAB THREE COLUMNS SERVER v1.0.0';
const BACKFILL_LIMIT=500;

function clone(v){return JSON.parse(JSON.stringify(v));}
function targetKey(t){return `${t.id||''}|${t.date}|${t.time}`;}
function findFact(draws,target){
  return (draws||[]).find(d=>(target.id&&Number(d.id)===Number(target.id))||(d.date===target.date&&d.time===target.time))||null;
}
function channelRecord(ch){
  if(!ch)return null;
  if(ch.kind==='repeat-add')return {
    kind:ch.kind,label:ch.label,prediction:[...ch.prediction],
    previous:clone(ch.previous),follower:clone(ch.follower)
  };
  return {kind:ch.kind,label:ch.label,prediction:[...ch.prediction],source:clone(ch.source)};
}
function evaluation(pred,factCombo){return pred?Core.evaluatePrediction(pred,factCombo):null;}
function makeFrozen(draws,target,nowIso){
  const p=Core.planForTarget(draws,target);if(!p)return null;
  return {
    key:targetKey(target),status:'pending',savedAt:nowIso,engine:ENGINE,serverFrozen:true,storage:'three-columns-archive-top3.json',
    target:clone(p.target),current:clone(p.current),repeat:channelRecord(p.repeat),vertical:channelRecord(p.vertical),
    bestHit:null,fact:null,closedAt:null
  };
}
function closeRecord(r,fact,nowIso){
  const factCombo=Core.combo(fact),repeatEval=evaluation(r.repeat?.prediction,factCombo),verticalEval=evaluation(r.vertical?.prediction,factCombo);
  r.status='closed';r.fact={id:fact.id,date:fact.date,time:fact.time,combo:factCombo};
  r.repeatEval=repeatEval;r.verticalEval=verticalEval;
  r.bestHit=Math.max(repeatEval?.hit??-1,verticalEval?.hit??-1,0);
  r.bestResult=`${r.bestHit}/3`;r.closedAt=nowIso;return r;
}
function closePending(records,draws,nowIso){
  let changed=false;
  for(const r of records){if(r.status!=='pending')continue;const fact=findFact(draws,r.target);if(!fact)continue;closeRecord(r,fact,nowIso);changed=true;}
  return changed;
}
function normalizeArchive(input){
  const a=input&&typeof input==='object'?clone(input):{};
  a.schema=1;a.method='three-columns-repeat-plus-d2-v1';a.storage='github-main';a.records=Array.isArray(a.records)?a.records:[];
  return a;
}
function buildBackfill(draws,limit=BACKFILL_LIMIT){
  const asc=[...(draws||[])].filter(d=>Number(d.id)>=CUTOVER_ID).sort((a,b)=>Number(a.id)-Number(b.id));
  const allAsc=[...(draws||[])].sort((a,b)=>Number(a.id)-Number(b.id));
  const indexById=new Map(allAsc.map((d,i)=>[Number(d.id),i]));
  const out=[];
  const slice=asc.slice(Math.max(0,asc.length-limit));
  for(const fact of slice){
    const idx=indexById.get(Number(fact.id));if(!Number.isInteger(idx)||idx<=0)continue;
    const history=allAsc.slice(0,idx);
    const p=Core.planForTarget(history,{id:fact.id,date:fact.date,time:fact.time});if(!p)continue;
    const r={
      key:targetKey(fact),status:'closed',savedAt:null,closedAt:null,engine:`${ENGINE} BACKFILL`,serverFrozen:false,backfill:true,storage:'three-columns-archive-top3.json',
      target:{id:fact.id,date:fact.date,time:fact.time},current:clone(p.current),repeat:channelRecord(p.repeat),vertical:channelRecord(p.vertical)
    };
    closeRecord(r,fact,null);out.push(r);
  }
  return out.sort((a,b)=>Number(b.target.id)-Number(a.target.id));
}
function mergeBackfill(records,backfill){
  const map=new Map(records.map(r=>[r.key,r]));let changed=false;
  for(const r of backfill){if(!map.has(r.key)){map.set(r.key,r);changed=true;}}
  const merged=[...map.values()].sort((a,b)=>Number(b.target?.id||0)-Number(a.target?.id||0));
  return {records:merged,changed};
}
function updateArchive(live,archiveInput,now=new Date()){
  const draws=Array.isArray(live?.draws)?live.draws:[],archive=normalizeArchive(archiveInput);let records=archive.records;
  const nowIso=now.toISOString();let changed=closePending(records,draws,nowIso);

  const backfill=buildBackfill(draws,BACKFILL_LIMIT),merged=mergeBackfill(records,backfill);records=merged.records;if(merged.changed)changed=true;
  archive.records=records;

  const target=Core.targetAfterLatest(draws,Core.inferTimes(draws,Core.latestDraw(draws)?.date));
  if(target&&!records.some(r=>r.key===targetKey(target))){
    const frozen=makeFrozen(draws,target,nowIso);if(frozen){records.unshift(frozen);changed=true;}
  }
  archive.records=records.sort((a,b)=>Number(b.target?.id||0)-Number(a.target?.id||0));
  const latestHistoryDraw=draws.reduce((m,d)=>Math.max(m,Number(d.id)||0),0)||null;
  if(archive.latestHistoryDraw!==latestHistoryDraw){archive.latestHistoryDraw=latestHistoryDraw;changed=true;}
  archive.backfillLimit=BACKFILL_LIMIT;
  if(changed)archive.updatedAt=nowIso;
  return {archive,changed,target};
}
function loadJson(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return fallback;}}
function main(){
  const live=loadJson(LIVE_PATH,{draws:[]}),existing=loadJson(ARCHIVE_PATH,{records:[]});
  const out=updateArchive(live,existing,new Date());
  if(!out.changed){console.log('THREE COLUMNS ARCHIVE: already current');return;}
  fs.writeFileSync(ARCHIVE_PATH,JSON.stringify(out.archive,null,2)+'\n');
  const pending=out.archive.records.find(r=>r.status==='pending');
  console.log(`THREE COLUMNS ARCHIVE: updated · records=${out.archive.records.length} · latest=${out.archive.latestHistoryDraw}`);
  if(pending)console.log(`SERVER FROZEN: #${pending.target.id} ${pending.target.date} ${pending.target.time} → repeat=${pending.repeat?.prediction?.join('')||'—'} vertical=${pending.vertical?.prediction?.join('')||'—'}`);
}

if(require.main===module)main();
module.exports={targetKey,findFact,channelRecord,evaluation,makeFrozen,closeRecord,closePending,normalizeArchive,buildBackfill,mergeBackfill,updateArchive};
