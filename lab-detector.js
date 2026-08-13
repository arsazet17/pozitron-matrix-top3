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
      version:'STATE DETECTOR v1.2.9',
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

  function syncPredictionsFromStorage(){
    // v1.2.8: LAB archive never reads localStorage.
    return state.predictions;
  }

  const ARCHIVE_DB='pozitron.matrix.lab.archive.v1';
  const ARCHIVE_STORE='records';
  function openArchiveDb(){
    return new Promise((resolve,reject)=>{
      if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return}
      const req=indexedDB.open(ARCHIVE_DB,1);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(ARCHIVE_STORE))db.createObjectStore(ARCHIVE_STORE,{keyPath:'id'})};
      req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
    });
  }
  async function idbWriteRecords(records){
    const db=await openArchiveDb();
    try{await new Promise((resolve,reject)=>{const tx=db.transaction(ARCHIVE_STORE,'readwrite'),st=tx.objectStore(ARCHIVE_STORE);records.forEach(r=>st.put(r));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}finally{db.close()}
  }
  async function idbReadRecords(){
    const db=await openArchiveDb();
    try{return await new Promise((resolve,reject)=>{const tx=db.transaction(ARCHIVE_STORE,'readonly'),req=tx.objectStore(ARCHIVE_STORE).getAll();req.onsuccess=()=>resolve(Array.isArray(req.result)?req.result:[]);req.onerror=()=>reject(req.error||new Error('IndexedDB read failed'))})}finally{db.close()}
  }
  async function restoreArchiveFromIdb(){
    try{
      const rows=await idbReadRecords();
      state.predictions=Array.isArray(rows)?rows:[];
      renderStats();renderArchive();
    }catch(err){
      state.predictions=[];
      renderStats();renderArchive();
      toast('ОШИБКА: архив IndexedDB недоступен.');
    }
  }

  // LAB archive is IndexedDB-only. Never read or write localStorage.
  readPredictions=function(){return state.predictions};
  writePredictions=function(){
    const snapshot=JSON.parse(JSON.stringify(state.predictions||[]));
    idbWriteRecords(snapshot).catch(()=>toast('ОШИБКА: не удалось обновить архив IndexedDB.'));
  };
  setTimeout(restoreArchiveFromIdb,0);

  function hasSavedSource(date,time,mode){
    return state.predictions.some(p=>{
      if(!p||p.origin===false)return false;
      const sameMode=(p.repeatMode||'none')===(mode||'none');
      if(!sameMode)return false;
      if(p.sourceTargetDate&&p.sourceTargetTime){
        return p.sourceTargetDate===date&&p.sourceTargetTime===time;
      }
      return p.origin===true&&p.targetDate===date&&p.targetTime===time;
    });
  }

  saveForecast=async function(){
    const f=labForecast();if(!f)return;
    const targets=state.repeatMode==='vertical'
      ? [{id:null,date:addDays(f.target.date,1),time:f.target.time}]
      : targetsForRepeat(f);
    if(!targets.length)return;
    try{
      const persisted=await idbReadRecords();
      state.predictions=Array.isArray(persisted)?persisted:[];
    }catch(err){toast('ОШИБКА: архив IndexedDB недоступен.');return}
    if(hasSavedSource(f.target.date,f.target.time,state.repeatMode)){
      renderStats();renderArchive();
      toast('Этот режим прогноза уже зафиксирован. Другой режим можно сохранить отдельно.');
      return
    }
    const now=new Date().toISOString(),originId=`lab-${Date.now()}`,total=targets.length;
    const frozenSnapshot=JSON.parse(JSON.stringify(f.detectorState||detectorSnapshot(f)));
    frozenSnapshot.savedAt=now;
    const newRecords=targets.map((t,i)=>({
      id:`${originId}-${i+1}`,originId,origin:i===0,isRepeat:i>0,repeatMode:state.repeatMode,repeatIndex:i+1,repeatTotal:total,
      sourceTargetDate:f.target.date,sourceTargetTime:f.target.time,
      sourceForecastKey:`${f.target.date}|${f.target.time}|${f.picks.join('')}|${f.bet}|${state.repeatMode}`,
      targetDrawId:t.id,targetDate:t.date,targetTime:t.time,createdAt:now,locked:true,
      forecast:[...f.picks],bet:f.bet,betLabel:betLabel(f.bet),stakePositions:[...f.stakePositions],stakeDigits:[...f.stakeDigits],stakeCost:f.cost,
      matrixState:{center:f.centerMode,factor369:[...f.factor369],verticalSignal:f.verticalSignal,horizontalSignal:f.horizontalSignal,mirrorRotation:f.mirrorRotation,repeatState:f.repeatState,algorithm:f.algorithm},
      detectorSnapshot:JSON.parse(JSON.stringify(frozenSnapshot)),
      fact:null,resultStatus:f.bet==='skip'?'skip':'pending',matchedPositions:[],recommendationWon:null,winAmount:0
    }));

    // IndexedDB is the only source of truth for the LAB archive.
    const before=[...state.predictions];
    state.predictions=[...newRecords,...before.filter(old=>!newRecords.some(n=>n.id===old.id))];
    let verified=false;
    try{
      await idbWriteRecords(state.predictions);
      const stored=await idbReadRecords();
      const savedIds=new Set(stored.map(p=>p&&p.id));
      verified=newRecords.every(p=>savedIds.has(p.id));
      if(verified)state.predictions=stored;
    }catch(err){verified=false}
    if(!verified){
      state.predictions=before;
      toast('ОШИБКА: прогноз не записан в IndexedDB.');
      return
    }

    applyFacts(false);
    renderStats();
    renderArchive();
    renderLab();
    toast(`СОХРАНЕНО В АРХИВ: ${newRecords.length} · IndexedDB. Всего: ${state.predictions.length}.`)
  };

  // v1.3.1: mode-aware save button.
  // A saved horizontal package must not block a vertical package from the same source forecast.
  const _renderRepeatControlsModeAware=renderRepeatControls;
  renderRepeatControls=function(f){
    _renderRepeatControlsModeAware(f);

    const btn=$('#saveForecastBtn');
    if(!btn||!f)return;

    const duplicateSameMode=hasSavedSource(f.target.date,f.target.time,state.repeatMode);
    btn.disabled=duplicateSameMode;

    if(duplicateSameMode){
      const modeName=state.repeatMode==='vertical'
        ? 'ВЕРТИКАЛЬ УЖЕ СОХРАНЕНА'
        : state.repeatMode==='horizontal'
          ? 'ГОРИЗОНТАЛЬ УЖЕ СОХРАНЕНА'
          : 'ПРОГНОЗ УЖЕ СОХРАНЁН';
      btn.textContent=`🔒 ${modeName}`;
    }else{
      btn.textContent='🔒 СОХРАНИТЬ ПРОГНОЗ ДО ТИРАЖА';
    }
  };

  // Archive/statistics render only the in-memory mirror loaded from IndexedDB.
  const _renderStatsPersisted=renderStats;
  renderStats=function(){return _renderStatsPersisted()};
  const _renderArchivePersisted=renderArchive;
  renderArchive=function(){return _renderArchivePersisted()};

  /* v1.3.1 — IndexedDB-only archive + mode-aware vertical save.
     Keep the full detector snapshot frozen in storage, but never dump it into the archive UI.
     The archive shows only: target forecast, AI bet, fact, and result/payout. */
  const detectorArchiveStyle=document.createElement('style');
  detectorArchiveStyle.textContent=`
    .prediction-card{padding:14px!important}
    .prediction-card .pred-head{margin-bottom:12px}
    .prediction-card .pred-mode{display:none!important}
    .archive-clean-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .archive-clean-box{padding:13px 14px;border:1px solid rgba(120,190,225,.22);border-radius:14px;background:rgba(4,20,34,.28);min-width:0}
    .archive-clean-label{font-size:11px;letter-spacing:.09em;color:#9eb0bf;font-weight:800;margin-bottom:8px}
    .archive-clean-digits{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-height:44px}
    .archive-clean-digit{display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:42px;padding:0 10px;border:1px solid rgba(74,198,255,.42);border-radius:11px;background:rgba(12,63,97,.48);font-size:24px;font-weight:900;color:#fff}
    .archive-ai-bet{font-size:17px;font-weight:900;color:#fff;margin-bottom:7px}
    .archive-result-main{font-size:18px;font-weight:900;line-height:1.3}
    .archive-result-amount{font-size:26px;font-weight:950;line-height:1.2;margin-top:5px}
    .archive-result-win .archive-result-main,.archive-result-win .archive-result-amount{color:#7df2a1}
    .archive-result-loss .archive-result-main{color:#ff9b9b}
    .archive-result-pending .archive-result-main{color:#ffd37d}
    .archive-result-skip .archive-result-main{color:#b8c5ce}
    .archive-fact-empty{font-size:18px;font-weight:800;color:#9eb0bf}
    .archive-clean-digit.hit{color:#78f39a;border-color:rgba(70,230,120,.62);background:rgba(20,105,55,.40)}
    .archive-clean-digit.miss{color:#ff8f8f;border-color:rgba(255,90,90,.55);background:rgba(105,28,35,.38)}
    .archive-package{border:2px solid rgba(70,210,120,.58);border-radius:16px;background:rgba(4,18,31,.50);overflow:hidden;margin:0 0 12px;box-shadow:0 0 0 1px rgba(70,210,120,.08) inset}
    .archive-package>summary{list-style:none;cursor:pointer;padding:15px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:rgba(13,55,42,.48)}
    .archive-package.vertical-next{border-color:rgba(171,112,66,.82);box-shadow:0 0 0 1px rgba(171,112,66,.12) inset}
    .archive-package.vertical-next>summary{background:rgba(82,48,28,.58)}
    .archive-package.vertical-next .archive-package-title{color:#efc29d}
    .archive-package.vertical-next .archive-package-arrow{color:#d99a69}
    .archive-next-badge{display:inline-block;margin-top:6px;padding:3px 8px;border:1px solid rgba(190,126,77,.55);border-radius:999px;color:#efc29d;background:rgba(89,50,27,.36);font-size:10px;font-weight:900;letter-spacing:.06em}
    .archive-package>summary::-webkit-details-marker{display:none}
    .archive-package-title{font-size:16px;font-weight:950;color:#fff}
    .archive-package-meta{margin-top:4px;font-size:12px;color:#9eb0bf;font-weight:700}
    .archive-package-arrow{font-size:20px;color:#71d7ff;transition:transform .18s ease}
    .archive-package[open] .archive-package-arrow{transform:rotate(180deg)}
    .archive-package-body{padding:12px}
    .archive-package-body .prediction-card{margin:0 0 10px}
    .archive-package-body .prediction-card:last-child{margin-bottom:0}
    @media(max-width:700px){
      .archive-clean-grid{grid-template-columns:1fr}
      .archive-clean-digit{min-width:46px;height:46px;font-size:27px}
      .archive-result-main{font-size:19px}
      .archive-result-amount{font-size:28px}
    }
  `;
  document.head.appendChild(detectorArchiveStyle);

  function positionalClasses(forecast,fact){
    const f=Array.isArray(forecast)?forecast:[],a=Array.isArray(fact)?fact:[];
    return f.map((n,i)=>a.length?(n===a[i]?'hit':'miss'):'');
  }

  function unorderedClasses(values,fact){
    const vals=Array.isArray(values)?values:[],pool=Array.isArray(fact)?[...fact]:[];
    if(!pool.length)return vals.map(()=> '');
    return vals.map(n=>{const i=pool.indexOf(n);if(i<0)return'miss';pool.splice(i,1);return'hit'});
  }

  function aiClasses(p){
    if(!p.fact||p.bet==='skip')return (p.stakeDigits||[]).map(()=> '');
    const vals=Array.isArray(p.stakeDigits)?p.stakeDigits:[];
    if(p.bet==='first2')return vals.map((n,i)=>n===p.fact[i]?'hit':'miss');
    if(p.bet==='last2')return vals.map((n,i)=>n===p.fact[i+1]?'hit':'miss');
    if(p.bet==='exact1')return vals.map((n,i)=>{const pos=(p.stakePositions||[])[i];return Number.isInteger(pos)&&n===p.fact[pos]?'hit':'miss'});
    if(p.bet==='exact3')return vals.map((n,i)=>n===p.fact[i]?'hit':'miss');
    return unorderedClasses(vals,p.fact);
  }

  function archiveDigits(values, classes=[]){
    const arr=Array.isArray(values)?values:[];
    return arr.length?arr.map((n,i)=>`<span class="archive-clean-digit ${classes[i]||''}">${esc(n)}</span>`).join(''):'<span class="archive-fact-empty">—</span>';
  }

  function archiveResult(p){
    if(!p.fact){
      return `<div class="archive-result-pending"><div class="archive-result-main">ОЖИДАЕТ ТИРАЖА</div><div class="archive-result-amount">—</div></div>`;
    }
    if(p.bet==='skip'||p.resultStatus==='skip'){
      return `<div class="archive-result-skip"><div class="archive-result-main">ПРОПУСК</div><div class="archive-result-amount">0 ₽</div></div>`;
    }
    const amount=Number(p.winAmount||0);
    const won=p.recommendationWon===true||amount>0||p.resultStatus==='win'||p.resultStatus==='won';
    if(won){
      return `<div class="archive-result-win"><div class="archive-result-main">ВЫИГРАЛ</div><div class="archive-result-amount">${rub(amount)}</div></div>`;
    }
    return `<div class="archive-result-loss"><div class="archive-result-main">НЕ ВЫИГРАЛ</div><div class="archive-result-amount">0 ₽</div></div>`;
  }

  predictionCard=function(p){
    const targetClasses=positionalClasses(p.forecast,p.fact);
    const targetDigits=archiveDigits(p.forecast,targetClasses);
    const stakeDigits=p.bet==='skip'?[]:(Array.isArray(p.stakeDigits)?p.stakeDigits:[]);
    const aiDigits=p.bet==='skip'?'<span class="archive-fact-empty">СТАВКИ НЕТ</span>':archiveDigits(stakeDigits,aiClasses(p));
    const factDigits=archiveDigits(p.fact||[]);
    const betName=esc(p.betLabel||betLabel(p.bet)||'—');
    return `<article class="prediction-card ${esc(p.resultStatus||'pending')}">
      <div class="pred-head">
        <div><div class="pred-title">${esc(p.targetTime)} · ${esc(p.targetDate)}${p.targetDrawId?` · №${esc(p.targetDrawId)}`:''}</div></div>
        <div class="pred-lock">🔒</div>
      </div>
      <div class="archive-clean-grid">
        <div class="archive-clean-box">
          <div class="archive-clean-label">ЦЕЛЕВОЙ ПРОГНОЗ</div>
          <div class="archive-clean-digits">${targetDigits}</div>
        </div>
        <div class="archive-clean-box">
          <div class="archive-clean-label">ПРОГНОЗ ИИ / СТАВКА</div>
          <div class="archive-ai-bet">${betName}</div>
          <div class="archive-clean-digits">${aiDigits}</div>
        </div>
        <div class="archive-clean-box">
          <div class="archive-clean-label">ФАКТ</div>
          <div class="archive-clean-digits">${factDigits}</div>
        </div>
        <div class="archive-clean-box">
          <div class="archive-clean-label">РЕЗУЛЬТАТ</div>
          ${archiveResult(p)}
        </div>
      </div>
    </article>`;
  };

  function packageTime(iso){
    const d=new Date(iso);if(Number.isNaN(d.getTime()))return'—';
    return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
  }

  function packageMadeDate(iso){
    const d=new Date(iso);if(Number.isNaN(d.getTime()))return'—';
    return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'});
  }

  function packageCard(rows){
    const sorted=[...rows].sort((a,b)=>(a.repeatIndex||1)-(b.repeatIndex||1));
    const first=sorted[0]||{};
    const count=sorted.length;
    const date=esc(first.targetDate||'—');
    const made=packageTime(first.createdAt);
    const madeDate=packageMadeDate(first.createdAt);
    const start=sorted[0]?.targetTime||'—',finish=sorted[sorted.length-1]?.targetTime||'—';
    const range=count>1?`${start}–${finish}`:start;
    const vertical=first.repeatMode==='vertical';
    const title=vertical
      ? `${date} · ↑ ВЕРТИКАЛЬ · ${esc(start)}`
      : `${date} · ПАКЕТ ${count} ${drawWord(count).toUpperCase()}`;
    const meta=vertical
      ? `Прогноз зафиксирован: ${esc(madeDate)} в ${esc(made)}`
      : `Прогноз зафиксирован: ${esc(made)} · ${esc(range)}`;
    const badge=vertical?`<span class="archive-next-badge">СЛЕДУЮЩИЙ ДЕНЬ</span>`:'';
    return `<details class="archive-package ${vertical?'vertical-next':'today-package'}">
      <summary>
        <div>
          <div class="archive-package-title">${title}</div>
          <div class="archive-package-meta">${meta}</div>
          ${badge}
        </div>
        <span class="archive-package-arrow">⌄</span>
      </summary>
      <div class="archive-package-body">${sorted.map(predictionCard).join('')}</div>
    </details>`;
  }

  renderArchive=function(){
    if(!$('#labArchive'))return;
    let list=[...state.predictions].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)||(b.repeatIndex||1)-(a.repeatIndex||1));
    if(state.archiveFilter!=='all')list=list.filter(p=>p.resultStatus===state.archiveFilter);
    const groups=new Map();
    for(const p of list){const key=p.originId||p.id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(p)}
    $('#labArchive').innerHTML=groups.size?[...groups.values()].map(packageCard).join(''):'<div class="archive-empty">В этом фильтре записей пока нет.</div>';
    $$('#archiveFilters button').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.archiveFilter));
  };

})();
