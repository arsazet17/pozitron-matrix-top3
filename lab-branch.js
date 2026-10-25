'use strict';

(() => {
  const CORE=window.LabBranchCore;
  if(!CORE)return;
  const UI_KEY='pozitron.lab.branch.ui.v1';
  const ARCHIVE_URL='./branch-archive-top3.json';
  const VERSION='LAB BRANCH v1.11.0';
  const CUTOVER_ID=267756;
  let lastRenderKey='';
  let serverArchive=[];
  let serverUpdatedAt=null;
  let serverLoaded=false;
  let serverError='';

  const $=s=>document.querySelector(s);
  function readJson(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v??fallback}catch(_){return fallback}}
  function writeJson(key,value){localStorage.setItem(key,JSON.stringify(value))}
  const storedUi=readJson(UI_KEY,{});
  const K_KEY='pozitron.lab.branch.k.v1';
  const ui={k:(()=>{try{const v=Number(localStorage.getItem(K_KEY));return [2,3,4].includes(v)?v:2}catch(_){return 2}})(),rows:6,collapsed:storedUi?.collapsed!==false,arrows:storedUi?.arrows===true,archiveOpen:storedUi?.archiveOpen===true||(storedUi?.archiveOpen===undefined&&storedUi?.archiveCollapsed===false)};

  function applyUi(){
    const toggle=$('#branchToggle'),detail=$('#branchDetail'),arrows=$('#branchArrows'),arrowToggle=$('#branchArrowToggle');
    if(toggle){toggle.setAttribute('aria-expanded',String(!ui.collapsed));const ch=toggle.querySelector('.branch-chevron');if(ch)ch.textContent=ui.collapsed?'⌄':'⌃'}
    const hint=$('#branchToggleHint');if(hint)hint.textContent=ui.collapsed?'НАЖАТЬ, ЧТОБЫ РАСКРЫТЬ':'НАЖАТЬ, ЧТОБЫ СВЕРНУТЬ';
    if(detail)detail.hidden=ui.collapsed;
    if(arrows)arrows.hidden=!ui.arrows;
    if(arrowToggle){arrowToggle.textContent=ui.arrows?'Скрыть стрелки':'Показать стрелки';arrowToggle.setAttribute('aria-expanded',String(ui.arrows))}
    const archive=$('#branchArchiveBody'),archiveToggle=$('#branchArchiveToggle');
    if(archive)archive.hidden=!ui.archiveOpen;
    if(archiveToggle){archiveToggle.setAttribute('aria-expanded',String(ui.archiveOpen));archiveToggle.textContent=ui.archiveOpen?'Скрыть архив':'Открыть архив'}
    if(ui.arrows)requestAnimationFrame(centerBranchMatrix);
  }
  function handleClick(event){
    const button=event.target.closest('button');if(!button)return;
    if(button.id==='branchToggle')ui.collapsed=!ui.collapsed;
    else if(button.id==='branchArrowToggle'){ui.arrows=!ui.arrows;ui.collapsed=false}
    else if(button.id==='branchArchiveToggle')ui.archiveOpen=!ui.archiveOpen;
    else if(button.dataset.lb2K){const k=Number(button.dataset.lb2K);if([2,3,4].includes(k)){ui.k=k;try{localStorage.setItem(K_KEY,String(k))}catch(_){}}lastRenderKey='';render();return}
    else if(button.id==='lb2More'){ui.rows=Math.min(60,ui.rows+10);lastRenderKey='';render();return}
    else return;
    applyUi();
    try{writeJson(UI_KEY,ui)}catch(_){/* UI remains usable without storage. */}
  }

  function targetKey(t){return `${t.id||''}|${t.date}|${t.time}`}
  function fmtCombo(a){return (a||[]).join(' · ')}
  function fmtBranch(d,s){return `D${d} S${s>0?'+':''}${s}`}
  function isoLocal(iso){try{return new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch(_){return iso}}
  function readArchive(){return serverArchive}

  async function loadServerArchive(){
    try{
      let data;
      if(window.SmartRefresh){const res=await SmartRefresh.fetchJsonIfChanged(ARCHIVE_URL);if(!res.changed){serverLoaded=true;serverError='';return}data=res.data}
      else{const sep=ARCHIVE_URL.includes('?')?'&':'?';const response=await fetch(`${ARCHIVE_URL}${sep}t=${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`HTTP ${response.status}`);data=await response.json()}
      const records=Array.isArray(data)?data:Array.isArray(data?.records)?data.records:[];
      serverArchive=records;
      serverUpdatedAt=data?.updatedAt||null;
      serverError='';
      serverLoaded=true;
      lastRenderKey='';
      render();
    }catch(error){
      serverLoaded=true;
      serverError=error?.message||String(error);
      lastRenderKey='';
      render();
    }
  }

  function currentTimes(target){
    try{const scheduled=CORE.normalizeTimes(scheduleTimes());if(scheduled.length>=4)return scheduled}catch(_){/* fallback below */}
    return CORE.inferTimes(state.draws||[],target?.date);
  }
  function branchTargetDraw(){
    const list=(state.draws||[]).filter(d=>Number(d.id)>=CUTOVER_ID).sort((a,b)=>Number(b.id)-Number(a.id));
    const latest=list[0]||(state.draws||[])[0];if(!latest)return null;
    const times=currentTimes(latest),i=times.indexOf(latest.time);if(i<0||!times.length)return null;
    if(i<times.length-1)return {id:Number(latest.id)+1,date:latest.date,time:times[i+1]};
    return {id:Number(latest.id)+1,date:CORE.addDays(latest.date,1),time:times[0]};
  }
  function targetEpoch(t){
    if(!t?.date||!t?.time)return NaN;
    const [d,m,y]=String(t.date).split('.').map(Number),[h,n]=String(t.time).split(':').map(Number);
    if([d,m,y,h,n].some(x=>!Number.isFinite(x)))return NaN;
    const yyyy=y<100?2000+y:y;
    return Date.parse(`${String(yyyy).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T${String(h).padStart(2,'0')}:${String(n).padStart(2,'0')}:00+03:00`);
  }
  function targetOpen(t){const ms=targetEpoch(t);return Number.isFinite(ms)&&Date.now()<ms}

  function previewFrozen(target){
    if(!target||!(state.draws||[]).length||!targetOpen(target))return null;
    const times=currentTimes(target),plan=CORE.forecastPlan(state.draws,target,times);if(!plan)return null;
    const p=plan.primary;
    return {
      key:targetKey(target),status:'preview',savedAt:null,previewAt:new Date().toISOString(),engine:`${VERSION} PREVIEW`,serverFrozen:false,storage:'preview-only',
      target:{id:target.id,date:target.date,time:target.time},decision:p.decision,streak:p.streak,
      branch:{d:p.chosen.d,s:p.chosen.s,score:Number(p.chosen.score.toFixed(5)),rate:Number(p.chosen.rate.toFixed(5)),samples:p.chosen.samples},
      source:{date:p.source.date,time:p.source.time,combo:[...p.source.combo]},prediction:[...p.prediction],
      s0:p.s0?{source:{date:p.s0.source.date,time:p.s0.source.time,combo:[...p.s0.source.combo]},prediction:[...p.s0.prediction]}:null,
      extended:p.extended?{d:p.extended.d,s:p.extended.s,hit:p.extended.hit,lastSource:p.extended.lastSource,nextSource:{date:p.extended.nextSource.date,time:p.extended.nextSource.time,combo:[...p.extended.nextSource.combo]}}:null,
      ranking:p.ranking
    };
  }
  function sync(){
    const records=readArchive();
    if(!serverLoaded)return {records,frozen:null,reason:'server-loading'};
    const target=branchTargetDraw();
    const newestPending=records.filter(r=>r.status==='pending'&&r.target).sort((a,b)=>Number(b.target.id||0)-Number(a.target.id||0))[0];
    if(newestPending&&(!target||Number(newestPending.target.id||0)>=Number(target.id||0)))return {records,frozen:newestPending,reason:'server-frozen'};
    if(!target)return {records,frozen:null,reason:'no-target'};
    const existing=records.find(r=>r.key===targetKey(target));
    if(existing)return {records,frozen:existing,reason:'server-frozen'};
    if(serverError&&!records.length)return {records,frozen:null,reason:'server-error'};
    if(!targetOpen(target))return {records,frozen:null,reason:'server-wait'};
    const preview=previewFrozen(target);
    return {records,frozen:preview,reason:preview?'server-preview':'no-plan'};
  }

  function resultClass(r){if(r.status==='pending')return'pending';if(r.hit===2)return'hit';if(r.hit===1)return'part';return'miss'}
  function archiveStats(records){const closed=records.filter(r=>r.status==='closed');return {total:records.length,pending:records.filter(r=>r.status==='pending').length,hit:closed.filter(r=>r.hit===2).length,part:closed.filter(r=>r.hit===1).length,miss:closed.filter(r=>r.hit===0).length}}
  function renderArchive(records){
    const el=$('#branchArchive'),stats=$('#branchArchiveStats');if(!el||!stats)return;const st=archiveStats(records);
    const updated=serverUpdatedAt?` · сервер ${isoLocal(serverUpdatedAt)}`:'';
    stats.innerHTML=`<span>SERVER · branch-archive-top3.json${updated}</span><span>Всего <b>${st.total}</b></span><span class="ok">2/2 <b>${st.hit}</b></span><span class="part">1/2 <b>${st.part}</b></span><span class="bad">0/2 <b>${st.miss}</b></span><span>Ожидают <b>${st.pending}</b></span>`;
    if(serverError&&!records.length){el.innerHTML=`<div class="branch-empty">Не удалось получить серверный архив: ${serverError}</div>`;return}
    if(!records.length){el.innerHTML='<div class="branch-empty">Серверный архив пока пуст. Первая запись появится автоматически перед следующим тиражом.</div>';return}
    el.innerHTML=records.slice(0,60).map(r=>`<article class="branch-archive-row ${resultClass(r)}"><div class="bar-head"><b>${r.target.date} · ${r.target.time}</b><span>${r.status==='pending'?'ОЖИДАЕТ':r.result}</span></div><div class="bar-grid"><div><label>Постановка</label><b>${isoLocal(r.savedAt)}</b></div><div><label>Ветка</label><b>${fmtBranch(r.branch.d,r.branch.s)} · ${r.decision}</b></div><div><label>Источник</label><b>${r.source.date} ${r.source.time} · ${fmtCombo(r.source.combo)}</b></div><div><label>Frozen</label><b>${fmtCombo(r.prediction)}</b></div><div><label>Факт</label><b>${r.fact?fmtCombo(r.fact.combo):'—'}</b></div><div><label>Совпало</label><b>${r.matched?.length?fmtCombo(r.matched):'—'}</b></div></div></article>`).join('');
  }

  function digitHtml(combo,kind='actual'){
    return `<span class="branch-digits ${kind}">${(combo||[]).map((n,i)=>`<i class="p${i}">${n}</i>`).join('')}</span>`;
  }
  function pairHtml(pair,kind){return `<span class="branch-pair ${kind}">${(pair||[]).map(n=>`<i>${n}</i>`).join('')}</span>`}
  function matrixTimes(r){
    const all=currentTimes(r.target),need=[r.source.time,r.target.time,r.s0?.source?.time,r.extended?.nextSource?.time].filter(Boolean);
    const idx=need.map(t=>all.indexOf(t)).filter(i=>i>=0);if(!idx.length)return need;
    let lo=Math.max(0,Math.min(...idx)-1),hi=Math.min(all.length-1,Math.max(...idx)+1);
    if(hi-lo>8){lo=Math.max(0,all.indexOf(r.source.time)-2);hi=Math.min(all.length-1,lo+8);if(all.indexOf(r.target.time)>hi){hi=all.indexOf(r.target.time);lo=Math.max(0,hi-8)}}
    return all.slice(lo,hi+1);
  }
  function branchMatrixHtml(r){
    const times=matrixTimes(r),map=new Map((state.draws||[]).map(d=>[`${d.date}|${d.time}`,d]));
    const rows=[{date:r.target.date,label:'ЦЕЛЬ',kind:'target'}];
    if(!rows.some(x=>x.date===r.source.date))rows.push({date:r.source.date,label:`D${r.branch.d}`,kind:'source'});
    if(r.extended?.nextSource?.date&&!rows.some(x=>x.date===r.extended.nextSource.date))rows.push({date:r.extended.nextSource.date,label:`D${r.extended.d}`,kind:'extended'});
    const LABEL=116,CELL=92,HEAD=38,ROW=76,W=LABEL+CELL*times.length,H=HEAD+ROW*rows.length;
    const col=t=>times.indexOf(t),row=d=>rows.findIndex(x=>x.date===d),cx=t=>LABEL+col(t)*CELL+CELL/2,cy=d=>HEAD+row(d)*ROW+ROW/2;
    const tx=cx(r.target.time),ty=cy(r.target.date);
    const paths=[];
    if(col(r.source.time)>=0&&row(r.source.date)>=0)paths.push(`<path class="bm-line main" d="M ${cx(r.source.time)} ${cy(r.source.date)-4} C ${(cx(r.source.time)+tx)/2} ${cy(r.source.date)-34}, ${(cx(r.source.time)+tx)/2} ${ty-34}, ${tx} ${ty-9}" marker-end="url(#bmMain)"/>`);
    if(r.s0&&col(r.s0.source.time)>=0&&row(r.s0.source.date)>=0)paths.push(`<path class="bm-line control" d="M ${cx(r.s0.source.time)} ${cy(r.s0.source.date)+12} C ${(cx(r.s0.source.time)+tx)/2} ${cy(r.s0.source.date)+42}, ${(cx(r.s0.source.time)+tx)/2} ${ty+38}, ${tx} ${ty+16}" marker-end="url(#bmControl)"/>`);
    if(r.extended?.nextSource&&col(r.extended.nextSource.time)>=0&&row(r.extended.nextSource.date)>=0)paths.push(`<path class="bm-line extended" d="M ${cx(r.extended.nextSource.time)} ${cy(r.extended.nextSource.date)} C ${(cx(r.extended.nextSource.time)+tx)/2} ${cy(r.extended.nextSource.date)-18}, ${(cx(r.extended.nextSource.time)+tx)/2} ${ty+50}, ${tx} ${ty+28}" marker-end="url(#bmExtended)"/>`);
    const header=`<div class="bm-corner"></div>${times.map(t=>`<div class="bm-time ${t===r.target.time?'target-time':''}">${t}</div>`).join('')}`;
    const body=rows.map(ro=>{
      const cells=times.map(t=>{
        const d=map.get(`${ro.date}|${t}`),isTarget=ro.date===r.target.date&&t===r.target.time,isMain=ro.date===r.source.date&&t===r.source.time,isS0=r.s0&&ro.date===r.s0.source.date&&t===r.s0.source.time,isExt=r.extended?.nextSource&&ro.date===r.extended.nextSource.date&&t===r.extended.nextSource.time;
        let cls='bm-cell',inside=d?digitHtml(CORE.combo(d)):'<span class="bm-empty">—</span>';
        if(isMain)cls+=' main-source';if(isS0)cls+=' control-source';if(isExt)cls+=' extended-source';
        if(isTarget){cls+=' target-cell';inside=`<small>ОСНОВНАЯ</small>${pairHtml(r.prediction,'main')}${r.s0?`<small>S0</small>${pairHtml(r.s0.prediction,'control')}`:''}`}
        return `<div class="${cls}" data-time="${t}" data-date="${ro.date}">${inside}</div>`;
      }).join('');
      return `<div class="bm-row-label"><b>${ro.label}</b><span>${ro.date}</span></div>${cells}`;
    }).join('');
    return `<section class="branch-visual"><div class="branch-visual-head"><div><b>Схема ветки по матрице</b><span>${fmtBranch(r.branch.d,r.branch.s)} · ${r.decision} · streak ${r.streak}</span></div><span class="branch-visual-note">стрелки идут между реальными ячейками</span></div><div class="branch-visual-summary"><div><label>Источник</label><b>${r.source.date} ${r.source.time}</b>${digitHtml(r.source.combo)}</div><div><label>Прогноз ${r.target.time}</label>${pairHtml(r.prediction,'main')}</div>${r.s0?`<div><label>Контроль D${r.branch.d} S0</label><b>${r.s0.source.time}</b>${pairHtml(r.s0.prediction,'control')}</div>`:''}</div><div class="branch-matrix-scroll"><div class="branch-matrix-stage" style="--bm-cols:${times.length};width:${W}px;height:${H}px"><div class="branch-matrix-grid" style="grid-template-columns:${LABEL}px repeat(${times.length},${CELL}px);grid-template-rows:${HEAD}px repeat(${rows.length},${ROW}px)">${header}${body}</div><svg class="branch-matrix-lines" viewBox="0 0 ${W} ${H}" aria-label="Линии веток"><defs><marker id="bmMain" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"/></marker><marker id="bmControl" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"/></marker><marker id="bmExtended" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z"/></marker></defs>${paths.join('')}</svg></div></div><div class="branch-visual-legend"><span class="main">Основная ветка ${fmtBranch(r.branch.d,r.branch.s)}</span>${r.s0?`<span class="control">Контроль D${r.branch.d} S0</span>`:''}${r.extended?`<span class="extended">Дальняя нить D${r.extended.d} S${r.extended.s>0?'+':''}${r.extended.s}</span>`:''}</div></section>`;
  }
  function centerBranchMatrix(){
    const sc=$('.branch-matrix-scroll'),cell=$('.bm-cell.target-cell');if(!sc||!cell)return;
    const left=Math.max(0,cell.offsetLeft-sc.clientWidth*.62);sc.scrollTo({left,behavior:'smooth'});
  }


  // ---- LAB VIEW v1.9: главное сверху, итог, лента, честный счёт, открытый архив ----
  const CHANCE={2:[48.8,5.4],3:[65.7,15.0],4:[78.4,27.6]};
  // Расширение прогноза до k цифр только из данных, замороженных до тиража:
  // 2 цифры движка → оставшиеся цифры источника (3-я по рейтингу движка) → контроль S0 → дальняя нить → по возрастанию.
  function predK(r,k){if(k===2&&Array.isArray(r.prediction)&&r.prediction.length===2)return r.prediction.map(Number);const out=[];const add=a=>{for(const n of (a||[])){const x=Number(n);if(Number.isInteger(x)&&x>=0&&x<=9&&!out.includes(x)&&out.length<k)out.push(x)}};add(r.prediction);add(r.source?.combo);add(r.s0?.prediction);add(r.s0?.source?.combo);add(r.extended?.nextSource?.combo);add([0,1,2,3,4,5,6,7,8,9]);return out}
  function evalK(r,k){const p=predK(r,k),left=[...(r.fact?.combo||[])].map(Number);const matched=p.filter(n=>{const i=left.indexOf(n);if(i<0)return false;left.splice(i,1);return true});return {pred:p,matched,hit:matched.length,result:`${matched.length}/${k}`}}
  function closedRecords(records){return (records||[]).filter(r=>r.status==='closed'&&r.target).sort((a,b)=>Number(b.target.id||0)-Number(a.target.id||0))}
  function hlDigits(combo,matched,cls){const left=[...(matched||[])];return `<span class="lb2-digs">${(combo||[]).map(n=>{const i=left.indexOf(n);if(i>=0){left.splice(i,1);return `<i class="m ${cls}">${n}</i>`}return `<i>${n}</i>`}).join('')}</span>`}
  function hlPrediction(pred,matched,cls){const set=new Set(matched||[]);return `<span class="lb2-digs">${(pred||[]).map(n=>`<i class="${set.has(n)?'m '+cls:''}">${n}</i>`).join('')}</span>`}
  function chip(e){const h=Number(e?.hit);const cls=h>=2?'hit':h===1?'part':'miss';return `<span class="lb2-chip ${cls}">${e?.result||'—'}</span>`}
  function rateLine(label,part,all,chance,cls){const p=part.n?part.k/part.n*100:0,a=all.n?all.k/all.n*100:0;return `<div class="lb2-rate"><div class="lb2-rate-text">${label}: <b>${part.n?Math.round(p):'—'}%</b> / <b>${all.n?a.toFixed(1):'—'}%</b> <span>· наугад ${String(chance).replace('.',',')}%</span></div><div class="lb2-bar"><div class="lb2-fill ${cls}" style="width:${Math.min(100,p)}%"></div><div class="lb2-chance" style="left:${chance}%"></div></div></div>`}
  function countdownHtml(t,id){const ms=targetEpoch(t);return `<span id="${id}" class="lb2-countdown" data-epoch="${Number.isFinite(ms)?ms:''}"></span>`}
  function tickCountdowns(){document.querySelectorAll('.lb2-countdown[data-epoch]').forEach(el=>{const ms=Number(el.dataset.epoch);if(!Number.isFinite(ms)||!el.dataset.epoch){el.textContent='';return}const left=ms-Date.now();let txt;if(left>60000)txt=`⏱ через ${Math.floor(left/60000)} мин`;else if(left>0)txt='⏱ меньше минуты';else txt='⏳ тираж прошёл — ждём результат и новый прогноз';if(el.textContent!==txt)el.textContent=txt;el.classList.toggle('late',left<=0)})}
  function overviewHtml(frozen,records){
    const closed=closedRecords(records),last=closed[0],serverFrozen=frozen&&frozen.serverFrozen===true&&frozen.status!=='preview';
    const placed=serverFrozen&&frozen.savedAt?`зафиксирован ${new Date(frozen.savedAt).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'})}`:'предпросмотр · ждём фиксацию на сервере';
    const hero=frozen?`<section class="lb2-hero"><div class="lb2-hero-text"><small>СЛЕДУЮЩИЙ ТИРАЖ</small><b class="lb2-time">${frozen.target.time}</b><span class="lb2-sub">№${frozen.target.id||'—'} · ${frozen.target.date}</span>${countdownHtml(frozen.target,'lb2Countdown')}<span class="lb2-placed">${placed}</span></div><div class="lb2-pickwrap"><div class="lb2-big k${ui.k}">${predK(frozen,ui.k).map(n=>`<i>${n}</i>`).join('')}</div><div class="lb2-kswitch" role="group" aria-label="Сколько цифр в прогнозе"><span>цифр</span>${[2,3,4].map(k=>`<button type="button" data-lb2-k="${k}" class="${ui.k===k?'active':''}" aria-pressed="${ui.k===k}">${k}</button>`).join('')}</div></div></section>`:'';
    const lastHtml=last?`<section class="lb2-box lb2-last"><small>ПРОШЛЫЙ ТИРАЖ · ${last.target.time} · ${last.target.date}</small><div class="lb2-last-row"><span class="lb2-lbl">выпало</span>${hlDigits(last.fact?.combo,evalK(last,ui.k).matched,'g')}<span class="lb2-lbl">ставили</span>${hlPrediction(evalK(last,ui.k).pred,evalK(last,ui.k).matched,'g')}${chip(evalK(last,ui.k))}</div></section>`:'';
    const tail=closed.slice(0,frozen?11:12).reverse();
    const cells=tail.map(r=>{const e=evalK(r,ui.k),h=e.hit;return `<i class="${h>=2?'hit':h===1?'part':'miss'}" title="${r.target.time} · ${e.result}"></i>`}).join('')+(frozen?'<i class="wait" title="ждём"></i>':'');
    const ribbon=tail.length?`<section class="lb2-box"><small>ПОСЛЕДНИЕ ${tail.length+(frozen?1:0)} · старые слева → новые справа</small><div class="lb2-ribbon">${cells}</div><div class="lb2-legend"><span><i class="hit"></i>2+</span><span><i class="part"></i>1</span><span><i class="miss"></i>0</span>${frozen?'<span><i class="wait"></i>ждём</span>':''}</div></section>`:'';
    const cnt=(list,f)=>({n:list.length,k:list.filter(f).length}),l50=closed.slice(0,50);
    const hk=r=>evalK(r,ui.k).hit,[c1,c2]=CHANCE[ui.k];
    const score=closed.length?`<section class="lb2-box"><small>ЧЕСТНЫЙ СЧЁТ · ${ui.k} цифры · последние ${l50.length} / весь архив ${closed.length}</small>${rateLine('Хотя бы 1 цифра',cnt(l50,r=>hk(r)>=1),cnt(closed,r=>hk(r)>=1),c1,'part')}${rateLine(ui.k===2?'Обе цифры':'2 цифры и больше',cnt(l50,r=>hk(r)>=2),cnt(closed,r=>hk(r)>=2),c2,'hit')}<div class="lb2-note">белая черта — уровень «наугад»</div></section>`:'';
    const rows=closed.slice(0,ui.rows).map(r=>{const e=evalK(r,ui.k),c=e.hit>=2?'g':'y';return `<div class="lb2-tr k${ui.k}"><b>${r.target.time}<em>${r.target.date.slice(0,5)}</em></b>${hlPrediction(e.pred,e.matched,c)}${hlDigits(r.fact?.combo,e.matched,c)}${chip(e)}</div>`}).join('');
    const table=closed.length?`<section class="lb2-box lb2-table"><small>АРХИВ · последние ${Math.min(ui.rows,closed.length)} · совпавшие цифры подсвечены</small><div class="lb2-th k${ui.k}"><span>время</span><span>прогноз</span><span>выпало</span><span>итог</span></div>${rows}${closed.length>ui.rows&&ui.rows<60?'<button id="lb2More" type="button" class="lb2-more">Показать ещё ›</button>':''}</section>`:'';
    return hero+lastHtml+ribbon+score+table;
  }

  function renderForecast(frozen,reason){
    const root=$('#branchForecast');if(!root)return;
    if(!frozen){
      const msg=reason==='server-loading'?'Загружаю branch-archive-top3.json…':reason==='server-error'?`Серверный архив временно недоступен: ${serverError}`:reason==='server-wait'?'Время следующего тиража уже наступило. Ждём новый факт и серверную фиксацию следующего прогноза.':'Недостаточно данных для постановки.';
      root.innerHTML=`<div class="branch-empty lb2-msg">${msg}</div>${overviewHtml(null,readArchive())}<div class="branch-card"><button id="branchToggle" type="button" class="branch-summary" aria-controls="branchDetail"><span><b>⚙ Как выбран прогноз</b><small>Открыть состояние прогноза</small></span><span class="branch-chevron"></span></button><div id="branchDetail" class="branch-detail"><div class="branch-empty">${msg}</div></div></div>`;applyUi();tickCountdowns();return;
    }
    const s0=frozen.s0,serverFrozen=frozen.serverFrozen===true&&frozen.status!=='preview';
    const storageText=serverFrozen?'SERVER FROZEN · branch-archive-top3.json':'ПРЕДПРОСМОТР · ждём SERVER FROZEN';
    const placedText=serverFrozen&&frozen.savedAt?isoLocal(frozen.savedAt):'ещё не записан на сервер';
    root.innerHTML=`${overviewHtml(frozen,readArchive())}<div class="branch-card lb2-tech"><button id="branchToggle" class="branch-summary" type="button" aria-controls="branchDetail"><span><b>⚙ Как выбран прогноз</b><small><span id="branchToggleHint"></span> · ветка ${fmtBranch(frozen.branch.d,frozen.branch.s)} · ${frozen.decision} · источник ${frozen.source.date} ${frozen.source.time}</small></span><span class="branch-chevron">${ui.collapsed?'⌄':'⌃'}</span></button><div id="branchDetail" class="branch-detail"><div class="branch-meta-grid"><div><label>Целевой тираж</label><b>№${frozen.target.id||'—'} · ${frozen.target.date} ${frozen.target.time}</b></div><div><label>Время постановки</label><b>${placedText}</b></div><div><label>Решение</label><b>${frozen.decision} · streak ${frozen.streak}</b></div><div><label>Источник</label><b>${frozen.source.date} ${frozen.source.time} · ${fmtCombo(frozen.source.combo)}</b></div><div><label>Прогноз 2 цифры</label><b class="branch-two">${fmtCombo(frozen.prediction)}</b></div><div><label>Архивный score</label><b>${Math.round((frozen.branch.rate||0)*100)}% · n=${frozen.branch.samples}</b></div></div>${s0?`<section class="branch-control-card"><h3>Контроль того же D с S0</h3><div class="bcc-source"><label>Источник</label><b>${s0.source.date} ${s0.source.time} · ${fmtCombo(s0.source.combo)}</b></div><div class="bcc-param"><label>Параметр</label><b><span>D${frozen.branch.d}</span><span>S0</span></b></div><div class="bcc-pick"><label>Контрольные цифры</label>${pairHtml(s0.prediction,'control')}</div></section>`:''}<div class="branch-actions"><button id="branchArrowToggle" aria-controls="branchArrows" type="button" class="secondary-btn">${ui.arrows?'Скрыть стрелки':'Показать стрелки'}</button><span>${storageText}</span></div><div id="branchArrows">${branchMatrixHtml(frozen)}</div></div></div>`;
    applyUi();tickCountdowns();
  }

  function render(){
    if(typeof state==='undefined'||!Array.isArray(state.draws))return;
    const {records,frozen,reason}=sync();
    const rk=`${state.draws[0]?.id||0}|${serverUpdatedAt||''}|${serverError}|${records.length}|${frozen?.key||''}|${reason||''}|${records.map(r=>r.status+':'+r.result).join(',')}`;
    if(rk===lastRenderKey&&$('#branchForecast')?.children.length){applyUi();return}
    lastRenderKey=rk;renderForecast(frozen,reason);renderArchive(records);
    const test=CORE.selfTest(),badge=$('#branchSelfTest');if(badge){badge.textContent=test.pass?'SELF-TEST PASS':'SELF-TEST FAIL';badge.className=`branch-selftest ${test.pass?'pass':'fail'}`}
  }
  function syncControls(){const lab=$('#labView'),c=$('.controls');if(lab&&c){const on=lab.classList.contains('active');if(c.hidden!==on)c.hidden=on}}
  function boot(){
    const root=$('#labView');if(root)root.addEventListener('click',handleClick);
    if(root&&'MutationObserver' in window)new MutationObserver(()=>{syncControls();render()}).observe(root,{attributes:true,attributeFilter:['class']});
    document.addEventListener('top3:data',()=>{lastRenderKey='';render()});
    syncControls();setInterval(tickCountdowns,1000);
    applyUi();render();loadServerArchive();
    // Тиражи раз в 30 минут: перерисовка раз в 30 с, проверка архива раз в минуту (304, если не менялся).
    setInterval(render,30000);
    if(window.SmartRefresh)SmartRefresh.every(loadServerArchive,60000);else setInterval(loadServerArchive,60000);
    const refresh=$('#refreshBtn');if(refresh)refresh.addEventListener('click',()=>{setTimeout(render,600);setTimeout(loadServerArchive,900)});
    window.addEventListener('resize',()=>{if(ui.arrows)centerBranchMatrix()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.LabBranch={render,readArchive,loadServerArchive,selfTest:CORE.selfTest,targetOpen,branchTargetDraw,archiveSource:ARCHIVE_URL};
})();
