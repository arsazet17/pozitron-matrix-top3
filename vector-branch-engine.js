'use strict';

/*
  TOP-3 VECTOR BRANCH ENGINE v1.6.0
  Pure data engine. No DOM, no localStorage, no hidden state.
  Every result is recalculated from the supplied archive.
*/
(function(root,factory){
  const api=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.TOP3VectorBranch=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const CUTOVER_ID=267756;
  const TIMES=Array.from({length:24},(_,h)=>[
    `${String(h).padStart(2,'0')}:25`,`${String(h).padStart(2,'0')}:55`
  ]).flat();
  const TI=new Map(TIMES.map((t,i)=>[t,i]));
  const PAIRS=[[0,1],[0,2],[1,2]];

  function parseDate(s){
    const [d,m,y]=String(s).split('.').map(Number);
    return new Date(Date.UTC(y<100?2000+y:y,m-1,d));
  }
  function formatDate(dt){
    return [String(dt.getUTCDate()).padStart(2,'0'),String(dt.getUTCMonth()+1).padStart(2,'0'),String(dt.getUTCFullYear()).slice(-2)].join('.');
  }
  function addDays(s,n){const d=parseDate(s);d.setUTCDate(d.getUTCDate()+n);return formatDate(d)}
  function key(date,time){return `${date}|${time}`}
  function vals(d){return [Number(d.a),Number(d.b),Number(d.c)]}
  function overlapArrays(a,b){
    const c=Array(10).fill(0);for(const x of a)c[x]++;
    let n=0;for(const x of b){if(c[x]>0){c[x]--;n++}}
    return n;
  }
  function overlap(a,b){return overlapArrays(vals(a),vals(b))}
  function pairHit(pairDigits,targetDigits){return overlapArrays(pairDigits,targetDigits)===2}
  function betaRate(list,alpha=1.2,beta=10){return (list.filter(x=>x>=2).length+alpha)/(list.length+beta)}
  function betaBool(hits,n,alpha=1,beta=8){return (hits+alpha)/(n+beta)}
  function nextTarget(draws){
    const fresh=draws.filter(d=>d.id>=CUTOVER_ID&&TI.has(d.time)).sort((a,b)=>b.id-a.id);
    const latest=fresh[0];if(!latest)return null;
    const i=TI.get(latest.time);if(i==null)return null;
    if(i<TIMES.length-1)return {id:latest.id+1,date:latest.date,time:TIMES[i+1]};
    return {id:latest.id+1,date:addDays(latest.date,1),time:TIMES[0]};
  }
  function sourceFor(map,target,D,S){
    const i=TI.get(target.time);if(i==null)return null;
    const j=i+S;if(j<0||j>=TIMES.length)return null;
    return map.get(key(addDays(target.date,-D),TIMES[j]))||null;
  }
  function branchLabel(D,S){return `D${D} S${S>0?'+':''}${S}`}
  function shiftLabel(S){
    if(S===0)return 'то же время';
    if(S===-1)return '1 тираж влево';
    if(S===1)return '1 тираж вправо';
    if(S===-2)return '2 тиража влево';
    return '2 тиража вправо';
  }
  function pairStats(branchHist,sourceNow){
    const sourceDigits=vals(sourceNow);
    const out=[];
    for(const pair of PAIRS){
      const all=[];
      for(const h of branchHist){
        const pd=[h.sourceDigits[pair[0]],h.sourceDigits[pair[1]]];
        all.push(pairHit(pd,h.targetDigits));
      }
      const recent=all.slice(-24);
      const global=(all.filter(Boolean).length+1)/(all.length+8);
      const recentRate=(recent.filter(Boolean).length+.8)/(recent.length+6);
      const score=.55*global+.45*recentRate;
      out.push({positions:pair,digits:[sourceDigits[pair[0]],sourceDigits[pair[1]]],global,recentRate,score});
    }
    out.sort((a,b)=>b.score-a.score||a.positions[0]-b.positions[0]||a.positions[1]-b.positions[1]);
    return out;
  }
  function analyze(draws,options={}){
    const maxD=Math.max(1,Math.min(21,Number(options.maxD)||14));
    const shifts=Array.isArray(options.shifts)&&options.shifts.length?options.shifts:[-2,-1,0,1,2];
    const target=options.target||nextTarget(draws);if(!target)return null;
    const ordered=draws.filter(d=>d.id>=CUTOVER_ID&&TI.has(d.time)).sort((a,b)=>a.id-b.id);
    if(!ordered.length)return null;
    const map=new Map(ordered.map(d=>[key(d.date,d.time),d]));
    const latest=ordered[ordered.length-1];
    const targetIndex=TI.get(target.time);
    const branches=[];

    for(let D=1;D<=maxD;D++){
      for(const S of shifts){
        const sourceNow=sourceFor(map,target,D,S);if(!sourceNow)continue;
        const hist=[];
        const slotHits=[];
        const currentDay=[];
        const currentDayRows=[];
        for(const t of ordered){
          if(t.id>latest.id)break;
          const si=TI.get(t.time)+S;if(si<0||si>=TIMES.length)continue;
          const src=map.get(key(addDays(t.date,-D),TIMES[si]));if(!src)continue;
          const hit=overlap(src,t);
          const row={targetId:t.id,targetDate:t.date,targetTime:t.time,hit,sourceDate:src.date,sourceTime:src.time,sourceDigits:vals(src),targetDigits:vals(t)};
          hist.push(row);
          if(t.time===target.time)slotHits.push(hit);
          if(t.date===target.date && TI.get(t.time)<targetIndex){currentDay.push(hit);currentDayRows.push(row)}
        }
        if(hist.length<12)continue;
        const all=hist.map(x=>x.hit), recent30=all.slice(-30), dayBase=currentDay.length?currentDay:all;
        const last=dayBase.length?dayBase[dayBase.length-1]:0;
        let streak=0;for(let i=dayBase.length-1;i>=0&&dayBase[i]>=2;i--)streak++;
        const day6=dayBase.slice(-6), day12=dayBase.slice(-12);
        const trans=[];for(let i=1;i<all.length;i++)if(all[i-1]===last)trans.push(all[i]);
        const overall=betaRate(all,1.2,10);
        const recent=betaRate(recent30,.8,6);
        const slotRate=betaRate(slotHits,.5,5);
        const day6Rate=betaRate(day6,.5,4);
        const day12Rate=betaRate(day12,.8,6);
        const transRate=betaRate(trans,.5,5);
        const exactRecent=day6.filter(x=>x===3).length;
        const evidenceBonus=last===3?12:last===2?6:0;
        const streakBonus=2.5*Math.min(streak,3);
        const exactBonus=2.0*Math.min(exactRecent,2);
        const shiftPenalty=1.2*Math.abs(S);
        const score=100*(.16*overall+.22*recent+.16*slotRate+.22*day6Rate+.10*day12Rate+.14*transRate)
          +evidenceBonus+streakBonus+exactBonus-shiftPenalty;
        const pairs=pairStats(hist,sourceNow);
        const lastEvidence=currentDayRows.length?currentDayRows[currentDayRows.length-1]:hist[hist.length-1];
        branches.push({
          D,S,label:branchLabel(D,S),shiftLabel:shiftLabel(S),score,
          sourceDate:sourceNow.date,sourceTime:sourceNow.time,sourceId:sourceNow.id,sourceDigits:vals(sourceNow),
          lastOverlap:last,streak,dayHistory:dayBase.slice(-8),historyN:all.length,lastEvidence,
          rates:{overall,recent,slot:slotRate,day6:day6Rate,day12:day12Rate,transition:transRate},
          pair:pairs[0],pairAlternatives:pairs
        });
      }
    }
    if(!branches.length)return {target,latest,decision:'NO_DATA',active:null,controlS0:null,top:[]};
    branches.sort((a,b)=>b.score-a.score||b.lastOverlap-a.lastOverlap||b.streak-a.streak||Math.abs(a.S)-Math.abs(b.S)||a.D-b.D);
    function choose(list){
      if(!list.length)return null;
      const live=list.filter(b=>b.lastOverlap>=2);
      const exact=live.filter(b=>b.lastOverlap===3);
      const pool=exact.length?exact:(live.length?live:list);
      return [...pool].sort((a,b)=>b.score-a.score||b.streak-a.streak||Math.abs(a.S)-Math.abs(b.S)||a.D-b.D)[0];
    }
    const mainBranches=branches.filter(b=>b.D<=7);
    const extendedBranches=branches.filter(b=>b.D>7);
    const active=choose(mainBranches)||choose(branches);
    const extendedCandidate=choose(extendedBranches);
    const extendedSignal=extendedCandidate&&(extendedCandidate.lastOverlap===3||extendedCandidate.streak>=2)?extendedCandidate:null;
    const controlS0=branches.find(b=>b.D===active.D&&b.S===0)||null;
    let previousActive=null;
    if(options.computePrevious!==false&&ordered.length>1){
      const prevDraw=latest;
      const prevArchive=ordered.slice(0,-1);
      const prev=analyze(prevArchive,{maxD,shifts,target:{id:prevDraw.id,date:prevDraw.date,time:prevDraw.time},computePrevious:false});
      previousActive=prev?.active||null;
    }
    const decision=previousActive&&previousActive.label===active.label?'CONTINUE':'JUMP';
    const picks=active.pair?active.pair.digits.map((digit,i)=>({
      displaySlot:i,digit,sourcePos:active.pair.positions[i],sourceDate:active.sourceDate,sourceTime:active.sourceTime
    })):[];
    return {target,latest,decision,active,previousActive,controlS0,extendedSignal,top:mainBranches.slice(0,8),topExtended:extendedBranches.slice(0,8),picks,maxD};
  }

  return {CUTOVER_ID,TIMES,nextTarget,analyze,overlap,overlapArrays,branchLabel,shiftLabel,addDays};
});
