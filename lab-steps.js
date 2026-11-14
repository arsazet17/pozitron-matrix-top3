'use strict';
/* LAB «СТУПЕНИ» · интерфейс и сигнал «скоро тройка» */
(() => {
  const CORE=window.LabStepsCore;if(!CORE)return;
  const UI_KEY='pozitron.lab.steps.ui.v1',SEEN_KEY='pozitron.lab.steps.seen.v1';
  const $=s=>document.querySelector(s);
  function readJson(k,f){try{const v=JSON.parse(localStorage.getItem(k)||'null');return v??f}catch(_){return f}}
  function saveJson(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}}
  const ui=Object.assign({journalOpen:false,rows:10},readJson(UI_KEY,{}));
  let lastKey='',cache=null;

  const pct=v=>String((Math.round(v*10)/10).toFixed(1)).replace('.',',');
  const comboHtml=(c,hl)=>`<span class="st-combo">${c.map((n,i)=>`<i class="${hl===i?'on':''}">${n}</i>`).join('')}</span>`;
  const POS_I={A:0,B:1,C:2};
  function pathHtml(e){
    const idx=e.kind==='/'?[2,1,0]:[0,1,2];
    return `<div class="st-path">${e.path.map((p,i)=>`<div class="st-step"><small>${p.time||''}</small>${comboHtml(p.combo,idx[i])}</div>`).join('<b class="st-arrow">→</b>')}</div>`;
  }
  /* примерное время N-го тиража вперёд: шаг берём из двух последних тиражей */
  function stepMinutes(R){
    const a=R[R.length-1],b=R[R.length-2];if(!a||!b||a.date!==b.date)return 30;
    const m=t=>{const [h,n]=String(t).split(':').map(Number);return h*60+n};const d=m(a.time)-m(b.time);return d>0&&d<=180?d:30;
  }
  function timeAhead(latest,n,step){
    const [h,m]=String(latest.time||'00:00').split(':').map(Number);let t=h*60+m+n*step;t=((t%1440)+1440)%1440;
    return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
  }

  function signalCard(e,st,p,R){
    const W=p.window,left=W-e.passed,step=stepMinutes(R);
    const z=st.zone||[8,15];
    const inZone=e.passed+1>=z[0]&&e.passed+1<=z[1];
    const zoneFrom=Math.max(1,z[0]-e.passed),zoneTo=z[1]-e.passed;
    const zoneTxt=zoneTo>=1?`зона ${z[0]}–${z[1]} тиражей после линии → примерно <b>${timeAhead(p.latest,zoneFrom,step)}–${timeAhead(p.latest,zoneTo,step)}</b>`:'зона по архиву уже прошла, окно ещё открыто';
    const t=String(e.digit).repeat(3).split('');
    return `<article class="st-signal ${inZone?'hot':''}">
      <div class="st-signal-top"><span class="st-flag">${inZone?'🔥 В ЗОНЕ':'⚠ СИГНАЛ'}</span><span class="st-left">осталось ${left} из ${W}</span></div>
      <div class="st-signal-main"><div><small>СКОРО ТРОЙКА</small><div class="st-big">${t.map(n=>`<i>${n}</i>`).join('')}</div></div>
      <div class="st-signal-info"><div>линия «${e.kind}» из <b>${e.digit}</b> · ${e.date} ${e.time}</div><div>прошло <b>${e.passed}</b> тир. после линии</div><div>${zoneTxt}</div>${e.anyAt?`<div>уже была другая тройка: <b>${e.anyAt.combo.join('-')}</b> в ${e.anyAt.time} (через ${e.lagAny})</div>`:''}</div></div>
      ${pathHtml(e)}
      <div class="st-progress"><div class="st-fill" style="width:${Math.min(100,e.passed/W*100)}%"></div><div class="st-zone" style="left:${(z[0]-1)/W*100}%;width:${(z[1]-z[0]+1)/W*100}%"></div></div>
    </article>`;
  }
  function formingCard(f){
    return `<div class="st-forming">🪜 Строится линия из <b>${f.digit}</b>: ${f.path.map(p=>`${p.time} ${p.combo.join('-')}`).join(' → ')}. Если в следующем тираже на позиции <b>${f.needPos}</b> выпадет <b>${f.digit}</b> — будет сигнал на ${f.digit}-${f.digit}-${f.digit}.</div>`;
  }
  function statsHtml(st,W){
    return `<div class="st-stats">
      <div>По архиву линий: <b>${st.n}</b></div>
      <div>Тройка той же цифры в ${W} тиражах: <b>${st.hit}</b> (${pct(st.pSame)}%) · наугад ${pct(st.chanceSame)}%</div>
      <div>Любая тройка в ${W} тиражах: <b>${st.any}</b> (${pct(st.pAny)}%) · наугад ${pct(st.chanceAny)}%</div>
      <div>Через сколько приходила тройка: <b>${st.lags.join(', ')||'—'}</b></div>
    </div>`;
  }
  const big=c=>`<div class="st-res-combo">${c.map(n=>`<i>${n}</i>`).join('')}</div>`;
  function resultBox(e,W){
    const t=[e.digit,e.digit,e.digit];
    if(e.state==='hit'){const h=e.hitAt;return `<div class="st-res hit"><small>✅ ВЫШЛА</small>${big(h.combo)}<div class="st-res-when">${h.date}<br><b>${h.time}</b></div><div class="st-res-id">№${h.id}</div><div class="st-res-lag">через <b>${e.lag}</b> тир.</div><div class="st-res-from">от начала линии: ${e.lag+2}</div></div>`}
    const other=h=>`<div class="st-res-other">другая тройка: <b>${h.combo.join('-')}</b> · ${h.time} · через ${e.lagAny}</div>`;
    if(e.state==='watch')return `<div class="st-res watch"><small>⏳ ЖДЁМ</small>${big(t)}<div class="st-res-lag">прошло <b>${e.passed}</b> из ${W}</div>${e.anyAt?other(e.anyAt):''}</div>`;
    if(e.anyAt){const h=e.anyAt,late=e.lagAny>W;return `<div class="st-res any"><small>✗ ${e.digit}-${e.digit}-${e.digit} не было · вышла другая${late?` (после ${W})`:''}</small>${big(h.combo)}<div class="st-res-when">${h.date}<br><b>${h.time}</b></div><div class="st-res-id">№${h.id}</div><div class="st-res-lag">через <b>${e.lagAny}</b> тир.</div></div>`}
    return `<div class="st-res miss"><small>✗ НЕ БЫЛО</small>${big(t)}<div class="st-res-lag">за ${W} тиражей</div></div>`;
  }
  function journalHtml(events,W){
    const list=events.slice().sort((a,b)=>b.id-a.id).slice(0,ui.rows);
    return list.map(e=>{
      const p0=e.path[0],p2=e.path[2];
      return `<div class="st-row ${e.state}"><div class="st-row-head"><b>${p0.date} ${p0.time}→${p2.time} · линия «${e.kind}» из ${e.digit}</b><small>захват: №${p0.id}–№${p2.id}</small></div><div class="st-row-body">${pathHtml(e)}${resultBox(e,W)}</div></div>`;
    }).join('')+(events.length>ui.rows?`<button id="stMore" class="secondary-btn st-more" type="button">Показать ещё</button>`:'');
  }
  function notify(p){
    const seen=readJson(SEEN_KEY,{});let changed=false;
    const fire=(tag,title,body)=>{
      if(seen[tag])return;seen[tag]=Date.now();changed=true;
      if(!('Notification' in window)||Notification.permission!=='granted')return;
      const opt={body,tag,icon:'icon-192.png',badge:'icon-192.png'};
      if(navigator.serviceWorker&&navigator.serviceWorker.ready)navigator.serviceWorker.ready.then(r=>r.showNotification(title,opt)).catch(()=>{try{new Notification(title,opt)}catch(_){}});
      else{try{new Notification(title,opt)}catch(_){}}
    };
    const z=p.stats.zone||[8,15];
    p.active.forEach(e=>{
      fire(`line-${e.id}-${e.digit}`,`🪜 Ступени: линия из ${e.digit}`,`Ждём ${e.digit}-${e.digit}-${e.digit} в ближайшие ${p.window} тиражей`);
      if(e.passed+1>=z[0])fire(`zone-${e.id}-${e.digit}`,`🔥 Ступени: зона тройки ${e.digit}-${e.digit}-${e.digit}`,`Прошло ${e.passed} тиражей после линии — начинается зона по архиву`);
    });
    p.forming.forEach(f=>fire(`form-${f.path[1].id}-${f.digit}`,`🪜 Строится линия из ${f.digit}`,`Нужна ${f.digit} на позиции ${f.needPos} в следующем тираже`));
    if(changed){const keys=Object.keys(seen).sort((a,b)=>seen[b]-seen[a]).slice(0,200),o={};keys.forEach(k=>o[k]=seen[k]);saveJson(SEEN_KEY,o)}
  }
  function setAlert(on){
    document.querySelectorAll('[data-tab="lab"]').forEach(b=>b.classList.toggle('steps-alert',!!on));
  }

  function render(force){
    if(typeof state==='undefined'||!Array.isArray(state.draws)||!state.draws.length)return;
    const box=$('#stepsForecast');if(!box)return;
    const key=`${state.draws[0].id}|${state.draws.length}|${ui.rows}|${ui.journalOpen}`;
    if(!force&&key===lastKey)return;lastKey=key;
    const p=cache&&cache.latest.id===state.draws[0].id&&cache.count===state.draws.length?cache.p:CORE.plan(state.draws);
    if(!p){box.innerHTML='<div class="st-empty">Нет данных.</div>';return}
    cache={latest:{id:state.draws[0].id},count:state.draws.length,p};
    const R=CORE.chrono(state.draws),st=p.stats,W=p.window;
    const perm='Notification' in window?Notification.permission:'unsupported';
    const bell=perm==='granted'?'<span class="st-bell on">🔔 уведомления включены</span>':perm==='unsupported'?'':`<button id="stBell" class="st-bell" type="button">🔔 Включить уведомления</button>`;
    let main=p.active.length?p.active.map(e=>signalCard(e,st,p,R)).join(''):`<div class="st-quiet">Сейчас нет открытой линии. Последний тираж: ${p.latest.time} ${[p.latest.a,p.latest.b,p.latest.c].join('-')}.</div>`;
    main+=p.forming.map(formingCard).join('');
    box.innerHTML=`${main}${bell}${statsHtml(st,W)}
      <button id="stJournalToggle" class="secondary-btn st-toggle" type="button" aria-expanded="${ui.journalOpen}">${ui.journalOpen?'Скрыть журнал линий':'Журнал линий'}</button>
      <div id="stJournal" class="st-journal" ${ui.journalOpen?'':'hidden'}>${ui.journalOpen?journalHtml(p.events,W):''}</div>`;
    setAlert(p.active.length>0);
    notify(p);
    const badge=$('#stepsSelfTest');if(badge){const t=CORE.selfTest();badge.textContent=t.ok?'SELF-TEST PASS':'SELF-TEST FAIL';badge.className=`st-selftest ${t.ok?'pass':'fail'}`}
  }
  function click(e){
    const b=e.target.closest('button');if(!b)return;
    if(b.id==='stJournalToggle'){ui.journalOpen=!ui.journalOpen;ui.rows=10}
    else if(b.id==='stMore'){ui.rows+=10}
    else if(b.id==='stBell'){if('Notification' in window)Notification.requestPermission().then(()=>render(true));return}
    else return;
    saveJson(UI_KEY,{journalOpen:ui.journalOpen});render(true);
  }
  function boot(){
    const root=$('#stepsSlot');if(root)root.addEventListener('click',click);
    render(true);setInterval(()=>render(false),20000);
    // первая загрузка архива: ждём, пока app.js заполнит state.draws
    let tries=0;const warm=setInterval(()=>{tries++;if(typeof state!=='undefined'&&state.draws?.length){render(true);clearInterval(warm)}else if(tries>60)clearInterval(warm)},500);
    document.addEventListener('top3:data',()=>render(true));
    const lab=$('#labView');if(lab&&'MutationObserver' in window)new MutationObserver(()=>render(false)).observe(lab,{attributes:true,attributeFilter:['class']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.LabSteps={render,core:CORE};
})();
