'use strict';

(() => {
  const CONFIGS=[
    {card:'#matrixView .stats-card',body:'#frequencyBars',key:'pozitron.matrix.frequency.collapsed.v1'},
    {card:'#matrixView .status-card',body:'#matrixStatus',key:'pozitron.matrix.status.collapsed.v1'}
  ];

  function ensureStyles(){
    if(document.getElementById('matrixCardCollapseStyles'))return;
    const style=document.createElement('style');
    style.id='matrixCardCollapseStyles';
    style.textContent=`
      .matrix-card-collapse-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}
      .matrix-card-collapse-head h3{margin:0!important}
      .matrix-card-collapse-btn{min-height:44px;border:1px solid #315678;background:#0a2139;color:#dcecff;border-radius:12px;padding:8px 12px;font-weight:850;cursor:pointer;touch-action:manipulation;white-space:nowrap}
      .matrix-card-collapse-btn:active{transform:translateY(1px);background:#0d2b48}
      .matrix-card-collapse-btn:focus-visible{outline:3px solid #55d8ff;outline-offset:2px}
      .matrix-card-collapsed{padding-top:12px!important;padding-bottom:12px!important}
      .matrix-card-collapsed .matrix-card-collapse-head{margin-bottom:0}
      @media(max-width:900px){.matrix-card-collapse-btn{font-size:13px;padding:8px 10px}.matrix-card-collapse-head{gap:8px}}
    `;
    document.head.appendChild(style);
  }

  function read(key){try{return localStorage.getItem(key)==='1'}catch(_){return false}}
  function write(key,value){try{localStorage.setItem(key,value?'1':'0')}catch(_){}}

  function initOne(cfg){
    const card=document.querySelector(cfg.card),body=document.querySelector(cfg.body);
    const title=card?.querySelector('h3');
    if(!card||!body||!title||card.dataset.matrixCollapseReady==='1')return;
    card.dataset.matrixCollapseReady='1';

    const head=document.createElement('div');
    head.className='matrix-card-collapse-head';
    title.parentNode.insertBefore(head,title);
    head.appendChild(title);

    const button=document.createElement('button');
    button.type='button';
    button.className='matrix-card-collapse-btn';
    head.appendChild(button);

    let collapsed=read(cfg.key);
    const apply=()=>{
      card.classList.toggle('matrix-card-collapsed',collapsed);
      if(collapsed)body.style.setProperty('display','none','important');
      else body.style.removeProperty('display');
      body.hidden=collapsed;
      button.setAttribute('aria-expanded',String(!collapsed));
      button.textContent=collapsed?'Развернуть ▼':'Свернуть ▲';
      button.title=collapsed?'Показать блок':'Скрыть блок';
    };

    button.addEventListener('click',()=>{
      collapsed=!collapsed;
      write(cfg.key,collapsed);
      apply();
    });
    apply();
  }

  function boot(){ensureStyles();CONFIGS.forEach(initOne)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
