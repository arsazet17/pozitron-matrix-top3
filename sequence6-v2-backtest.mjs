import fs from 'node:fs';

const DATA_FILE = 'top3-live.json';
const REPORT_JSON = 'sequence6-v2-report.json';
const REPORT_MD = 'sequence6-v2-report.md';

const TARGET_TIME = '02:40';
const L = 6;
const TIMES = ['02:40','04:40','06:40','07:40','09:40','11:40','13:40','16:25','21:25','22:40'];
const KEYS = ['a','b','c'];

const MODES = {
  verticalOnly:   { useVV:true,  useVH:false, useHV:false, useHH:false },
  horizontalOnly: { useVV:false, useVH:false, useHV:false, useHH:true  },
  verticalCross:  { useVV:true,  useVH:true,  useHV:false, useHH:false },
  horizontalCross:{ useVV:false, useVH:false, useHV:true,  useHH:true  },
  combined:       { useVV:true,  useVH:true,  useHV:true,  useHH:true  },
};

function parseDate(s) {
  const [dd, mm, yy] = s.split('.').map(Number);
  return new Date(Date.UTC(2000 + yy, mm - 1, dd));
}
function dateKey(d) {
  const dd = String(d.getUTCDate()).padStart(2,'0');
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const yy = String(d.getUTCFullYear()%100).padStart(2,'0');
  return `${dd}.${mm}.${yy}`;
}
function prevDateKey(s) {
  const d = parseDate(s);
  d.setUTCDate(d.getUTCDate()-1);
  return dateKey(d);
}
function similarity(a,b) {
  let n=0;
  for (let i=0;i<L;i++) if (a[i]===b[i]) n++;
  return n;
}
function simWeight(sim) {
  // Preserve order; relax only by number of exact positions.
  if (sim===6) return 1.00;
  if (sim===5) return 0.55;
  if (sim===4) return 0.25;
  if (sim===3) return 0.08;
  return 0;
}
function addVote(map, digit, weight, tag) {
  if (!map.has(digit)) map.set(digit,{score:0, evidence:0, tags:{}});
  const x=map.get(digit);
  x.score += weight;
  x.evidence += 1;
  x.tags[tag]=(x.tags[tag]||0)+1;
}
function mergeMaps(...maps) {
  const out=new Map();
  for (const m of maps) {
    for (const [d,x] of m) {
      if (!out.has(d)) out.set(d,{score:0,evidence:0,tags:{}});
      const y=out.get(d);
      y.score += x.score;
      y.evidence += x.evidence;
      for (const [k,v] of Object.entries(x.tags)) y.tags[k]=(y.tags[k]||0)+v;
    }
  }
  return out;
}
function rank(map) {
  const arr=[...map.entries()].map(([digit,x])=>({digit,...x}));
  arr.sort((a,b)=>b.score-a.score || b.evidence-a.evidence || a.digit-b.digit);
  const sum=arr.reduce((s,x)=>s+x.score,0);
  return arr.map(x=>({...x,p:sum?x.score/sum:0}));
}
function top2(arr) { return arr.slice(0,2); }

const raw = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
const draws=[...raw.draws].sort((a,b)=>a.id-b.id);

const byDate=new Map();
for (const d of draws) {
  if (!byDate.has(d.date)) byDate.set(d.date,new Map());
  byDate.get(d.date).set(d.time,d);
}
const dates=[...byDate.keys()].sort((a,b)=>parseDate(a)-parseDate(b));

function pastDates(targetDate) {
  return dates.filter(d=>parseDate(d)<parseDate(targetDate));
}

// Pattern A: last 6 values vertically at TARGET_TIME for one digit position.
function getVerticalPattern(targetDate,key) {
  const arr=pastDates(targetDate).filter(d=>byDate.get(d)?.has(TARGET_TIME));
  if (arr.length<L) return null;
  return arr.slice(-L).map(d=>byDate.get(d).get(TARGET_TIME)[key]);
}

// Pattern B: last 6 values horizontally from previous completed row for one digit position.
function getHorizontalPattern(targetDate,key) {
  const pd=prevDateKey(targetDate);
  const row=byDate.get(pd);
  if (!row) return null;
  const vals=TIMES.map(t=>row.get(t)?.[key]);
  if (vals.some(v=>v===undefined)) return null;
  return vals.slice(-L);
}

// Search a sequence inside every vertical column (all times, all digit matrices).
function searchInVerticals(pattern,targetDate,tagPrefix) {
  const out=new Map();
  const cutoff=parseDate(targetDate);

  for (const key of KEYS) {
    for (const time of TIMES) {
      const vals=[];
      for (const d of dates) {
        if (parseDate(d)>=cutoff) break;
        const row=byDate.get(d);
        const draw=row?.get(time);
        if (draw) vals.push(draw[key]);
      }
      for (let i=0;i+L<vals.length;i++) {
        const seq=vals.slice(i,i+L);
        const next=vals[i+L];
        const sim=similarity(pattern,seq);
        const w=simWeight(sim);
        if (w>0) addVote(out,next,w,`${tagPrefix}:V:${sim}`);
      }
    }
  }
  return out;
}

// Search a sequence inside every horizontal row (all dates, all digit matrices).
function searchInHorizontals(pattern,targetDate,tagPrefix) {
  const out=new Map();
  const cutoff=parseDate(targetDate);

  for (const d of dates) {
    if (parseDate(d)>=cutoff) break;
    const row=byDate.get(d);
    if (!row) continue;

    for (const key of KEYS) {
      const vals=TIMES.map(t=>row.get(t)?.[key]);
      if (vals.some(v=>v===undefined)) continue;

      for (let start=0; start+L<TIMES.length; start++) {
        const seq=vals.slice(start,start+L);
        const next=vals[start+L];
        const sim=similarity(pattern,seq);
        const w=simWeight(sim);
        if (w>0) addVote(out,next,w,`${tagPrefix}:H:${sim}`);
      }
    }
  }
  return out;
}

function agreementBonus(map) {
  for (const x of map.values()) {
    const hasV = Object.keys(x.tags).some(k=>k.includes(':V:'));
    const hasH = Object.keys(x.tags).some(k=>k.includes(':H:'));
    if (hasV && hasH) x.score += 0.35;
  }
}

function candidatesForMode(targetDate,key,modeDef) {
  const vp=getVerticalPattern(targetDate,key);
  const hp=getHorizontalPattern(targetDate,key);
  if (!vp || !hp) return null;

  const vv = modeDef.useVV ? searchInVerticals(vp,targetDate,'VP') : new Map();
  const vh = modeDef.useVH ? searchInHorizontals(vp,targetDate,'VP') : new Map();
  const hv = modeDef.useHV ? searchInVerticals(hp,targetDate,'HP') : new Map();
  const hh = modeDef.useHH ? searchInHorizontals(hp,targetDate,'HP') : new Map();

  const merged=mergeMaps(vv,vh,hv,hh);
  if (modeDef===MODES.combined || modeDef===MODES.verticalCross || modeDef===MODES.horizontalCross) {
    agreementBonus(merged);
  }
  const ranked=rank(merged);
  if (!ranked.length) return null;
  return { verticalPattern:vp, horizontalPattern:hp, ranked, top2:top2(ranked) };
}

function top4Combos(perPos) {
  if (perPos.some(x=>!x || !x.length)) return [];
  const combos=[];
  for (const a of perPos[0]) for (const b of perPos[1]) for (const c of perPos[2]) {
    const p=(a.p||1e-12)*(b.p||1e-12)*(c.p||1e-12);
    combos.push({combo:`${a.digit}${b.digit}${c.digit}`,p,score:a.score+b.score+c.score});
  }
  combos.sort((x,y)=>y.p-x.p || y.score-x.score || x.combo.localeCompare(y.combo));
  const seen=new Set();
  return combos.filter(x=>!seen.has(x.combo) && seen.add(x.combo)).slice(0,4);
}

function freqBaseline(targetId) {
  const train=draws.filter(d=>d.id<targetId);
  const per=KEYS.map(k=>{
    const c=Array(10).fill(0);
    for (const d of train) c[d[k]]++;
    const total=c.reduce((a,b)=>a+b,0)||1;
    return c.map((n,digit)=>({digit,p:n/total,score:n}))
      .sort((a,b)=>b.p-a.p || a.digit-b.digit).slice(0,2);
  });
  return top4Combos(per);
}

const modeResults={};
for (const mode of Object.keys(MODES)) modeResults[mode]=[];

for (const targetDate of dates) {
  const target=byDate.get(targetDate)?.get(TARGET_TIME);
  if (!target) continue;
  if (pastDates(targetDate).length<7) continue;

  for (const [mode,def] of Object.entries(MODES)) {
    const details=[];
    const perPos=[];
    let valid=true;

    for (const key of KEYS) {
      const r=candidatesForMode(targetDate,key,def);
      if (!r) { valid=false; break; }
      details.push({key,verticalPattern:r.verticalPattern,horizontalPattern:r.horizontalPattern,top:r.ranked.slice(0,10)});
      perPos.push(r.top2);
    }
    if (!valid) continue;

    const combos=top4Combos(perPos);
    if (!combos.length) continue;

    const actual=`${target.a}${target.b}${target.c}`;
    const baseline=freqBaseline(target.id);

    modeResults[mode].push({
      date:targetDate,
      id:target.id,
      actual,
      combos,
      hit:combos.some(x=>x.combo===actual),
      baselineHit:baseline.some(x=>x.combo===actual),
      positionHits:KEYS.map((k,i)=>({
        key:k,
        actual:target[k],
        top1:perPos[i][0]?.digit===target[k],
        top2:perPos[i].some(x=>x.digit===target[k])
      })),
      details
    });
  }
}

function pct(n,d){return d?100*n/d:0;}

const summary={};
for (const [mode,tests] of Object.entries(modeResults)) {
  const n=tests.length;
  const hits=tests.filter(t=>t.hit).length;
  const base=tests.filter(t=>t.baselineHit).length;
  summary[mode]={
    tests:n,
    hits,
    hitPct:pct(hits,n),
    baselineHits:base,
    baselinePct:pct(base,n),
    positions:KEYS.map((k,i)=>({
      key:k,
      top1:tests.filter(t=>t.positionHits[i].top1).length,
      top1Pct:pct(tests.filter(t=>t.positionHits[i].top1).length,n),
      top2:tests.filter(t=>t.positionHits[i].top2).length,
      top2Pct:pct(tests.filter(t=>t.positionHits[i].top2).length,n),
    }))
  };
}

const ranking=Object.entries(summary)
  .sort((a,b)=>b[1].hitPct-a[1].hitPct || b[1].tests-a[1].tests)
  .map(([mode,s])=>({mode,...s}));

const report={
  generatedAt:new Date().toISOString(),
  method:{
    name:'Matrix TOP-3 Sequence-6 v2',
    targetTime:TARGET_TIME,
    sequenceLength:L,
    similarityWeights:{'6/6':1.00,'5/6':0.55,'4/6':0.25,'3/6':0.08},
    modes:{
      verticalOnly:'Vertical pattern searched only in vertical columns',
      horizontalOnly:'Horizontal pattern searched only in horizontal rows',
      verticalCross:'Vertical pattern searched in vertical columns and horizontal rows',
      horizontalCross:'Horizontal pattern searched in vertical columns and horizontal rows',
      combined:'Both vertical and horizontal patterns searched in both orientations'
    },
    leakageControl:'Each target uses only dates strictly before the target date.'
  },
  summary,
  ranking,
  recent:Object.fromEntries(Object.entries(modeResults).map(([m,t])=>[m,t.slice(-20).reverse()])),
  tests:modeResults
};

fs.writeFileSync(REPORT_JSON,JSON.stringify(report,null,2));

const md=[];
md.push('# Matrix TOP-3 · Sequence-6 v2');
md.push('');
md.push(`Цель: сравнить трактовки идеи цепочки из 6 цифр для тиража **${TARGET_TIME}**.`);
md.push('');
md.push('## Рейтинг режимов');
md.push('');
md.push('| Режим | Проверок | Попаданий в 4 комбы | % | Baseline % |');
md.push('|---|---:|---:|---:|---:|');
for (const r of ranking) {
  md.push(`| ${r.mode} | ${r.tests} | ${r.hits} | ${r.hitPct.toFixed(2)}% | ${r.baselinePct.toFixed(2)}% |`);
}
md.push('');
md.push('## По разрядам');
md.push('');
for (const r of ranking) {
  md.push(`### ${r.mode}`);
  for (const p of r.positions) {
    md.push(`- ${p.key.toUpperCase()}: top-1 ${p.top1Pct.toFixed(2)}%, в top-2 ${p.top2Pct.toFixed(2)}%`);
  }
  md.push('');
}
md.push('## Правила');
md.push('');
md.push('- Порядок 6 цифр сохраняется.');
md.push('- Сходство оценивается по совпадению позиций: 6/6, 5/6, 4/6, 3/6.');
md.push('- Для каждой исторической даты факт скрывается и используются только более ранние даты.');
md.push('- Итог всегда максимум 2 кандидата на разряд и 4 комбинации.');
fs.writeFileSync(REPORT_MD,md.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n'));

console.log('=== MATRIX TOP-3 SEQUENCE-6 v2 ===');
for (const r of ranking) {
  console.log(`${r.mode}: tests=${r.tests}, hits=${r.hits}, hitPct=${r.hitPct.toFixed(2)}%, baseline=${r.baselinePct.toFixed(2)}%`);
}
