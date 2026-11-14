'use strict';
/* ПОЗИТРОН · МАТРИЦА ТОП-3 · LAB «СТУПЕНИ» · движок
   Линия (ступени) = одна и та же цифра по диагонали в трёх тиражах подряд:
     «/»  C(тираж 1) → B(тираж 2) → A(тираж 3)   пример 6-9-2 → 6-2-7 → 2-3-8
     «\»  A(тираж 1) → B(тираж 2) → C(тираж 3)
   После линии ждём тройку той же цифры (X-X-X) в окне WINDOW тиражей. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.LabStepsCore=api;
})(typeof self!=='undefined'?self:this,function(){
  const VERSION='1.0.0';
  const WINDOW=20;
  const KINDS=[{kind:'/',from:'c',to:'a'},{kind:'\\',from:'a',to:'c'}];
  const POS_NAME={a:'A',b:'B',c:'C'};

  function norm(d){return {id:Number(d.id),date:d.date,time:d.time,a:Number(d.a),b:Number(d.b),c:Number(d.c)}}
  /* draws: любой порядок → хронологический список без дублей */
  function chrono(draws){
    const m=new Map();(draws||[]).forEach(d=>{if(d&&Number.isFinite(Number(d.id)))m.set(Number(d.id),norm(d))});
    return [...m.values()].sort((x,y)=>x.id-y.id);
  }
  function combo(d){return [d.a,d.b,d.c]}
  function isTriple(d,x){return d.a===d.b&&d.b===d.c&&(x==null||d.a===x)}
  function consecutive(R,k,n){for(let j=k-n+1;j<=k;j++){if(j<0||!R[j])return false;if(j>k-n+1&&R[j].id!==R[j-1].id+1)return false}return true}

  /* линии, которые закончились на тираже k */
  function linesAt(R,k){
    if(!consecutive(R,k,3))return [];
    const out=[];
    for(const K of KINDS){const x=R[k-2][K.from];if(R[k-1].b===x&&R[k][K.to]===x)out.push({kind:K.kind,digit:x})}
    return out;
  }
  /* полный разбор: каждая линия + через сколько вышла тройка той же цифры / любая тройка */
  function scan(draws,opts={}){
    const R=Array.isArray(draws)&&draws.length&&draws[0]&&draws[0].__chrono?draws:chrono(draws);
    const W=opts.window||WINDOW,events=[];
    for(let k=2;k<R.length;k++){
      for(const L of linesAt(R,k)){
        let lag=null,lagAny=null,anyDigit=null;
        for(let j=k+1;j<R.length;j++){
          if(R[j].id-R[j-1].id!==1)break;            // разрыв архива — дальше не считаем
          if(lagAny==null&&isTriple(R[j])){lagAny=j-k;anyDigit=R[j].a}
          if(isTriple(R[j],L.digit)){lag=j-k;break}
          if(j-k>=Math.max(W,400))break;
        }
        const passed=R.length-1-k;
        events.push({...L,idx:k,id:R[k].id,date:R[k].date,time:R[k].time,
          path:[R[k-2],R[k-1],R[k]].map(d=>({id:d.id,date:d.date,time:d.time,combo:combo(d)})),
          lag,lagAny,anyDigit,passed,
          state:lag!=null&&lag<=W?'hit':(passed>=W?'miss':'watch')});
      }
    }
    return {R,events,window:W};
  }
  /* статистика по архиву: как часто тройка той же цифры приходила в окне W */
  function stats(events,W=WINDOW){
    const closed=events.filter(e=>e.passed>=W||e.state==='hit');
    const n=closed.length,hit=closed.filter(e=>e.lag!=null&&e.lag<=W),any=closed.filter(e=>e.lagAny!=null&&e.lagAny<=W);
    const lags=hit.map(e=>e.lag).sort((a,b)=>a-b);
    const chanceSame=(1-Math.pow(0.999,W))*100,chanceAny=(1-Math.pow(0.99,W))*100;
    return {n,hit:hit.length,any:any.length,pSame:n?hit.length/n*100:0,pAny:n?any.length/n*100:0,chanceSame,chanceAny,lags,
      medianLag:lags.length?lags[Math.floor((lags.length-1)/2)]:null,zone:lags.length?[lags[Math.floor(lags.length*0.25)],lags[Math.floor(lags.length*0.75)]]:null};
  }
  /* активные сигналы: линия есть, тройки ещё не было, окно не вышло */
  function active(events){return events.filter(e=>e.state==='watch').sort((a,b)=>b.id-a.id)}
  /* линия строится: две ступени уже есть, третья — в следующем тираже */
  function forming(R){
    const k=R.length-1;if(k<1||!consecutive(R,k,2))return [];
    const out=[];
    for(const K of KINDS){const x=R[k-1][K.from];if(R[k].b===x)out.push({kind:K.kind,digit:x,needPos:POS_NAME[K.to],path:[R[k-1],R[k]].map(d=>({id:d.id,date:d.date,time:d.time,combo:combo(d)}))})}
    return out;
  }
  function plan(draws,opts={}){
    const s=scan(draws,opts),R=s.R;if(!R.length)return null;
    return {version:VERSION,window:s.window,latest:R[R.length-1],events:s.events,active:active(s.events),forming:forming(R),stats:stats(s.events,s.window)};
  }
  function selfTest(){
    // реальный фрагмент 13.11.26: линия двоек 15:25→16:25, 2-2-2 через 12 тиражей
    const raw=[[270910,6,9,2],[270911,6,2,7],[270912,2,3,8],[270913,1,8,2],[270914,7,4,4],[270915,7,1,6],[270916,9,6,3],[270917,1,8,5],[270918,9,8,3],[270919,1,8,8],[270920,1,6,8],[270921,6,2,0],[270922,5,2,2],[270923,6,8,6],[270924,2,2,2]];
    const d=raw.map(([id,a,b,c])=>({id,date:'13.11.26',time:'',a,b,c}));
    const s=scan(d),e=s.events.find(x=>x.digit===2&&x.kind==='/');
    const f=forming(chrono([{id:1,a:0,b:0,c:5},{id:2,a:3,b:5,c:9}]));
    const checks=[!!e,e&&e.lag===12,e&&e.state==='hit',f.length===1&&f[0].digit===5&&f[0].needPos==='A',linesAt(chrono([{id:1,a:4,b:0,c:0},{id:2,a:0,b:4,c:0},{id:4,a:0,b:0,c:4}]),2).length===0];
    return {ok:checks.every(Boolean),checks};
  }
  return {VERSION,WINDOW,chrono,linesAt,scan,stats,active,forming,plan,selfTest};
});
