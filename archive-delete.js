'use strict';

/* MATRIX TOP-3 · LAB archive delete v1.0.0
   Adds one simple DELETE button to each saved forecast package.
   Deletion is permanent and removes only that package from IndexedDB. */

(() => {
  const DB_NAME = 'pozitron.matrix.lab.archive.v1';
  const STORE_NAME = 'records';

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function deleteRecords(ids) {
    const db = await openDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        ids.forEach(id => store.delete(id));

        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
        tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
      });
    } finally {
      db.close();
    }
  }

  async function readRecords() {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      });
    } finally {
      db.close();
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    .archive-delete-btn{
      margin-left:auto;
      flex:0 0 auto;
      border:1px solid rgba(255,82,82,.62);
      border-radius:10px;
      background:rgba(118,24,30,.42);
      color:#ff9b9b;
      padding:8px 10px;
      font-size:11px;
      line-height:1;
      font-weight:950;
      letter-spacing:.04em;
      cursor:pointer;
      touch-action:manipulation;
    }
    .archive-delete-btn:active{
      transform:scale(.97);
      background:rgba(155,28,36,.58);
    }
    .archive-delete-btn:disabled{
      opacity:.45;
      cursor:default;
    }
    .archive-package>summary{
      gap:8px!important;
    }
    @media(max-width:700px){
      .archive-delete-btn{
        padding:9px 10px;
        font-size:10px;
      }
    }
  `;
  document.head.appendChild(style);

  function visibleGroupKeys() {
    let list = [...state.predictions].sort(
      (a, b) =>
        new Date(b.createdAt) - new Date(a.createdAt) ||
        (b.repeatIndex || 1) - (a.repeatIndex || 1)
    );

    if (state.archiveFilter !== 'all') {
      list = list.filter(p => p.resultStatus === state.archiveFilter);
    }

    const groups = new Map();
    for (const p of list) {
      const key = p.originId || p.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    return [...groups.keys()];
  }

  function injectDeleteButtons() {
    const root = document.querySelector('#labArchive');
    if (!root) return;

    const keys = visibleGroupKeys();
    const packages = root.querySelectorAll('.archive-package');

    packages.forEach((pkg, i) => {
      if (pkg.querySelector('.archive-delete-btn')) return;

      const key = keys[i];
      if (!key) return;

      const summary = pkg.querySelector(':scope > summary');
      if (!summary) return;

      const arrow = summary.querySelector('.archive-package-arrow');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'archive-delete-btn';
      btn.dataset.archiveDelete = key;
      btn.textContent = '🗑 УДАЛИТЬ';
      btn.setAttribute('aria-label', 'Удалить этот архив');

      if (arrow) summary.insertBefore(btn, arrow);
      else summary.appendChild(btn);
    });
  }

  async function removePackage(key, btn) {
    const rows = state.predictions.filter(p => (p.originId || p.id) === key);
    const ids = rows.map(p => p.id).filter(Boolean);
    if (!ids.length) return;

    btn.disabled = true;

    try {
      await deleteRecords(ids);

      const stored = await readRecords();
      const deleted = new Set(ids);
      if (stored.some(p => p && deleted.has(p.id))) {
        throw new Error('Проверка удаления не пройдена');
      }

      state.predictions = stored;

      if (typeof renderStats === 'function') renderStats();
      if (typeof renderArchive === 'function') renderArchive();
      if (typeof renderLab === 'function') renderLab();
      if (typeof toast === 'function') {
        toast(`АРХИВ УДАЛЁН · записей: ${ids.length}`);
      }
    } catch (err) {
      btn.disabled = false;
      if (typeof toast === 'function') {
        toast('ОШИБКА: архив не удалён.');
      }
      console.error('ARCHIVE DELETE ERROR:', err);
    }
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest('.archive-delete-btn');
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();

    const key = btn.dataset.archiveDelete;
    if (key) removePackage(key, btn);
  }, true);

  if (typeof renderArchive === 'function') {
    const baseRenderArchive = renderArchive;
    renderArchive = function() {
      const result = baseRenderArchive();
      injectDeleteButtons();
      return result;
    };
  }

  setTimeout(injectDeleteButtons, 0);
})();
