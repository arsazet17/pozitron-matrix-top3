'use strict';

/* LAB MATRIX v2 — experimental state detector.
   3D/morph state + horizontal day window + adaptive same-time vertical windows 7/14/30/60 + 3/6/9 rigid-corner events.
   Honest archive remains the source of truth. */

(() => {
  const INNER=[1,2,4,5,7,8,0];
  const INNER_INDEX=new Map(INNER.map((n,i)=>[n,i]));
  const RIGID=new Set([3,6,9]);
  const ALGO='LAB v2 · STATE DETECTOR 3D · H + V AUTO 7/14/30/60 · MORPH 369';

  function ringDistance(a,b){
    if(!INNER_INDEX.has(a)||!INNER_INDEX.has(b))return 9;
    const x=INNER_INDEX.get(a),y=INNER_INDEX.get(b),d=Math.abs(x-y);
    return Math.min(d,7-d);
  }
  function ringDelta(a,b){
    if(!INNER_INDEX.has(a)||!INNER_INDEX.has(b))return null;
    return (INNER_INDEX.get(b)-INNER_INDEX.get(a)+7)%7;
  }
  function emptyCounts(){return Array.from({length:3},()=>Array(10).fill(.25))}
  function normalize(counts){return counts.map(row=>{const s=row.reduce((a,b)=>a+b,0)||1;return row.map(v=>v/s)})}
  function countRows(rows,recency=.06){
    const out=emptyCounts();
    rows.forEach((d,i)=>combo(d).forEach((n,p)=>out[p][n]+=1/(1+i*recency)));
    return normalize(out)
  }
  function topInfo(prob){
    const order=prob.map((v,d)=>({d,v})).sort((a,b)=>b.v-a.v||a.d-b.d);
    return {digit:order[0].d,p:order[0].v,second:order[1].v,margin:order[0].v-order[1].v}
  }
  function transitionSimilarity(a0,a1,b0,b1){
    let s=0;
    for(let p=0;p<3;p++){
      const da=ringDelta(a0[p],a1[p]),db=ringDelta(b0[p],b1[p]);
      if(da!==null&&db!==null){
        const dd=Math.min((da-db+7)%7,(db-da+7)%7);
        s+=Math.max(0,1.35-dd*.45);
      }else{
        const ae=RIGID.has(a0[p]),ax=RIGID.has(a1[p]),be=RIGID.has(b0[p]),bx=RIGID.has(b1[p]);
        if(ae===be&&ax===bx)s+=.75;
        if(a1[p]===b1[p]&&RIGID.has(a1[p]))s+=.8;
      }
    }
    return s;
  }
  function stateSimilarity(cur,curPrev,hist,histPrev,histNext,target){
    const a=combo(cur),b=combo(hist);let s=0;
    for(let p=0;p<3;p++){
      if(a[p]===b[p])s+=2.25;
      else if(INNER_INDEX.has(a[p])&&INNER_INDEX.has(b[p]))s+=Math.max(0,1.2-ringDistance(a[p],b[p])*.32);
      else if(RIGID.has(a[p])&&RIGID.has(b[p]))s+=.45;
      if(RIGID.has(a[p])===RIGID.has(b[p]))s+=.45;
    }
    if(curPrev&&histPrev)s+=transitionSimilarity(combo(curPrev),a,combo(histPrev),b);
    if(histNext.time===target.time)s+=2.4;
    if(weekday(histNext.date)===weekday(target.date))s+=.35;
    const curRigid=a.filter(n=>RIGID.has(n)).length,histRigid=b.filter(n=>RIGID.has(n)).length;
    if(curRigid===histRigid)s+=.65;
    if(new Set(a).size===new Set(b).size)s+=.35;
    return s;
  }
  function analogSource(draws,target){
    const current=draws[0],curPrev=draws[1]||null,cands=[];
    const lim=Math.min(draws.length-2,2600);
    for(let i=1;i<=lim;i++){
      const hist=draws[i],histPrev=draws[i+1],histNext=draws[i-1];
      if(!histNext||!histPrev)continue;
      const score=stateSimilarity(current,curPrev,hist,histPrev,histNext,target);
      cands.push({score,next:histNext});
    }
    cands.sort((x,y)=>y.score-x.score);
    const best=cands.slice(0,120),out=emptyCounts();
    if(!best.length)return {prob:normalize(out),samples:0,quality:0};
    const max=best[0].score,min=best[best.length-1].score;
    best.forEach((x,i)=>{
      const w=Math.exp((x.score-max)*.42)/(1+i*.012);
      combo(x.next).forEach((n,p)=>out[p][n]+=w);
    });
    return {prob:normalize(out),samples:best.length,quality:Math.max(0,Math.min(1,(max-min)/5))};
  }
  function sourceSignal(prob){const tops=prob.map(topInfo);return tops.reduce((s,x)=>s+x.p,0)/3}
  function unorderedTop(prob,n){
    const score=Array(10).fill(0);
    for(let p=0;p<3;p++)for(let d=0;d<10;d++)score[d]+=prob[p][d];
    return score.map((v,d)=>({d,v})).sort((a,b)=>b.v-a.v||a.d-b.d).slice(0,n);
  }

  function detectorForecast(){
    const target=targetDraw();if(!target||!state.draws.length)return null;
    const draws=state.draws,latest=draws[0];
    const sameTime=draws.filter(d=>d.time===target.time);
    const verticalWindows=[7,14,30,60].map(size=>{
      const rows=sameTime.slice(0,size),prob=countRows(rows,.035);
      const tops=prob.map(topInfo);
      const signal=tops.reduce((s,x)=>s+x.p,0)/3;
      const margin=tops.reduce((s,x)=>s+x.margin,0)/3;
      const coverage=Math.min(1,rows.length/size);
      // Strong shape + separation between first and second digit, with a small coverage guard.
      const structure=signal*.58+Math.min(1,margin/.08)*.34+coverage*.08;
      return {size,rows,prob,signal,margin,coverage,structure};
    }).filter(x=>x.rows.length>=Math.min(5,x.size));
    const verticalState=(verticalWindows.sort((a,b)=>b.structure-a.structure||b.size-a.size)[0])||{size:0,rows:[],prob:countRows([]),signal:0,margin:0,coverage:0,structure:0};
    const vertical=verticalState.rows;
    const horizontal=draws.filter(d=>d.date===target.date&&d.time<target.time).slice(0,8);
    const morph=draws.slice(0,7);
    const analog=analogSource(draws,target);
    const pv=verticalState.prob,ph=countRows(horizontal,.08),pm=countRows(morph,.08),pa=analog.prob;
    const combined=Array.from({length:3},()=>Array(10).fill(0));
    const verticalWeight=.18+Math.min(.18,verticalState.structure*.18);
    const analogWeight=.48-verticalWeight/3;
    const horizontalWeight=.16,morphWeight=1-analogWeight-verticalWeight-horizontalWeight;
    for(let p=0;p<3;p++)for(let d=0;d<10;d++)combined[p][d]=pa[p][d]*analogWeight+pv[p][d]*verticalWeight+ph[p][d]*horizontalWeight+pm[p][d]*morphWeight;
    const positions=combined.map((pr,p)=>{
      const best=topInfo(pr),tops=[topInfo(pa[p]).digit,topInfo(pv[p]).digit,topInfo(ph[p]).digit,topInfo(pm[p]).digit];
      const agreement=tops.filter(x=>x===best.digit).length/4;
      const marginPower=Math.min(1,best.margin/.07);
      const strength=Math.min(1,agreement*.58+marginPower*.42);
      return {...best,strength,agreement,timeCount:vertical.filter(x=>combo(x)[p]===best.digit).length,dayCount:horizontal.filter(x=>combo(x)[p]===best.digit).length,factorOn:RIGID.has(best.digit)};
    });

    let picks=positions.map(x=>x.digit),stakePositions=[],stakeDigits=[],bet='skip';
    const strengths=positions.map(x=>x.strength),first=Math.min(strengths[0],strengths[1]),last=Math.min(strengths[1],strengths[2]);
    const unordered2=unorderedTop(combined,2),unordered3=unorderedTop(combined,3);
    const meanAgreement=positions.reduce((s,x)=>s+x.agreement,0)/3;
    const exact3Strong=Math.min(...strengths)>=.78&&positions.every(x=>x.agreement>=.75)&&analog.samples>=40;
    if(exact3Strong){
      bet='exact3';stakePositions=[0,1,2];stakeDigits=[...picks];
    }else if(Math.max(first,last)>=.68){
      if(last>first){bet='last2';stakePositions=[1,2]}else{bet='first2';stakePositions=[0,1]}
      stakeDigits=stakePositions.map(i=>picks[i]);
    }else if(unordered2[1]&&unordered2[1].v>=.36&&meanAgreement<.56){
      bet='any2';stakeDigits=unordered2.map(x=>x.d);
    }else if(Math.max(...strengths)>=.58){
      const p=strengths.indexOf(Math.max(...strengths));bet='exact1';stakePositions=[p];stakeDigits=[picks[p]];
    }else if(unordered3.length===3&&unordered3.reduce((s,x)=>s+x.v,0)>=1.12){
      bet='combo6';picks=unordered3.map(x=>x.d);stakePositions=[0,1,2];stakeDigits=[...picks];
    }

    const verticalStrength=sourceSignal(pv),horizontalStrength=sourceSignal(ph),morphStrength=sourceSignal(pm),analogStrength=sourceSignal(pa);
    let suggestedRepeat=verticalStrength>=horizontalStrength?'vertical':'horizontal';
    const remainingToday=scheduleTimes().filter(t=>t>=target.time).length;
    const chosenStrength=bet==='skip'?0:(stakePositions.length?stakePositions.reduce((s,i)=>s+strengths[i],0)/stakePositions.length:meanAgreement);
    const horizontalRepeatCount=bet==='skip'?1:Math.max(1,Math.min(6,remainingToday,Math.round(1+chosenStrength*4)));
    if(suggestedRepeat==='horizontal'&&remainingToday<2)suggestedRepeat='vertical';
    const horizontalTimes=scheduleTimes().filter(t=>t>=target.time).slice(0,horizontalRepeatCount);
    const rigidNow=combo(latest).filter(n=>RIGID.has(n));
    const mode=rigidNow.length?`369-СДВИГ ${rigidNow.join('·')}`:'ВНУТРЕННИЙ МОРФ';
    const factor369=[3,6,9].map(n=>combo(latest).includes(n)?`${n}:ВЫХОД`:`${n}:—`);
    const cost=betCost(bet,picks);
    return {
      target,picks,bet,stakePositions,stakeDigits,cost,positions,
      verticalStrength,horizontalStrength,suggestedRepeat,horizontalRepeatCount,horizontalTimes,
      timeRows:vertical.length,dayRows:horizontal.length,
      verticalWindow:verticalState.size,
      verticalWindows:verticalWindows.sort((a,b)=>a.size-b.size).map(x=>({size:x.size,rows:x.rows.length,signal:Math.round(x.signal*100),structure:Math.round(x.structure*100)})),
      centerMode:`${mode} · B=${latest.b}`,
      factor369,
      verticalSignal:`${Math.round(verticalStrength*100)}% · окно ${verticalState.size || '—'} дней`,
      horizontalSignal:`${Math.round(horizontalStrength*100)}%`,
      mirrorRotation:true,repeatState:false,
      algorithm:`${ALGO} · MORPH ${Math.round(morphStrength*100)}% · ANALOG ${Math.round(analogStrength*100)}% · ${analog.samples} состояний`
    };
  }

  labForecast=detectorForecast;
})();

/* v1.2.1 — immutable detector snapshot in honest archive + full bet selector */
(() => {
  const _detectorForecast=labForecast;

  function detectorSnapshot(f){
    return {
      version:'STATE DETECTOR v1.2.2',
      target:{...f.target},
      forecast:[...f.picks],
      bet:f.bet,
      betLabel:betLabel(f.bet),
      stakePositions:[...f.stakePositions],
      stakeDigits:[...f.stakeDigits],
      cost:f.cost,
      mode:f.centerMode,
      factor369:[...f.factor369],
      verticalSignal:f.verticalSignal,
      verticalWindow:f.verticalWindow||null,
      verticalWindows:(f.verticalWindows||[]).map(x=>({...x})),
      horizontalSignal:f.horizontalSignal,
      algorithm:f.algorithm,
      positions:f.positions.map((p,i)=>({
        position:['A','B','C'][i],digit:p.digit,
        probability:Number((p.p||0).toFixed(5)),
        margin:Number((p.margin||0).toFixed(5)),
        strength:Number((p.strength||0).toFixed(5)),
        agreement:Number((p.agreement||0).toFixed(5)),
        verticalHits:p.timeCount||0,
        horizontalHits:p.dayCount||0,
        rigid369:!!p.factorOn
      })),
      savedAt:new Date().toISOString()
    };
  }

  /* Expand detector choice to all official bet families.
     We keep the original state detector's digits and strengths, but choose
     the product that matches how much of the state is actually resolved. */
  labForecast=function(){
    const f=_detectorForecast();if(!f)return f;
    const s=f.positions.map(x=>x.strength||0);
    const a=f.positions.map(x=>x.agreement||0);
    const first=Math.min(s[0],s[1]),last=Math.min(s[1],s[2]);
    const mean=s.reduce((x,y)=>x+y,0)/3;
    const min=Math.min(...s),max=Math.max(...s);
    const unique=new Set(f.picks).size;

    /* Preserve strong exact signals. For weaker three-digit states,
       switch to order-insensitive or combined products instead of forcing exact3. */
    if(f.bet==='exact3' && min>=.84 && a.every(x=>x>=.75)){
      // strongest possible state: exact order
    }else if(min>=.68 && mean>=.74 && a.filter(x=>x>=.5).length>=2){
      f.bet='exact3Any3';f.stakePositions=[0,1,2];f.stakeDigits=[...f.picks];
    }else if(mean>=.64 && min>=.50 && unique>=2){
      f.bet='any3';f.stakePositions=[0,1,2];f.stakeDigits=[...f.picks];
    }else if(Math.max(first,last)>=.68){
      if(last>first){f.bet='last2';f.stakePositions=[1,2]}else{f.bet='first2';f.stakePositions=[0,1]}
      f.stakeDigits=f.stakePositions.map(i=>f.picks[i]);
    }else if(f.bet==='any2'){
      // unordered two already selected by base detector
    }else if(max>=.58){
      const p=s.indexOf(max);f.bet='exact1';f.stakePositions=[p];f.stakeDigits=[f.picks[p]];
    }else if(mean>=.48 && unique>=2){
      f.bet='combo6';f.stakePositions=[0,1,2];f.stakeDigits=[...f.picks];
    }else{
      f.bet='skip';f.stakePositions=[];f.stakeDigits=[];
    }
    f.cost=betCost(f.bet,f.picks);
    f.detectorState=detectorSnapshot(f);
    return f;
  };

  saveForecast=function(){
    const f=labForecast();if(!f)return;const targets=targetsForRepeat(f);if(!targets.length)return;
    if(state.predictions.some(p=>p.targetDate===f.target.date&&p.targetTime===f.target.time&&p.origin!==false)){toast('Прогноз на этот тираж уже зафиксирован.');return}
    const now=new Date().toISOString(),originId=`lab-${Date.now()}`,total=targets.length;
    const frozenSnapshot=JSON.parse(JSON.stringify(f.detectorState||detectorSnapshot(f)));
    frozenSnapshot.savedAt=now;
    const newRecords=targets.map((t,i)=>({
      id:`${originId}-${i+1}`,originId,origin:i===0,isRepeat:i>0,repeatMode:state.repeatMode,repeatIndex:i+1,repeatTotal:total,
      targetDrawId:t.id,targetDate:t.date,targetTime:t.time,createdAt:now,locked:true,
      forecast:[...f.picks],bet:f.bet,betLabel:betLabel(f.bet),stakePositions:[...f.stakePositions],stakeDigits:[...f.stakeDigits],stakeCost:f.cost,
      matrixState:{center:f.centerMode,factor369:[...f.factor369],verticalSignal:f.verticalSignal,horizontalSignal:f.horizontalSignal,mirrorRotation:f.mirrorRotation,repeatState:f.repeatState,algorithm:f.algorithm},
      detectorSnapshot:JSON.parse(JSON.stringify(frozenSnapshot)),
      fact:null,resultStatus:f.bet==='skip'?'skip':'pending',matchedPositions:[],recommendationWon:null,winAmount:0
    }));
    state.predictions=[...newRecords,...state.predictions];writePredictions();renderLab();toast(`Сохранено записей: ${newRecords.length}. Детектор и прогноз заблокированы.`)
  };

  const _predictionCard=predictionCard;
  predictionCard=function(p){
    let html=_predictionCard(p),snap=p.detectorSnapshot;
    if(!snap)return html;
    const pos=(snap.positions||[]).map(x=>`${x.position}:${x.digit} · сила ${Math.round((x.strength||0)*100)}% · согласие ${Math.round((x.agreement||0)*100)}%`).join(' | ');
    const windows=(snap.verticalWindows||[]).map(x=>`${x.size}д:${x.structure}%`).join(' · ');
    const extra=`<div class="pred-details detector-snapshot"><b>СНИМОК ДЕТЕКТОРА 🔒</b><br>${esc(snap.version||'STATE DETECTOR')} · состояние: <b>${esc(snap.mode||'—')}</b><br>${esc(pos||'—')}<br>Вертикаль: <b>${esc(snap.verticalSignal||'—')}</b> · рабочее окно: <b>${esc(snap.verticalWindow||'—')}</b><br>Окна: <b>${esc(windows||'—')}</b><br>Горизонталь: <b>${esc(snap.horizontalSignal||'—')}</b><br>369: <b>${esc((snap.factor369||[]).join(' / '))}</b><br>${esc(snap.algorithm||'')}</div>`;
    return html.replace('</article>',extra+'</article>');
  };
})();
