'use strict';

(() => {
  const CORE=window.LabThreeColumnsCore;if(!CORE)return;
  const ARCHIVE_URL='./three-columns-archive-top3.json';
  const UI_KEY='pozitron.lab.threecols.ui.v1';
  let serverArchive=[],serverUpdatedAt=null,serverLoaded=false,serverError='',lastRenderKey='';
  const $=s=>document.querySelector(s);
  function readUi(){try{return JSON.parse(localStorage.getItem(UI_KEY)||'{}')}catch(_){return {}}}
  const stored=readUi(),ui={open:stored.open!==false,archiveOpen:stored.archiveOpen===true};
  function saveUi(){try{localStorage.setItem(UI_KEY,JSON.stringify(ui))}catch(_){}}
  function fmt(c){return (c||[]).join(' · ')}
  function compact(c){return (c||[]).join('')}
  function isoLocal(iso){if(!iso)return'—';try{return new Date(iso).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch(_){return iso}}
  function targetKey(t){return `${t?.id||''}|${t?.date||''}|${t?.time||''}`}
  function currentTimes(target){
    try{const x=CORE.normalizeTimes(scheduleTimes());if(x.length>=4)return x}catch(_){/* fallback */}
    return CORE.inferTimes(state.draws||[],target?.date);
  }
  function preview(){
    if(typeof state==='undefined'||!state.draws?.length)return null;
    const p=CORE.plan(state.draws,currentTimes(state.draws[0]));if(!p)return null;
    return {key:targetKey(p.target),status:'preview',savedAt:null,engine:'LAB THREE COLUMNS v1.0.0 PREVIEW',target:p.target,current:p.current,repeat:p.repeat,vertical:p.vertical};
  }
  async function loadArchive(){
    try{
      const r=await fetch(`${ARCHIVE_URL}?t=${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();serverArchive=Array.isArray(j)?j:(j.records||[]);serverUpdatedAt=j.updatedAt||null;serverError='';serverLoaded=true;lastRenderKey='';render();
    }catch(e){serverLoaded=true;serverError=e?.message||String(e);lastRenderKey='';render();}
  }
  function activeRecord(){
    if(!serverLoaded)return null;
    const p=preview();if(!p)return null;
    return serverArchive.find(r=>r.key===p.key)||p;
  }
  function digitRow(c,cls=''){return `<span class="tc-digits ${cls}">${(c||[]).map((n,i)=>`<i class="p${i}">${n}</i>`).join('')}</span>`}
  function formulaRepeat(r){
    const ch=r?.repeat;if(!ch)return'<div class="tc-missing">Предыдущий точный повтор не найден.</div>';
    return `<div class="tc-formula"><span>${compact(r.current.combo)}</span><b>+</b><span>${compact(ch.follower.combo)}</span><b>=</b>${digitRow(ch.prediction,'repeat')}</div><div class="tc-source-line">Предыдущий ${compact(r.current.combo)}: <b>${ch.previous.date} ${ch.previous.time}</b> → следующий <b>${ch.follower.date} ${ch.follower.time} · ${compact(ch.follower.combo)}</b></div>`;
  }
  function formulaVertical(r){
    const ch=r?.vertical;if(!ch)return'<div class="tc-missing">Для этого времени нет источника D2.</div>';
    return `<div class="tc-formula"><span>${compact(r.current.combo)}</span><b>−</b><span>${compact(ch.source.combo)}</span><b>=</b>${digitRow(ch.prediction,'vertical')}</div><div class="tc-source-line">D2 того же времени: <b>${ch.source.date} ${ch.source.time} · ${compact(ch.source.combo)}</b></div>`;
  }
  function renderModule(r){
    const el=$('#threeColumnsForecast');if(!el)return;
    if(!r){el.innerHTML=`<div class="tc-empty">${serverLoaded?(serverError?`Архив недоступен: ${serverError}`:'Недостаточно данных для расчёта.'):'Загрузка…'}</div>`;return}
    const frozen=r.status==='pending'?'SERVER FROZEN':r.status==='preview'?'PREVIEW':'ARCHIVE';
    el.innerHTML=`<article class="tc-card"><button id="threeColumnsToggle" class="tc-summary" type="button" aria-expanded="${ui.open}"><span><b>▥ Три столба</b><small>${frozen} · цель ${r.target.date} ${r.target.time}</small></span><span class="tc-picks">${r.repeat?digitRow(r.repeat.prediction,'repeat'):''}${r.vertical?digitRow(r.vertical.prediction,'vertical'):''}</span><span class="tc-chevron">${ui.open?'⌃':'⌄'}</span></button><div id="threeColumnsDetail" class="tc-detail" ${ui.open?'':'hidden'}><div class="tc-current"><label>Исходный факт</label><b>№${r.current.id} · ${r.current.date} ${r.current.time}</b>${digitRow(r.current.combo,'actual')}</div><div class="tc-channels"><section><div class="tc-channel-head"><b>ПОВТОР +</b><span>исторический точный повтор → следующий тираж</span></div>${formulaRepeat(r)}</section><section><div class="tc-channel-head"><b>ВЕРТИКАЛЬ D2 −</b><span>то же время · 2 дня назад</span></div>${formulaVertical(r)}</section></div><div class="tc-rule">Проверка результата — без привязки к позициям, с учётом повторов цифр. 129 = 912 = 291 по сборке.</div></div></article>`;
  }
  function hitClass(n){return n>=3?'hit3':n===2?'hit2':n===1?'hit1':'miss'}
  function stats(records){
    const closed=records.filter(r=>r.status==='closed');
    const calc=field=>{const a=closed.map(r=>r[field]?.hit).filter(Number.isFinite);return {n:a.length,h3:a.filter(x=>x===3).length,h2:a.filter(x=>x>=2).length,h1:a.filter(x=>x>=1).length}};
    const repeat=calc('repeatEval'),vertical=calc('verticalEval');
    const best=closed.map(r=>Number(r.bestHit)).filter(Number.isFinite);
    return {closed:closed.length,pending:records.filter(r=>r.status==='pending').length,repeat,vertical,best2:best.filter(x=>x>=2).length,best3:best.filter(x=>x===3).length};
  }
  function renderArchive(){
    const body=$('#threeColumnsArchive'),statsEl=$('#threeColumnsArchiveStats');if(!body||!statsEl)return;
    const st=stats(serverArchive),updated=serverUpdatedAt?` · сервер ${isoLocal(serverUpdatedAt)}`:'';
    const rate=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'—';
    statsEl.innerHTML=`<span>SERVER · three-columns-archive-top3.json${updated}</span><span>Закрыто <b>${st.closed}</b></span><span class="ok">Повтор 2+ <b>${st.repeat.h2}</b> · ${rate(st.repeat.h2,st.repeat.n)}</span><span class="ok">D2 2+ <b>${st.vertical.h2}</b> · ${rate(st.vertical.h2,st.vertical.n)}</span><span class="best">Хотя бы один 2+ <b>${st.best2}</b> · ${rate(st.best2,st.closed)}</span><span>Ожидают <b>${st.pending}</b></span>`;
    if(serverError&&!serverArchive.length){body.innerHTML=`<div class="tc-empty">Не удалось загрузить архив: ${serverError}</div>`;return}
    if(!serverArchive.length){body.innerHTML='<div class="tc-empty">Архив пока пуст.</div>';return}
    body.innerHTML=serverArchive.slice(0,80).map(r=>{
      const re=r.repeatEval,ve=r.verticalEval;
      return `<article class="tc-archive-row ${r.status==='pending'?'pending':hitClass(r.bestHit||0)}"><div class="tc-ar-head"><b>${r.target.date} · ${r.target.time} · №${r.target.id||'—'}</b><span>${r.status==='pending'?'ОЖИДАЕТ':`ЛУЧШИЙ ${r.bestResult||'—'}`}</span></div><div class="tc-ar-grid"><div><label>Исходный</label><b>${fmt(r.current?.combo)}</b></div><div><label>Повтор +</label><b>${r.repeat?fmt(r.repeat.prediction):'—'}</b><span>${re?`${re.result} · совпало ${fmt(re.matched)||'—'}`:'—'}</span></div><div><label>D2 −</label><b>${r.vertical?fmt(r.vertical.prediction):'—'}</b><span>${ve?`${ve.result} · совпало ${fmt(ve.matched)||'—'}`:'—'}</span></div><div><label>Факт</label><b>${r.fact?fmt(r.fact.combo):'—'}</b></div></div></article>`;
    }).join('');
  }
  function applyUi(){
    const d=$('#threeColumnsDetail'),t=$('#threeColumnsToggle'),a=$('#threeColumnsArchiveBody'),at=$('#threeColumnsArchiveToggle');
    if(d)d.hidden=!ui.open;if(t){t.setAttribute('aria-expanded',String(ui.open));const c=t.querySelector('.tc-chevron');if(c)c.textContent=ui.open?'⌃':'⌄'}
    if(a)a.hidden=!ui.archiveOpen;if(at){at.setAttribute('aria-expanded',String(ui.archiveOpen));at.textContent=ui.archiveOpen?'Скрыть архив':'Открыть архив'}
  }
  function render(){
    if(typeof state==='undefined'||!Array.isArray(state.draws))return;
    const r=activeRecord(),rk=`${state.draws[0]?.id||0}|${serverUpdatedAt||''}|${serverArchive.length}|${r?.key||''}|${serverError}`;
    if(rk===lastRenderKey&&$('#threeColumnsForecast')?.children.length){applyUi();return}
    lastRenderKey=rk;renderModule(r);renderArchive();applyUi();
    const badge=$('#threeColumnsSelfTest'),test=CORE.selfTest();if(badge){badge.textContent=test.ok?'SELF-TEST PASS':'SELF-TEST FAIL';badge.className=`tc-selftest ${test.ok?'pass':'fail'}`}
  }
  function click(e){const b=e.target.closest('button');if(!b)return;if(b.id==='threeColumnsToggle')ui.open=!ui.open;else if(b.id==='threeColumnsArchiveToggle')ui.archiveOpen=!ui.archiveOpen;else return;saveUi();applyUi();}
  function boot(){
    const root=$('#labView');if(root)root.addEventListener('click',click);render();loadArchive();setInterval(render,2500);setInterval(loadArchive,15000);
    const refresh=$('#refreshBtn');if(refresh)refresh.addEventListener('click',()=>setTimeout(loadArchive,900));
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.LabThreeColumns={render,loadArchive,selfTest:CORE.selfTest,archiveSource:ARCHIVE_URL};
})();
