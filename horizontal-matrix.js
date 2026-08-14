'use strict';

/*
  ПОЗИТРОН · MATRIX TOP-3
  Горизонталь: 4 подвижные страницы
  1 столб (A) → 2 столб (B) → 3 столб (C) → 3 столба

  Цвета переходов:
  Синий        — повтор на вторые сутки (то же время, предыдущая дата)
  Зелёный      — повтор по вертикали вправо (на предыдущей дате та же цифра справа)
  Оранжевый    — повтор по вертикали влево (на предыдущей дате та же цифра слева)
  Светло-голубой — повтор на третьи сутки (то же время, дата -2)
*/

(() => {
  const PAGES = ['A', 'B', 'C', 'ALL'];
  const LABELS = {
    A: '1 СТОЛБ',
    B: '2 СТОЛБ',
    C: '3 СТОЛБ',
    ALL: '3 СТОЛБА'
  };
  const POS = { A: 'a', B: 'b', C: 'c' };
  let page = 'A';
  let touchX = null;

  function injectStyle() {
    if (document.getElementById('hm-inline-style')) return;
    const style = document.createElement('style');
    style.id = 'hm-inline-style';
    style.textContent = `
      #horizontalView .hm-card{padding:12px;overflow:hidden}
      #horizontalView .hm-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}
      #horizontalView .hm-head h2{margin:0;font-size:26px}
      #horizontalView .hm-head p{margin:4px 0 0;color:var(--muted)}
      .hm-pager{display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;padding:4px 0 9px;-webkit-overflow-scrolling:touch;touch-action:pan-x}
      .hm-pager::-webkit-scrollbar{display:none}
      .hm-page-btn{flex:0 0 auto;border:1px solid #31506b;border-radius:11px;background:#07182a;color:#cbd5e1;padding:10px 14px;font-weight:800;white-space:nowrap;cursor:pointer}
      .hm-page-btn.active{background:#063f60;border-color:var(--cyan);color:#fff;box-shadow:0 0 12px rgba(0,207,255,.18)}
      .hm-legend{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px;font-size:12px;color:#d4deea}
      .hm-legend span{display:flex;align-items:center;gap:6px;background:#061423;border:1px solid #203b54;border-radius:999px;padding:6px 9px}
      .hm-dot{width:13px;height:13px;border-radius:3px;display:inline-block;border:1px solid rgba(0,0,0,.18)}
      .hm-blue{background:#13a9e7!important;color:#06111f!important}
      .hm-green{background:#79c74b!important;color:#06111f!important}
      .hm-orange{background:#f2a11d!important;color:#06111f!important}
      .hm-lightblue{background:#a8d8f0!important;color:#06111f!important}
      .hm-neutral{background:#eaf2f8!important;color:#07111c!important}
      .hm-table-wrap{overflow:auto;max-height:70vh;border:1px solid #24435e;border-radius:13px;background:#03101c;-webkit-overflow-scrolling:touch}
      .hm-table{border-collapse:separate;border-spacing:0;min-width:980px;width:100%;table-layout:fixed;background:#f2f5f8;color:#07111c}
      .hm-table th,.hm-table td{border-right:1px solid #8f9aa5;border-bottom:1px solid #8f9aa5;text-align:center;height:42px;padding:0;font-weight:850}
      .hm-table thead th{position:sticky;top:0;z-index:9;background:#ffe633;color:#101010;font-size:13px}
      .hm-date-head,.hm-date{position:sticky;left:0;z-index:11!important;background:#ffe633!important;color:#101010!important;min-width:116px;width:116px;padding:0 7px!important}
      .hm-date{font-size:13px;white-space:nowrap}
      .hm-time{min-width:82px;width:82px}
      .hm-cell{position:relative;font-size:19px;transition:filter .12s ease}
      .hm-cell:active{filter:brightness(.92)}
      .hm-cell.hm-dim{opacity:.25}
      .hm-empty{background:#e5ebf0!important;color:#8d99a5!important;font-weight:500!important}
      .hm-all-cell{padding:3px!important;background:#dce5ec!important}
      .hm-triplet{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;height:35px;padding:2px}
      .hm-mini{display:grid;place-items:center;border-radius:5px;font-size:16px;font-weight:950;border:1px solid rgba(0,0,0,.15)}
      .hm-mini.hm-neutral{background:#f6f8fa!important}
      .hm-selected{outline:3px solid #fff!important;box-shadow:inset 0 0 0 2px #08213a,0 0 8px rgba(255,255,255,.5);z-index:2}
      .hm-page-title{font-size:13px;font-weight:900;color:#52d5ff;letter-spacing:.06em;text-align:right}
      .hm-swipe-hint{font-size:11px;color:#7e96aa;text-align:right;margin-top:2px}
      .hm-legacy{display:none!important}
      @media(max-width:900px){
        #horizontalView .hm-card{padding:8px}
        #horizontalView .hm-head h2{font-size:22px}
        .hm-page-btn{padding:9px 12px;font-size:12px}
        .hm-table{min-width:900px}
        .hm-date-head,.hm-date{min-width:104px;width:104px}
        .hm-time{min-width:76px;width:76px}
        .hm-table th,.hm-table td{height:39px}
        .hm-cell{font-size:18px}
      }
    `;
    document.head.appendChild(style);
  }

  function pageButtons() {
    return PAGES.map(p => `<button class="hm-page-btn ${p === page ? 'active' : ''}" data-hm-page="${p}">${LABELS[p]}</button>`).join('');
  }

  function drawMap() {
    return new Map(state.draws.map(d => [`${d.date}|${d.time}`, d]));
  }

  function digitAt(map, date, time, pos) {
    const d = map.get(`${date}|${time}`);
    return d ? d[POS[pos]] : null;
  }

  /*
    Цвет берём по отношению к более ранним датам.
    Приоритет одной полной заливки: синий → зелёный → оранжевый → светло-голубой.
  */
  function transitionClass(map, date, time, pos, times) {
    const value = digitAt(map, date, time, pos);
    if (value === null || value === undefined) return 'hm-empty';

    const prevDate = addDays(date, -1); // вторые сутки: следующий календарный день
    const thirdDate = addDays(date, -2); // третьи сутки
    const ti = times.indexOf(time);

    if (digitAt(map, prevDate, time, pos) === value) return 'hm-blue';

    // "вправо": на предыдущей дате совпадение находится справа от текущего времени.
    if (ti >= 0 && ti < times.length - 1 && digitAt(map, prevDate, times[ti + 1], pos) === value) return 'hm-green';

    // "влево": на предыдущей дате совпадение находится слева от текущего времени.
    if (ti > 0 && digitAt(map, prevDate, times[ti - 1], pos) === value) return 'hm-orange';

    if (digitAt(map, thirdDate, time, pos) === value) return 'hm-lightblue';

    return 'hm-neutral';
  }

  function isSelected(v) {
    return state.activeDigits && state.activeDigits.has(Number(v));
  }

  function singleCell(map, date, time, pos, times) {
    const value = digitAt(map, date, time, pos);
    if (value === null || value === undefined) return `<td class="hm-cell hm-empty">·</td>`;
    const cls = transitionClass(map, date, time, pos, times);
    const sel = isSelected(value) ? ' hm-selected' : '';
    return `<td class="hm-cell ${cls}${sel}" data-digit="${value}" title="${pos} · ${date} · ${time}">${value}</td>`;
  }

  function allCell(map, date, time, times) {
    const d = map.get(`${date}|${time}`);
    if (!d) return `<td class="hm-all-cell hm-empty">·</td>`;
    const parts = ['A','B','C'].map(pos => {
      const v = d[POS[pos]];
      const cls = transitionClass(map, date, time, pos, times);
      const sel = isSelected(v) ? ' hm-selected' : '';
      return `<span class="hm-mini ${cls}${sel}" data-digit="${v}" title="${pos} · ${date} · ${time}">${v}</span>`;
    }).join('');
    return `<td class="hm-all-cell"><div class="hm-triplet">${parts}</div></td>`;
  }

  function renderHorizontalMatrix() {
    const root = document.getElementById('horizontalMatrix');
    if (!root) return;

    const groups = daysGrouped();
    const times = scheduleTimes();
    const map = drawMap();

    let html = `<div class="hm-table-wrap"><table class="hm-table"><thead><tr><th class="hm-date-head">Дата / день</th>`;
    html += times.map(t => `<th class="hm-time">${t}</th>`).join('');
    html += `</tr></thead><tbody>`;

    for (const [date] of groups) {
      html += `<tr><td class="hm-date">${date} <span class="weekday">${weekday(date)}</span></td>`;
      for (const time of times) {
        html += page === 'ALL' ? allCell(map, date, time, times) : singleCell(map, date, time, page, times);
      }
      html += `</tr>`;
    }

    html += `</tbody></table></div>`;
    root.innerHTML = html;

    const pageTitle = document.getElementById('hmPageTitle');
    if (pageTitle) pageTitle.textContent = page === 'ALL' ? 'ОБЩАЯ · A+B+C' : `${LABELS[page]} · ${page}`;

    document.querySelectorAll('[data-hm-page]').forEach(btn => btn.classList.toggle('active', btn.dataset.hmPage === page));

    // Сохраняем старый принцип активных цифр: тап по цифре включает/выключает её.
    root.querySelectorAll('[data-digit]').forEach(el => {
      el.addEventListener('click', () => {
        const n = Number(el.dataset.digit);
        state.activeDigits.has(n) ? state.activeDigits.delete(n) : state.activeDigits.add(n);
        renderAll();
      });
    });
  }

  function setPage(next) {
    if (!PAGES.includes(next)) return;
    page = next;
    renderHorizontalMatrix();
  }

  function stepPage(dir) {
    const i = PAGES.indexOf(page);
    setPage(PAGES[(i + dir + PAGES.length) % PAGES.length]);
  }

  function bindPager() {
    const pager = document.getElementById('hmPager');
    if (!pager || pager.dataset.bound === '1') return;
    pager.dataset.bound = '1';
    pager.addEventListener('click', e => {
      const btn = e.target.closest('[data-hm-page]');
      if (btn) setPage(btn.dataset.hmPage);
    });
    pager.addEventListener('touchstart', e => {
      touchX = e.touches && e.touches[0] ? e.touches[0].clientX : null;
    }, {passive:true});
    pager.addEventListener('touchend', e => {
      if (touchX === null) return;
      const x = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : touchX;
      const dx = x - touchX;
      touchX = null;
      if (Math.abs(dx) < 45) return;
      dx < 0 ? stepPage(1) : stepPage(-1);
    }, {passive:true});
  }

  injectStyle();

  // Подменяем только старый рендер раздела "Горизонталь". Матрица и LAB не трогаются.
  renderHorizontal = renderHorizontalMatrix;

  const ready = () => {
    const pager = document.getElementById('hmPager');
    if (pager) pager.innerHTML = pageButtons();
    bindPager();
    if (document.getElementById('horizontalMatrix') && state && state.draws) renderHorizontalMatrix();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, {once:true});
  else ready();
})();
