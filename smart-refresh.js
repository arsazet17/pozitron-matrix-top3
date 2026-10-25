'use strict';

// Экономное автообновление: спрашиваем сервер «файл изменился?» (ETag / Last-Modified).
// Если нет — ответ 304 без тела (~1 КБ), JSON не скачивается и не разбирается.
// В свёрнутом приложении проверки не идут; при возврате — сразу одна проверка.
(() => {
  const tags = new Map();
  const base = url => String(url).split('?')[0];

  async function fetchJsonIfChanged(url) {
    const key = base(url), tag = tags.get(key), headers = {};
    if (tag && tag.etag) headers['If-None-Match'] = tag.etag;
    else if (tag && tag.lm) headers['If-Modified-Since'] = tag.lm;
    const response = await fetch(`${key}?t=${Date.now()}`, { cache: 'no-store', headers });
    if (response.status === 304) return { changed: false };
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    tags.set(key, { etag: response.headers.get('ETag'), lm: response.headers.get('Last-Modified') });
    return { changed: true, data };
  }

  function every(task, ms) {
    let busy = false, last = 0;
    const run = async (force) => {
      if (busy || document.visibilityState === 'hidden') return;
      if (!force && Date.now() - last < ms * 0.5) return;
      busy = true; last = Date.now();
      try { await task(); } catch (_) { /* следующая проверка повторит */ } finally { busy = false; }
    };
    setInterval(() => run(true), ms);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(false); });
    window.addEventListener('online', () => run(true));
    return run;
  }

  window.SmartRefresh = { fetchJsonIfChanged, every, version: '1.11.0' };
})();
