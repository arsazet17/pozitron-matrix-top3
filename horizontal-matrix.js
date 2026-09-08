'use strict';

/*
  MATRIX TOP-3 · HORIZONTAL v1.4
  New schedule above old archive.
  Transition colors are calculated only inside the same schedule era.
*/
(() => {
  const CUTOVER_ID=267756;
  const OLD_TIMES=['02:40','04:40','06:40','07:40','09:40','11:40','13:40','16:25','21:25','22:40'];
  const PAGES=['A','B','C','ALL'];
  const LABELS={A:'1 СТОЛБ',B:'2 СТОЛБ',C:'3 СТОЛБ',ALL:'3 СТОЛБА'};
  const POS={A:'a',B:'b',C:'c'};
  let page='A', touchX=null;

  const eraOf=d=>d.id>=CUTOVER_ID?'new':'old';
  const uniq=draws=>[...new Set(draws.map(d=>d.time))].sort((a,b)=>a.localeCompare(b));

  function injectStyle(){
    if(document.getElementById('hm-inline-style'))return;
    const s=document.createElement('style');s.id='hm-inline-style';
    s.textContent=`
      #horizontalView .hm-card{padding:12px;overflow:hidden}
      .hm-pager{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;padding:4px 0 9px;-webkit-overflow-scrolling:touch}
      .hm-page-btn{flex:0 0 auto;border:1px solid #31506b;border-radius:11px;background:#07182a;color:#cbd5e1;padding:10px 14px;font-weight:800;white-space:nowrap}
      .hm-page-btn.active{background:#063f60;border-color:#00cfff;color:#fff;box-shadow:0 0 12px rgba(0,207,255,.18)}
      .hm-legend{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px;font-size:12px;color:#d4deea}
      .hm-legend span{display:flex;align-items:center;gap:6px;background:#061423;border:1px solid #203b54;border-radius:999px;padding:6px 9px}
      .hm-dot{width:13px;height:13px;border-radius:3px;display:inline-block}
      .hm-blue{background:#13a9e7!important;color:#06111f!important}.hm-green{background:#79c74b!important;color:#06111f!important}
      .hm-orange{background:#f2a11d!important;color:#06111f!important}.hm-lightblue{background:#a8d8f0!important;color:#06111f!important}
      .hm-neutral{background:#eaf2f8!important;color:#07111c!important}
      .hm-era{border:2px solid #284b69;border-radius:15px;overflow:hidden;margin-bottom:16px;background:#03101c}
      .hm-era.new{border-color:#1bbf70;box-shadow:0 0 18px rgba(27,191,112,.12)}
      .hm-era-head{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:9px 12px;background:#071a2a;border-bottom:1px solid #284b69}
      .hm-era-badge{border:1px solid #52738f;border-radius:999px;padding:5px 10px;font-weight:950}
      .hm-era.new .hm-era-badge{border-color:#1bbf70;color:#7ff0b1}
      .hm-era-sub{font-size:12px;color:#8da5b8}
      .hm-era-divider{display:flex;align-items:center;gap:10px;margin:12px 0 16px;color:#d1a7ff;font-weight:950;white-space:nowrap}
      .hm-era-divider:before,.hm-era-divider:after{content:"";flex:1;border-top:2px dashed #7751aa}
      .hm-era-divider span{padding:6px 10px;border:1px solid #7751aa;border-radius:9px;background:#23153d}
      .hm-table-wrap{overflow:auto;max-height:70vh;-webkit-overflow-scrolling:touch}
      .hm-table{border-collapse:separate;border-spacing:0;min-width:980px;width:100%;table-layout:fixed;background:#f2f5f8;color:#07111c}
      .hm-table th,.hm-table td{border-right:1px solid #8f9aa5;border-bottom:1px solid #8f9aa5;text-align:center;height:42px;padding:0;font-weight:850}
      .hm-table thead th{position:sticky;top:0;z-index:9;background:#ffe633;color:#101010;font-size:13px}
      .hm-date-head,.hm-date{position:sticky;left:0;z-index:11!important;background:#ffe633!important;color:#101010!important;min-width:116px;width:116px;padding:0 7px!important}
      .hm-time{min-width:82px;width:82px}.hm-empty{background:#e5ebf0!important;color:#8d99a5!important;font-weight:500!important}
      .hm-cell{font-size:19px}.hm-all-cell{padding:3px!important;background:#dce5ec!important}
      .hm-triplet{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;height:35px;padding:2px}
      .hm-mini{display:grid;place-items:center;border-radius:5px;font-size:16px;font-weight:950;border:1px solid rgba(0,0,0,.15)}
      .hm-selected{outline:3px solid #fff!important;box-shadow:inset 0 0 0 2px #08213a,0 0 8px rgba(255,255,255,.5)}
      .hm-page-title{font-size:13px;font-weight:900;color:#52d5ff;letter-spacing:.06em;text-align:right}
      .hm-swipe-hint{font-size:11px;color:#7e96aa;text-align:right;margin-top:2px}
      .hm-legacy{display:none!important}
    `;document.head.appendChild(s);
  }

  function rows(era){return filteredByDays().filter(d=>eraOf(d)===era)}
  function groups(draws){
    const m=new Map();for(const d of draws){if(!m.has(d.date))m.set(d.date,[]);m.get(d.date).push(d)}
    return [...m.entries()].sort((a,b)=>parseDate(b[0])-parseDate(a[0])).slice(0,state.rowLimit);
  }
  function drawMap(draws){return new Map(draws.map(d=>[`${d.date}|${d.time}`,d]))}
  function digitAt(map,date,time,pos){const d=map.get(`${date}|${time}`);return d?d[POS[pos]]:null}
  function cls(map,date,time,pos,times){
    const v=digitAt(map,date,time,pos);if(v==null)return'hm-empty';
    const p=addDays(date,-1),p2=addDays(date,-2),i=times.indexOf(time);
    if(digitAt(map,p,time,pos)===v)return'hm-blue';
    if(i>=0&&i<times.length-1&&digitAt(map,p,times[i+1],pos)===v)return'hm-green';
    if(i>0&&digitAt(map,p,times[i-1],pos)===v)return'hm-orange';
    if(digitAt(map,p2,time,pos)===v)return'hm-lightblue';
    return'hm-neutral';
  }
  function single(map,date,time,pos,times){
    const v=digitAt(map,date,time,pos);if(v==null)return`<td class="hm-cell hm-empty">·</td>`;
    return`<td class="hm-cell ${cls(map,date,time,pos,times)}${state.activeDigits.has(+v)?' hm-selected':''}" data-digit="${v}">${v}</td>`;
  }
  function all(map,date,time,times){
    const d=map.get(`${date}|${time}`);if(!d)return`<td class="hm-all-cell hm-empty">·</td>`;
    return`<td class="hm-all-cell"><div class="hm-triplet">${['A','B','C'].map(p=>{const v=d[POS[p]];return`<span class="hm-mini ${cls(map,date,time,p,times)}${state.activeDigits.has(+v)?' hm-selected':''}" data-digit="${v}">${v}</span>`}).join('')}</div></td>`;
  }
  function eraHtml(era){
    const draws=rows(era);if(!draws.length)return'';
    const times=era==='new'?uniq(draws):OLD_TIMES.slice(), map=drawMap(draws), gs=groups(draws);
    let h=`<section class="hm-era ${era}"><div class="hm-era-head"><span class="hm-era-badge">${era==='new'?'НОВОЕ РАСПИСАНИЕ':'СТАРОЕ РАСПИСАНИЕ'}</span><b>${era==='new'?'№267756 и далее':'по №267755 включительно'}</b><span class="hm-era-sub">${era==='new'?'LIVE · свежая дата сверху':'архив без смешивания с новой сеткой'}</span></div>`;
    h+=`<div class="hm-table-wrap"><table class="hm-table"><thead><tr><th class="hm-date-head">Дата / день</th>${times.map(t=>`<th class="hm-time">${t}</th>`).join('')}</tr></thead><tbody>`;
    for(const [date] of gs){
      h+=`<tr><td class="hm-date">${date} <span class="weekday">${weekday(date)}</span></td>`;
      for(const t of times)h+=page==='ALL'?all(map,date,t,times):single(map,date,t,page,times);
      h+='</tr>';
    }
    return h+'</tbody></table></div></section>';
  }

  function render(){
    const root=document.getElementById('horizontalMatrix');if(!root)return;
    const n=eraHtml('new'),o=eraHtml('old');
    root.innerHTML=n+(n&&o?`<div class="hm-era-divider"><span>СМЕНА РАСПИСАНИЯ · 08.09.2026</span></div>`:'')+o;
    root.querySelectorAll('[data-digit]').forEach(el=>el.onclick=()=>{const x=+el.dataset.digit;state.activeDigits.has(x)?state.activeDigits.delete(x):state.activeDigits.add(x);renderAll()});
    const title=document.getElementById('hmPageTitle');if(title)title.textContent=page==='ALL'?'ОБЩАЯ · A+B+C':`${LABELS[page]} · ${page}`;
    document.querySelectorAll('[data-hm-page]').forEach(b=>b.classList.toggle('active',b.dataset.hmPage===page));
  }
  renderHorizontal=render;

  function setPage(p){if(PAGES.includes(p)){page=p;render()}}
  function buttons(){return PAGES.map(p=>`<button class="hm-page-btn ${p===page?'active':''}" data-hm-page="${p}">${LABELS[p]}</button>`).join('')}
  function ready(){
    injectStyle();
    const pager=document.getElementById('hmPager');
    if(pager&&pager.dataset.bound!=='1'){
      pager.dataset.bound='1';pager.innerHTML=buttons();
      pager.addEventListener('click',e=>{const b=e.target.closest('[data-hm-page]');if(b)setPage(b.dataset.hmPage)});
      pager.addEventListener('touchstart',e=>touchX=e.touches?.[0]?.clientX??null,{passive:true});
      pager.addEventListener('touchend',e=>{if(touchX==null)return;const x=e.changedTouches?.[0]?.clientX??touchX,dx=x-touchX;touchX=null;if(Math.abs(dx)<45)return;const i=PAGES.indexOf(page);setPage(PAGES[(i+(dx<0?1:-1)+PAGES.length)%PAGES.length])},{passive:true});
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();
})();
