'use strict';

// The two views have different cell widths. Share a time, not a pixel offset.
window.scheduleScroll = (() => {
  const times = new Map();
  const rows = new Map();
  const headers = el => [...el.querySelectorAll('.hm-time, .time-head')];
  const label = el => (el.querySelector('.time-title') || el).textContent.trim();
  const visible = el => el.getClientRects().length > 0 && el.clientWidth > 0;
  const edge = el => el.getBoundingClientRect().left + el.clientLeft +
    el.querySelector('.hm-date-head, .date-head').getBoundingClientRect().width;

  function capture(root) {
    if (!root) return;
    const outer = root.closest('.matrix-scroll');
    if (outer && visible(outer)) rows.set(root.id + ':outer', outer.scrollTop);
    root.querySelectorAll('[data-schedule-era]').forEach(el => {
      if (!visible(el)) return; // A hidden view reports zero and must not erase the time.
      const era = el.dataset.scheduleEra;
      const left = edge(el);
      const cell = headers(el).find(h => h.getBoundingClientRect().right > left + 0.5);
      if (cell && el.scrollWidth > el.clientWidth + 1) {
        const rect = cell.getBoundingClientRect();
        times.set(era, {time: label(cell), fraction: (left - rect.left) / rect.width});
      }
      rows.set(root.id + ':' + era, el.scrollTop);
    });
  }

  function restore(root) {
    if (!root) return;
    root.querySelectorAll('[data-schedule-era]').forEach(el => {
      if (!visible(el)) return;
      const era = el.dataset.scheduleEra, saved = times.get(era);
      if (saved) {
        const cell = headers(el).find(h => label(h) === saved.time);
        if (cell) {
          const rect = cell.getBoundingClientRect();
          el.scrollLeft += rect.left - edge(el) + saved.fraction * rect.width;
        }
      }
      el.scrollTop = rows.get(root.id + ':' + era) || 0;
    });
    const outer = root.closest('.matrix-scroll');
    if (outer && visible(outer)) outer.scrollTop = rows.get(root.id + ':outer') || 0;
  }

  return {capture, restore};
})();
