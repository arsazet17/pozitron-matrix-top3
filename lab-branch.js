'use strict';

(() => {
  const CORE=window.LabBranchCore;
  if(!CORE)return;
  const ARCHIVE_KEY='pozitron.lab.branch.archive.v1';
  const UI_KEY='pozitron.lab.branch.ui.v1';
  const VERSION='LAB BRANCH v1.7.2';
  let lastRenderKey='';

  const $=s=>document.querySelector(s);
  function readJson(key,fallback){try{const v=JSON.parse(localStorage.getItem(key)||'null');return v??fallback}catch(_){return fallback}}
  function writeJson(key,value){localStorage.setItem(key,JSON.stringify(value))}
  function targetKey(t){return `${t.id||''}|${t.date}|${t.time}`}
  function fmtCombo(a){return (a||[]).join(' · ')}
  function fmtBranch(d,s){return `D${d} S${s>0?'+':''}${s}`}
  function isoLocal(iso){try{return new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch(_){return iso}}
  function currentTimes(target){
    const inferred=CORE.inferTimes(state.draws||[],target?.date);
    if(inferred.length>=4)return inferred;
    try{return CORE.normalizeTimes(scheduleTimes())}catch(_){return inferred}
  }
  function findFact(target){
    return (state.draws||[]).find(d=>(target.id&&Number(d.id)===Number(target.id))||(d.date===target.date&&d.time===target.time))||null;
  }
  function readArchive(){const a=readJson(ARCHIVE_KEY,[]);return Array.isArray(a)?a:[]}
  function closePending(records){
    let changed=false;
    for(const r of records){
      if(r.status!=='pending')continue;
      const fact=findFact(r.target);if(!fact)continue;
      const factCombo=CORE.combo(fact),hit=CORE.overlapCount(r.prediction,factCombo);
      r.status='closed';r.fact={id:fact.id,date:fact.date,time:fact.time,combo:factCombo};r.hit=hit;r.result=`${hit}/2`;r.matched=CORE.matchedDigits(r.prediction,factCombo);r.closedAt=new Date().toISOString();changed=true;
    }
    return changed;
  }
  function freezeCurrent(records){
    let target;try{target=targetDraw()}catch(_){target=null}
    if(!target||!(state.draws||[]).length)return {records,plan:null,frozen:null,changed:false};
    const times=currentTimes(target),plan=CORE.forecastPlan(state.draws,target,times);
    if(!plan)return {records,plan:null,frozen:null,changed:false};
    const key=targetKey(target),existing=records.find(x=>x.key===key);
    if(existing)return {records,plan,frozen:existing,changed:false};
    const p=plan.primary;
    const frozen={
      key,status:'pending',savedAt:new Date().toISOString(),engine:VERSION,
      target:{id:target.id,date:target.date,time:target.time},
      decision:p.decision,streak:p.streak,
      branch:{d:p.chosen.d,s:p.chosen.s,score:Number(p.chosen.score.toFixed(5)),rate:Number(p.chosen.rate.toFixed(5)),samples:p.chosen.samples},
      source:{date:p.source.date,time:p.source.time,combo:[...p.source.combo]},
      prediction:[...p.prediction],
      s0:p.s0?{source:{date:p.s0.source.date,time:p.s0.source.time,combo:[...p.s0.source.combo]},prediction:[...p.s0.prediction]}:null,
      extended:p.extended?{d:p.extended.d,s:p.extended.s,hit:p.extended.hit,lastSource:p.extended.lastSource,nextSource:{date:p.extended.nextSource.date,time:p.extended.nextSource.time,combo:[...p.extended.nextSource.combo]}}:null,
      ranking:p.ranking
    };
    records.unshift(frozen);return {records,plan,frozen,changed:true};
  }
  function sync(){
    const records=readArchive();let changed=closePending(records);
    const x=freezeCurrent(records);changed=changed||x.changed;
    if(changed)writeJson(ARCHIVE_KEY,records);
    return {records,plan:x.plan,frozen:x.frozen||records.find(r=>r.status==='pending')||null};
  }
  function resultClass(r){if(r.status==='pending')return'pending';if(r.hit===2)return'hit';if(r.hit===1)return'part';return'miss'}
  function archiveStats(records){
    const closed=records.filter(r=>r.status==='closed');return {total:records.length,pending:records.filter(r=>r.status==='pending').length,hit:closed.filter(r=>r.hit===2).length,part:closed.filter(r=>r.hit===1).length,miss:closed.filter(r=>r.hit===0).length};
  }
  function renderArchive(records){
    const el=$('#branchArchive'),stats=$('#branchArchiveStats');if(!el||!stats)return;const st=archiveStats(records);
    stats.innerHTML=`<span>Всего <b>${st.total}</b></span><span class="ok">2/2 <b>${st.hit}</b></span><span class="part">1/2 <b>${st.part}</b></span><span class="bad">0/2 <b>${st.miss}</b></span><span>Ожидают <b>${st.pending}</b></span>`;
    if(!records.length){el.innerHTML='<div class="branch-empty">Архив пока пуст. Первая запись появится автоматически для следующего тиража.</div>';return}
    el.innerHTML=records.slice(0,60).map(r=>{
      const cls=resultClass(r),status=r.status==='pending'?'ОЖИДАЕТ':r.result;
      return `<article class="branch-archive-row ${cls}">
        <div class="bar-head"><b>${r.target.date} · ${r.target.time}</b><span>${status}</span></div>
        <div class="bar-grid">
          <div><label>Постановка</label><b>${isoLocal(r.savedAt)}</b></div>
          <div><label>Ветка</label><b>${fmtBranch(r.branch.d,r.branch.s)} · ${r.decision}</b></div>
          <div><label>Источник</label><b>${r.source.date} ${r.source.time} · ${fmtCombo(r.source.combo)}</b></div>
          <div><label>Frozen</label><b>${fmtCombo(r.prediction)}</b></div>
          <div><label>Факт</label><b>${r.fact?fmtCombo(r.fact.combo):'—'}</b></div>
          <div><label>Совпало</label><b>${r.matched?.length?fmtCombo(r.matched):'—'}</b></div>
        </div>
      </article>`
    }).join('');
  }
  function arrowSvg(r){
    return `<div class="branch-arrow-box"><svg viewBox="0 0 760 150" preserveAspectRatio="none" aria-label="Схема ветки">
      <defs><marker id="branchArrowHead" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#18cfff"/></marker></defs>
      <rect x="20" y="30" rx="16" width="250" height="86" class="branch-svg-card"/><text x="38" y="58" class="branch-svg-label">ИСТОЧНИК</text><text x="38" y="84" class="branch-svg-main">${r.source.date} · ${r.source.time}</text><text x="38" y="106" class="branch-svg-main">${fmtCombo(r.source.combo)}</text>
      <path d="M280 73 C390 10, 470 140, 590 73" class="branch-svg-line" marker-end="url(#branchArrowHead)"/><text x="372" y="42" class="branch-svg-label">${fmtBranch(r.branch.d,r.branch.s)}</text>
      <rect x="600" y="30" rx="16" width="140" height="86" class="branch-svg-card target"/><text x="618" y="58" class="branch-svg-label">ЦЕЛЬ</text><text x="618" y="84" class="branch-svg-main">${r.target.time}</text><text x="618" y="106" class="branch-svg-main">${fmtCombo(r.prediction)}</text>
    </svg></div>`;
  }
  function renderForecast(frozen){
    const root=$('#branchForecast');if(!root)return;
    if(!frozen){root.innerHTML='<div class="branch-empty">Жду загрузку архива и расчёт следующего тиража…</div>';return}
    const ui=readJson(UI_KEY,{collapsed:true,arrows:false,archiveCollapsed:false});
    const s0=frozen.s0;
    root.innerHTML=`
      <div class="branch-card ${ui.collapsed?'collapsed':''}">
        <button id="branchToggle" class="branch-summary" type="button" aria-expanded="${!ui.collapsed}">
          <span><b>🧭 Ветка на следующий тираж</b><small>НАЖАТЬ, ЧТОБЫ ${ui.collapsed?'РАСКРЫТЬ':'СВЕРНУТЬ'} · цель ${frozen.target.date} · ${frozen.target.time}</small></span>
          <span class="branch-summary-center"><strong>${fmtBranch(frozen.branch.d,frozen.branch.s)}</strong><em>${frozen.decision} · streak ${frozen.streak}</em></span>
          <span class="branch-picks">${frozen.prediction.map(n=>`<i>${n}</i>`).join('')}</span>
          <span class="branch-chevron">${ui.collapsed?'⌄':'⌃'}</span>
        </button>
        <div class="branch-detail ${ui.collapsed?'hidden':''}">
          <div class="branch-meta-grid">
            <div><label>Целевой тираж</label><b>№${frozen.target.id||'—'} · ${frozen.target.date} ${frozen.target.time}</b></div>
            <div><label>Время постановки</label><b>${isoLocal(frozen.savedAt)}</b></div>
            <div><label>Решение</label><b>${frozen.decision} · streak ${frozen.streak}</b></div>
            <div><label>Источник</label><b>${frozen.source.date} ${frozen.source.time} · ${fmtCombo(frozen.source.combo)}</b></div>
            <div><label>Прогноз 2 цифры</label><b class="branch-two">${fmtCombo(frozen.prediction)}</b></div>
            <div><label>Архивный score</label><b>${Math.round((frozen.branch.rate||0)*100)}% · n=${frozen.branch.samples}</b></div>
          </div>
          ${s0?`<div class="branch-control"><span>Контроль того же D с S0</span><b>${s0.source.date} ${s0.source.time} · ${fmtCombo(s0.source.combo)} → ${fmtCombo(s0.prediction)}</b></div>`:''}
          ${frozen.extended?`<div class="branch-extended"><span>Дальняя нить D8–D14 · наблюдение</span><b>${fmtBranch(frozen.extended.d,frozen.extended.s)} · последний перенос ${frozen.extended.hit}/3</b><small>${frozen.extended.lastSource.date} ${frozen.extended.lastSource.time} ${fmtCombo(frozen.extended.lastSource.combo)} → следующий источник ${frozen.extended.nextSource.date} ${frozen.extended.nextSource.time} ${fmtCombo(frozen.extended.nextSource.combo)}</small></div>`:''}
          <div class="branch-actions"><button id="branchArrowToggle" type="button" class="secondary-btn">${ui.arrows?'Скрыть стрелки':'Показать стрелки'}</button><span>Frozen не переписывается после факта.</span></div>
          ${ui.arrows?arrowSvg(frozen):''}
        </div>
      </div>`;
    $('#branchToggle').onclick=()=>{const u=readJson(UI_KEY,{collapsed:true,arrows:false,archiveCollapsed:false});u.collapsed=!u.collapsed;writeJson(UI_KEY,u);lastRenderKey='';render()};
    const at=$('#branchArrowToggle');if(at)at.onclick=()=>{const u=readJson(UI_KEY,{collapsed:false,arrows:false,archiveCollapsed:false});u.arrows=!u.arrows;u.collapsed=false;writeJson(UI_KEY,u);lastRenderKey='';render()};
  }
  function bindArchiveToggle(){
    const btn=$('#branchArchiveToggle'),body=$('#branchArchiveBody');if(!btn||!body)return;
    const ui=readJson(UI_KEY,{collapsed:true,arrows:false,archiveCollapsed:false});
    body.classList.toggle('hidden',!!ui.archiveCollapsed);
    btn.textContent=ui.archiveCollapsed?'Открыть архив':'Скрыть архив';
    btn.onclick=()=>{const u=readJson(UI_KEY,{collapsed:true,arrows:false,archiveCollapsed:false});u.archiveCollapsed=!u.archiveCollapsed;writeJson(UI_KEY,u);lastRenderKey='';render()};
  }
  function render(){
    if(typeof state==='undefined'||!state||!Array.isArray(state.draws))return;
    const badge=$('#branchSelfTest'),coreTest=CORE.selfTest();
    if(badge){badge.textContent=coreTest.pass?'SELF-TEST PASS':'SELF-TEST FAIL';badge.className=`branch-selftest ${coreTest.pass?'pass':'fail'}`}
    if(!state.draws.length){renderForecast(null);renderArchive(readArchive());bindArchiveToggle();return}
    const {records,frozen}=sync();
    const ui=readJson(UI_KEY,{collapsed:true,arrows:false,archiveCollapsed:false});
    const rk=`${state.draws[0]?.id||0}|${records.length}|${frozen?.key||''}|${ui.collapsed}|${ui.arrows}|${ui.archiveCollapsed}`;
    if(rk===lastRenderKey&&$('#branchForecast')?.children.length)return;
    lastRenderKey=rk;renderForecast(frozen);renderArchive(records);bindArchiveToggle();
  }
  function boot(){render();setInterval(render,2000);const refresh=$('#refreshBtn');if(refresh)refresh.addEventListener('click',()=>{lastRenderKey='';setTimeout(render,1200)});}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.LabBranch={render,readArchive,selfTest:CORE.selfTest};
})();
