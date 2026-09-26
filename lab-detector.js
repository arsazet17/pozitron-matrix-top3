'use strict';
/* LAB MATRIX v1.7 loader: the Branch module is isolated from the legacy LAB storage. */
(function(){
  const css=document.createElement('link');
  css.rel='stylesheet';css.href='./branch-lab.css?v=1.7.0';document.head.appendChild(css);
  const engine=document.createElement('script');
  engine.src='./vector-branch-engine.js?v=1.7.0';
  engine.onload=()=>{const ui=document.createElement('script');ui.src='./branch-lab.js?v=1.7.0';document.head.appendChild(ui)};
  engine.onerror=()=>console.error('LAB BRANCH: vector engine failed to load');
  document.head.appendChild(engine);
})();
