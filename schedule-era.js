'use strict';

/*
  MATRIX TOP-3 · SCHEDULE ERA v1.4.1
  Fixed new schedule: 48 draws/day, every 30 minutes at :25 / :55.
  Old archive remains unchanged through №267755.
*/
(() => {
  const CUTOVER_ID = 267756;
  const OLD_TIMES = ['02:40','04:40','06:40','07:40','09:40','11:40','13:40','16:25','21:25','22:40'];
  const NEW_TIMES = ['00:25','00:55','01:25','01:55','02:25','02:55','03:25','03:55','04:25','04:55','05:25','05:55','06:25','06:55','07:25','07:55','08:25','08:55','09:25','09:55','10:25','10:55','11:25','11:55','12:25','12:55','13:25','13:55','14:25','14:55','15:25','15:55','16:25','16:55','17:25','17:55','18:25','18:55','19:25','19:55','20:25','20:55','21:25','21:55','22:25','22:55','23:25','23:55'];

  function eraOf(d){ return d.id >= CUTOVER_ID ? 'new' : 'old'; }
  function eraRows(era){ return filteredByDays().filter(d => eraOf(d) === era); }

  // LAB and targetDraw must always use the complete current schedule.
  scheduleTimes = function(){ return NEW_TIMES.slice(); };

  function injectStyles(){
    if(document.getElementById('schedule-era-css')) return;
    const s=document.createElement('style');
    s.id='schedule-era-css';
    s.textContent=`
      .schedule-era-block{margin:0 0 16px;border:2px solid #274762;border-radius:15px;overflow:hidden;background:#03101c}
      .schedule-era-block.new-era{border-color:#1bbf70;box-shadow:0 0 18px rgba(27,191,112,.12)}
      .schedule-era-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 12px;background:#071a2a;border-bottom:1px solid #274762}
      .schedule-era-head .era-badge{font-weight:950;letter-spacing:.025em;border:1px solid #51708c;border-radius:999px;padding:5px 10px;color:#dbeafe}
      .new-era .schedule-era-head .era-badge{border-color:#1bbf70;color:#7ff0b1}
      .schedule-era-head .era-range{font-weight:850;color:#dbeafe}
      .schedule-era-head .era-sub{font-size:12px;color:#8da5b8;font-weight:650}
      .schedule-divider{display:flex;align-items:center;gap:10px;margin:12px 0 16px;color:#d1a7ff;font-weight:950;white-space:nowrap}
      .schedule-divider:before,.schedule-divider:after{content:"";height:0;flex:1;border-top:2px dashed #7751aa}
      .schedule-divider span{padding:6px 10px;border:1px solid #7751aa;border-radius:9px;background:#23153d}
      .schedule-era-scroll{overflow:auto;-webkit-overflow-scrolling:touch}
      @media(max-width:700px){
        .schedule-era-head{padding:8px}
        .schedule-era-head .era-badge{font-size:12px}
        .schedule-divider{font-size:11px}
      }
    `;
    document.head.appendChild(s);
  }

  function groupRows(rows){
    const map=new Map();
    for(const d of rows){
      if(!map.has(d.date)) map.set(d.date,[]);
      map.get(d.date).push(d);
    }
    return [...map.entries()]
      .sort((a,b)=>parseDate(b[0])-parseDate(a[0]))
      .slice(0,state.rowLimit);
  }

  function nativeGrid(era){
    const rows=eraRows(era);
    if(!rows.length) return '';
    const groups=groupRows(rows);
    const times=era==='new' ? NEW_TIMES.slice() : OLD_TIMES.slice();
    const freq=freqMap(groups,times);
    const cols=`126px repeat(${times.length},206px)`;

    let html=`<section class="schedule-era-block ${era==='new'?'new-era':'old-era'}">`;
    html+=era==='new'
      ? `<div class="schedule-era-head"><span class="era-badge">НОВОЕ РАСПИСАНИЕ</span><span class="era-range">№267756 и далее</span><span class="era-sub">48 тиражей · :25 / :55 · свежая дата сверху</span></div>`
      : `<div class="schedule-era-head"><span class="era-badge">СТАРОЕ РАСПИСАНИЕ</span><span class="era-range">по №267755 включительно</span><span class="era-sub">архив сохранён без изменения времени</span></div>`;

    html+=`<div class="schedule-era-scroll"><div class="matrix-grid" style="grid-template-columns:${cols}">`;
    html+=`<div class="mcell mhead date-head date-cell"><b>Дата</b><span>день</span></div>`;
    for(const t of times){
      html+=`<div class="mcell mhead time-head"><div class="time-title">${t}</div><div class="abc-head"><span>A</span><span>B</span><span>C</span></div></div>`;
    }

    for(const [date,ds] of groups){
      html+=`<div class="mcell date-cell"><b>${date}</b><span>${weekday(date)}</span></div>`;
      const byTime=new Map(ds.map(d=>[d.time,d]));
      for(const t of times){
        const d=byTime.get(t);
        if(!d){
          html+=`<div class="mcell draw-cell"><div class="draw-id">—</div><div class="digits"><button class="matrix-digit freq-0" disabled>·</button><button class="matrix-digit freq-0" disabled>·</button><button class="matrix-digit freq-0" disabled>·</button></div></div>`;
          continue;
        }
        const vals=[d.a,d.b,d.c], ps=['A','B','C'];
        const key=state.mode==='ALL'?'ALL':state.mode;
        const max=Math.max(...freq[t][key]);
        html+=`<div class="mcell draw-cell"><div class="draw-id">№${d.id}</div><div class="digits">`;
        html+=vals.map((v,i)=>{
          const count=freq[t][key][v];
          const lv=level(count,max);
          const dim=state.mode!=='ALL'&&state.mode!==ps[i]?' dim':'';
          const sel=state.activeDigits.has(v)?' selected':'';
          return `<button class="matrix-digit freq-${lv}${dim}${sel}" data-digit="${v}" title="${ps[i]} · ${count} раз">${v}</button>`;
        }).join('');
        html+=`</div></div>`;
      }
    }
    return html+`</div></div></section>`;
  }

  renderMatrix = function(){
    injectStyles();
    const newHtml=nativeGrid('new');
    const oldHtml=nativeGrid('old');
    const divider=(newHtml&&oldHtml)
      ? `<div class="schedule-divider"><span>СМЕНА РАСПИСАНИЯ · 08.09.2026 · между №267755 / №267756</span></div>`
      : '';
    $('#matrixTable').innerHTML=newHtml+divider+oldHtml;
    bindDigitClicks($('#matrixTable'));
    renderBars(filteredByDays());

    const latest=state.draws[0];
    $('#matrixStatus').innerHTML=
      `Режим: <b>${state.mode==='ALL'?'ВСЕ':state.mode}</b><br>`+
      `Новая сетка: <b>48 времён · :25 / :55</b><br>`+
      `Граница: <b>№267756</b><br>`+
      `Последний: <b>${latest?`№${latest.id}`:'—'}</b><br>`+
      `Источник: <b>${state.source}</b>`;
  };

  injectStyles();
})();
