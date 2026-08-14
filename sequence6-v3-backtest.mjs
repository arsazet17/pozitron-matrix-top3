import fs from 'node:fs';

const DATA_FILE='top3-live.json';
const OUT_JSON='sequence6-v3-report.json';
const OUT_MD='sequence6-v3-report.md';

const TARGET_TIME='02:40';
const L=6;
const TIMES=['02:40','04:40','06:40','07:40','09:40','11:40','13:40','16:25','21:25','22:40'];
const KEYS=['a','b','c']; // three separate TOP-3 digit matrices

function parseDate(s){
  const [dd,mm,yy]=s.split('.').map(Number);
  return new Date(Date.UTC(2000+yy,mm-1,dd));
}
function prevDateKey(s){
  const d=parseDate(s); d.setUTCDate(d.getUTCDate()-1);
  const dd=String(d.getUTCDate()).padStart(2,'0');
  const mm=String(d.getUTCMonth()+1).padStart(2,'0');
  const yy=String(d.getUTCFullYear()%100).padStart(2,'0');
  return `${dd}.${mm}.${yy}`;
}
function sim(a,b){
  let n=0; for(let i=0;i<L;i++) if(a[i]===b[i]) n++; return n;
}
function weight(n){
  if(n===6) return 1.0;
  if(n===5) return 0.60;
  if(n===4) return 0.30;
  if(n===3) return 0.10;
  return 0;
}
function vote(map,digit,w,src){
  if(!map.has(digit)) map.set(digit,{score:0,evidence:0,sources:{}});
  const x=map.get(digit);
  x.score+=w; x.evidence++;
  x.sources[src]=(x.sources[src]||0)+1;
}
function rank(map){
  const a=[...map.entries()].map(([digit,x])=>({digit,...x}));
  a.sort((x,y)=>y.score-x.score || y.evidence-x.evidence || x.digit-y.digit);
  const sum=a.reduce((s,x)=>s+x.score,0)||1;
  return a.map(x=>({...x,p:x.score/sum}));
}

const raw=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
const draws=[...raw.draws].sort((x,y)=>x.id-y.id);

const byDate=new Map();
for(const d of draws){
  if(!byDate.has(d.date)) byDate.set(d.date,new Map());
  byDate.get(d.date).set(d.time,d);
}
const dates=[...byDate.keys()].sort((a,b)=>parseDate(a)-parseDate(b));

function pastDates(date){ return dates.filter(d=>parseDate(d)<parseDate(date)); }

function verticalPattern(targetDate,key){
  const ds=pastDates(targetDate).filter(d=>byDate.get(d)?.has(TARGET_TIME));
  if(ds.length<L) return null;
  return ds.slice(-L).map(d=>byDate.get(d).get(TARGET_TIME)[key]);
}
function horizontalPattern(targetDate,key){
  const pd=prevDateKey(targetDate);
  const row=byDate.get(pd);
  if(!row) return null;
  const vals=TIMES.map(t=>row.get(t)?.[key]);
  if(vals.some(v=>v===undefined)) return null;
  return vals.slice(-L);
}

// IMPORTANT v3: search ONLY inside the same digit matrix.
// a-pattern is searched only inside matrix A, etc.
function searchVerticalSameMatrix(pattern,targetDate,key,label){
  const out=new Map(), cutoff=parseDate(targetDate);
  for(const time of TIMES){
    const vals=[];
    for(const d of dates){
      if(parseDate(d)>=cutoff) break;
      const draw=byDate.get(d)?.get(time);
      if(draw) vals.push(draw[key]);
    }
    for(let i=0;i+L<vals.length;i++){
      const s=sim(pattern,vals.slice(i,i+L));
      const w=weight(s);
      if(w>0) vote(out,vals[i+L],w,`${label}:V:${s}`);
    }
  }
  return out;
}

function searchHorizontalSameMatrix(pattern,targetDate,key,label){
  const out=new Map(), cutoff=parseDate(targetDate);
  for(const d of dates){
    if(parseDate(d)>=cutoff) break;
    const row=byDate.get(d);
    if(!row) continue;
    const vals=TIMES.map(t=>row.get(t)?.[key]);
    if(vals.some(v=>v===undefined)) continue;
    for(let start=0;start+L<TIMES.length;start++){
      const s=sim(pattern,vals.slice(start,start+L));
      const w=weight(s);
      if(w>0) vote(out,vals[start+L],w,`${label}:H:${s}`);
    }
  }
  return out;
}

function merge(...maps){
  const out=new Map();
  for(const m of maps){
    for(const [d,x] of m){
      if(!out.has(d)) out.set(d,{score:0,evidence:0,sources:{}});
      const y=out.get(d);
      y.score+=x.score; y.evidence+=x.evidence;
      for(const [k,v] of Object.entries(x.sources)) y.sources[k]=(y.sources[k]||0)+v;
    }
  }
  for(const x of out.values()){
    const hasV=Object.keys(x.sources).some(k=>k.includes(':V:'));
    const hasH=Object.keys(x.sources).some(k=>k.includes(':H:'));
    if(hasV&&hasH) x.score+=0.35;
  }
  return out;
}

function predictDigit(targetDate,key){
  const vp=verticalPattern(targetDate,key);
  const hp=horizontalPattern(targetDate,key);
  if(!vp||!hp) return null;

  const vv=searchVerticalSameMatrix(vp,targetDate,key,'VP');
  const vh=searchHorizontalSameMatrix(vp,targetDate,key,'VP');
  const hv=searchVerticalSameMatrix(hp,targetDate,key,'HP');
  const hh=searchHorizontalSameMatrix(hp,targetDate,key,'HP');

  const r=rank(merge(vv,vh,hv,hh));
  if(!r.length) return null;
  return {vp,hp,ranked:r,top2:r.slice(0,2)};
}

function top4(per){
  if(per.some(x=>!x||!x.length)) return [];
  const combos=[];
  for(const a of per[0]) for(const b of per[1]) for(const c of per[2]){
    combos.push({
      combo:`${a.digit}${b.digit}${c.digit}`,
      p:(a.p||1e-12)*(b.p||1e-12)*(c.p||1e-12),
      score:a.score+b.score+c.score
    });
  }
  combos.sort((x,y)=>y.p-x.p||y.score-x.score||x.combo.localeCompare(y.combo));
  return combos.slice(0,4);
}

const tests=[];
for(const date of dates){
  const target=byDate.get(date)?.get(TARGET_TIME);
  if(!target) continue;
  if(pastDates(date).length<7) continue;

  const preds=[];
  let ok=true;
  for(const k of KEYS){
    const r=predictDigit(date,k);
    if(!r){ok=false;break;}
    preds.push(r);
  }
  if(!ok) continue;

  const combos=top4(preds.map(x=>x.top2));
  if(!combos.length) continue;

  const actual=`${target.a}${target.b}${target.c}`;
  tests.push({
    date,id:target.id,actual,
    combos,
    hit:combos.some(x=>x.combo===actual),
    digits:KEYS.map((k,i)=>({
      key:k,
      actual:target[k],
      top1:preds[i].top2[0]?.digit===target[k],
      top2:preds[i].top2.some(x=>x.digit===target[k]),
      verticalPattern:preds[i].vp,
      horizontalPattern:preds[i].hp,
      candidates:preds[i].ranked.slice(0,10)
    }))
  });
}

function pct(n,d){return d?100*n/d:0}
const summary={
  tests:tests.length,
  exactTop4Hits:tests.filter(t=>t.hit).length,
  exactTop4Pct:pct(tests.filter(t=>t.hit).length,tests.length),
  positions:KEYS.map((k,i)=>({
    key:k,
    top1:tests.filter(t=>t.digits[i].top1).length,
    top1Pct:pct(tests.filter(t=>t.digits[i].top1).length,tests.length),
    top2:tests.filter(t=>t.digits[i].top2).length,
    top2Pct:pct(tests.filter(t=>t.digits[i].top2).length,tests.length),
  }))
};

const report={
  generatedAt:new Date().toISOString(),
  method:{
    name:'Matrix TOP-3 Sequence-6 v3',
    rule:'Each TOP-3 digit is its own independent matrix. A is searched only in A, B only in B, C only in C.',
    targetTime:TARGET_TIME,
    sequenceLength:L,
    similarityWeights:{'6/6':1,'5/6':0.6,'4/6':0.3,'3/6':0.1},
    leakageControl:'Only dates strictly before the target date are used.'
  },
  summary,
  recent:tests.slice(-20).reverse(),
  tests
};
fs.writeFileSync(OUT_JSON,JSON.stringify(report,null,2));

const md=[];
md.push('# Matrix TOP-3 · Sequence-6 v3');
md.push('');
md.push('Три разряда TOP-3 тестируются как три отдельные матрицы.');
md.push('');
md.push(`- Проверок: **${summary.tests}**`);
md.push(`- Точный TOP-3 среди 4 комбинаций: **${summary.exactTop4Hits}/${summary.tests} = ${summary.exactTop4Pct.toFixed(2)}%**`);
for(const p of summary.positions){
  md.push(`- ${p.key.toUpperCase()}: top-1 **${p.top1Pct.toFixed(2)}%**, факт в top-2 **${p.top2Pct.toFixed(2)}%**`);
}
md.push('');
md.push('| Дата | Факт | 4 комбинации |');
md.push('|---|---:|---|');
for(const t of report.recent){
  md.push(`| ${t.date} | ${t.actual} | ${t.combos.map(x=>x.combo).join(', ')} ${t.hit?'✅':''} |`);
}
fs.writeFileSync(OUT_MD,md.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n'));

console.log('=== MATRIX TOP-3 SEQUENCE-6 v3 ===');
console.log(`tests=${summary.tests}`);
console.log(`top4 hits=${summary.exactTop4Hits}/${summary.tests} = ${summary.exactTop4Pct.toFixed(2)}%`);
for(const p of summary.positions){
  console.log(`${p.key}: top1=${p.top1Pct.toFixed(2)}%, top2=${p.top2Pct.toFixed(2)}%`);
}
