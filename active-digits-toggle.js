'use strict';

(() => {
  const STORAGE_KEY='pozitron.matrix.activeDigits.collapsed.v1';

  function injectStyles(){
    if(document.getElementById('activeDigitsToggleStyles'))return;
    const style=document.createElement('style');
    style.id='activeDigitsToggleStyles';
    style.textContent=`
      .active-card-toggle-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}
      .active-card-toggle-head h3{margin:0!important}
      .active-card-toggle-btn{min-height:44px;border:1px solid #315678;background:#0a2139;color:#dcecff;border-radius:12px;padding:8px 12px;font-weight:850;cursor:pointer;touch-action:manipulation;white-space:nowrap}
      .active-card-toggle-btn:active{transform:translateY(1px);background:#0d2b48}
      .active-card-toggle-btn:focus-visible{outline:3px solid #55d8ff;outline-offset:2px}
      .active-card.active-card-collapsed{padding-top:12px!important;padding-bottom:12px!important}
      .active-card.active-card-collapsed .active-card-toggle-head{margin-bottom:0}
      @media(max-width:900px){.active-card-toggle-btn{font-size:13px;padding:8px 10px}.active-card-toggle-head{gap:8px}}
    `;
    document.head.appendChild(style);
  }

  function readCollapsed(){
    try{return localStorage.getItem(STORAGE_KEY)==='1'}catch(_){return false}
  }
  function saveCollapsed(value){
    try{localStorage.setItem(STORAGE_KEY,value?'1':'0')}catch(_){/* no-op */}
  }

  function boot(){
    injectStyles();
    const card=document.querySelector('#matrixView .active-card');
    if(!card||card.dataset.collapsibleReady==='1')return;
    const title=card.querySelector('h3');
    const grid=card.querySelector('#activeDigitButtons');
    const count=card.querySelector('#selectedCount');
    if(!title||!grid||!count)return;

    card.dataset.collapsibleReady='1';
    const head=document.createElement('div');
    head.className='active-card-toggle-head';
    title.parentNode.insertBefore(head,title);
    head.appendChild(title);

    const button=document.createElement('button');
    button.type='button';
    button.className='active-card-toggle-btn';
    button.setAttribute('aria-controls','activeDigitButtons selectedCount');
    head.appendChild(button);

    let collapsed=readCollapsed();
    const apply=()=>{
      card.classList.toggle('active-card-collapsed',collapsed);
      grid.hidden=collapsed;
      count.hidden=collapsed;
      button.setAttribute('aria-expanded',String(!collapsed));
      button.textContent=collapsed?'Развернуть ▼':'Свернуть ▲';
      button.title=collapsed?'Показать активные цифры':'Скрыть активные цифры';
    };

    button.addEventListener('click',()=>{
      collapsed=!collapsed;
      saveCollapsed(collapsed);
      apply();
    });

    apply();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
