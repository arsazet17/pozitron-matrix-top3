import fs from 'node:fs';

const DATA_FILE = 'top3-live.json';
const REPORT_JSON = 'sequence6-backtest-report.json';
const REPORT_MD = 'sequence6-backtest-report.md';
const TARGET_TIME = '02:40';
const L = 6;
const TIMES = ['02:40','04:40','06:40','07:40','09:40','11:40','13:40','16:25','21:25','22:40'];
const KEYS = ['a','b','c'];

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
function seqEq(a,b) {
  return a.length===b.length && a.every((v,i)=>v===b[i]);
}
function similarity(a,b) {
  let n=0;
  for (let i=0;i<Math.min(a.length,b.length);i++) if (a[i]===b[i]) n++;
  return n;
}
function addVote(map, digit, weight, kind) {
  if (!map.has(digit)) map.set(digit,{score:0, exactV:0, exactH:0, nearV:0, nearH:0});
  const x=map.get(digit);
  x.score += weight;
  x[kind] += 1;
}
function normalizeScores(votes) {
  const arr=[...votes.entries()].map(([digit,x])=>({digit,...x}));
  arr.sort((p,q)=>q.score-p.score || q.exactV-p.exactV || q.exactH-p.exactH || p.digit-q.digit);
  const sum=arr.reduce((s,x)=>s+x.score,0);
  return arr.map(x=>({...x,p:sum?x.score/sum:0}));
}

const raw = JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
const draws = [...raw.draws].sort((x,y)=>x.id-y.id);

const byDate = new Map();
for (const d of draws) {
  if (!byDate.has(d.date)) byDate.set(d.date,new Map());
  byDate.get(d.date).set(d.time,d);
}
const dates = [...byDate.keys()].sort((a,b)=>parseDate(a)-parseDate(b));

function knownBeforeDate(targetDate) {
  return dates.filter(d=>parseDate(d)<parseDate(targetDate));
}

function verticalPattern(targetDate, key) {
  const earlier = knownBeforeDate(targetDate).filter(d=>byDate.get(d)?.has(TARGET_TIME));
  if (earlier.length < L) return null;
  const last = earlier.slice(-L);
  return last.map(d=>byDate.get(d).get(TARGET_TIME)[key]);
}

function horizontalPattern(targetDate, key) {
  const pd = prevDateKey(targetDate);
  const row=byDate.get(pd);
  if (!row) return null;
  const vals=TIMES.map(t=>row.get(t)?.[key]);
  if (vals.some(v=>v===undefined)) return null;
  return vals.slice(-L);
}

function searchVertical(pattern, targetDate) {
  const votes = new Map();
  const cutoff = parseDate(targetDate);
  // Search all 3 digit matrices and all time columns.
  for (const sourceKey of KEYS) {
    for (const time of TIMES) {
      const vals=[];
      for (const d of dates) {
        if (parseDate(d)>=cutoff) break;
        const draw=byDate.get(d)?.get(time);
        if (draw) vals.push({date:d, value:draw[sourceKey]});
      }
      for (let i=0;i+L<vals.length;i++) {
        const seq=vals.slice(i,i+L).map(x=>x.value);
        const next=vals[i+L].value;
        const sim=similarity(pattern,seq);
        if (sim===L) addVote(votes,next,1.0,'exactV');
        else if (sim===L-1) addVote(votes,next,0.20,'nearV');
      }
    }
  }
  return votes;
}

function searchHorizontal(pattern, targetDate) {
  const votes = new Map();
  const cutoff = parseDate(targetDate);
  // Search all 3 digit matrices, every completed historical row,
  // only contiguous 6-cell segments with a 7th known continuation.
  for (const d of dates) {
    if (parseDate(d)>=cutoff) break;
    const row=byDate.get(d);
    if (!row) continue;
    for (const sourceKey of KEYS) {
      const vals=TIMES.map(t=>row.get(t)?.[sourceKey]);
      if (vals.some(v=>v===undefined)) continue;
      for (let start=0; start+L<TIMES.length; start++) {
        const seq=vals.slice(start,start+L);
        const next=vals[start+L];
        const sim=similarity(pattern,seq);
        if (sim===L) addVote(votes,next,1.0,'exactH');
        else if (sim===L-1) addVote(votes,next,0.20,'nearH');
      }
    }
  }
  return votes;
}

function mergeVotes(v,h) {
  const out=new Map();
  for (const [d,x] of v) out.set(d,{...x});
  for (const [d,x] of h) {
    if (!out.has(d)) out.set(d,{score:0, exactV:0, exactH:0, nearV:0, nearH:0});
    const y=out.get(d);
    y.score += x.score;
    y.exactV += x.exactV; y.exactH += x.exactH;
    y.nearV += x.nearV; y.nearH += x.nearH;
  }
  // Agreement bonus: same digit has at least one exact continuation from both directions.
  for (const x of out.values()) {
    if (x.exactV>0 && x.exactH>0) x.score += 1.0;
  }
  return out;
}

function chooseCandidates(scores) {
  const exact = scores.filter(x=>x.exactV+x.exactH>0);
  const base = exact.length ? exact : scores;
  return base.slice(0,2);
}

function top4Combos(perPos) {
  const lists=perPos.map(x=>x.length?x:[{digit:null,p:0,score:0}]);
  const combos=[];
  for (const a of lists[0]) for (const b of lists[1]) for (const c of lists[2]) {
    if ([a.digit,b.digit,c.digit].some(x=>x===null)) continue;
    const p=(a.p||1e-9)*(b.p||1e-9)*(c.p||1e-9);
    const score=a.score+b.score+c.score;
    combos.push({combo:`${a.digit}${b.digit}${c.digit}`, p, score});
  }
  combos.sort((x,y)=>y.p-x.p || y.score-x.score || x.combo.localeCompare(y.combo));
  const seen=new Set();
  return combos.filter(x=>!seen.has(x.combo) && seen.add(x.combo)).slice(0,4);
}

function baselineTop4(trainingDraws) {
  const freqs=KEYS.map(k=>{
    const c=Array(10).fill(0);
    for (const d of trainingDraws) c[d[k]]++;
    const n=c.reduce((a,b)=>a+b,0)||1;
    return c.map((count,digit)=>({digit,p:count/n,score:count}))
      .sort((a,b)=>b.p-a.p || a.digit-b.digit).slice(0,2);
  });
  return top4Combos(freqs);
}

const tests=[];
for (const targetDate of dates) {
  const target=byDate.get(targetDate)?.get(TARGET_TIME);
  if (!target) continue;

  const patterns=KEYS.map(k=>({
    v:verticalPattern(targetDate,k),
    h:horizontalPattern(targetDate,k)
  }));
  if (patterns.some(x=>!x.v || !x.h)) continue;

  const perPos=[];
  const diagnostics=[];
  for (let pos=0;pos<3;pos++) {
    const v=searchVertical(patterns[pos].v,targetDate);
    const h=searchHorizontal(patterns[pos].h,targetDate);
    const merged=normalizeScores(mergeVotes(v,h));
    const cand=chooseCandidates(merged);
    perPos.push(cand);
    diagnostics.push({
      key:KEYS[pos],
      verticalPattern:patterns[pos].v,
      horizontalPattern:patterns[pos].h,
      candidates:cand,
      allScores:merged.slice(0,10)
    });
  }
  if (perPos.some(x=>x.length===0)) continue;

  const combos=top4Combos(perPos);
  const actual=`${target.a}${target.b}${target.c}`;
  const train=draws.filter(d=>d.id<target.id);
  const baseline=baselineTop4(train);

  tests.push({
    date:targetDate, id:target.id, actual,
    combos, hitTop4:combos.some(x=>x.combo===actual),
    baselineTop4:baseline, baselineHit:baseline.some(x=>x.combo===actual),
    positionHits:KEYS.map((k,i)=>({
      key:k, actual:target[k],
      top1:perPos[i][0]?.digit===target[k],
      inTop2:perPos[i].some(x=>x.digit===target[k])
    })),
    diagnostics
  });
}

function pct(n,d){ return d ? (100*n/d) : 0; }

const total=tests.length;
const exactHits=tests.filter(x=>x.hitTop4).length;
const baseHits=tests.filter(x=>x.baselineHit).length;
const pos=KEYS.map((k,i)=>({
  key:k,
  top1:tests.filter(t=>t.positionHits[i].top1).length,
  inTop2:tests.filter(t=>t.positionHits[i].inTop2).length
}));
const agreementTests=tests.map(t=> {
  let agree=0;
  for (const d of t.diagnostics) {
    const best=d.allScores[0];
    if (best && best.exactV>0 && best.exactH>0) agree++;
  }
  return {...t, agree};
});
const agreeFull=agreementTests.filter(t=>t.agree===3);
const agreeHit=agreeFull.filter(t=>t.hitTop4).length;

const report={
  generatedAt:new Date().toISOString(),
  method:{
    name:'Matrix TOP-3 Sequence-6',
    targetTime:TARGET_TIME,
    sequenceLength:L,
    leakageControl:'Each test uses only draws strictly before the target draw.',
    vertical:'For each target digit, last 6 values at 02:40 across prior dates; search exact and 5/6 matches across all three digit matrices and all time columns. Continuation is next date in same column.',
    horizontal:'For each target digit, last 6 values of previous completed day; search exact and 5/6 contiguous matches across all three digit matrices and rows. Continuation is next cell in the row.',
    scoring:'Exact continuation vote=1.0, 5/6 vote=0.20, +1.0 agreement bonus when the same candidate has exact vertical and exact horizontal evidence. Up to 2 candidates per digit; top 4 Cartesian combinations by normalized score product.',
  },
  summary:{
    tests:total,
    sequence6Top4Hits:exactHits,
    sequence6Top4Pct:pct(exactHits,total),
    frequencyBaselineTop4Hits:baseHits,
    frequencyBaselineTop4Pct:pct(baseHits,total),
    random4ExpectedPct:0.4,
    positions:pos.map(x=>({
      ...x,
      top1Pct:pct(x.top1,total),
      inTop2Pct:pct(x.inTop2,total)
    })),
    allThreeDirectionsAgreeTests:agreeFull.length,
    allThreeDirectionsAgreeHits:agreeHit,
    allThreeDirectionsAgreeHitPct:pct(agreeHit,agreeFull.length)
  },
  recent:tests.slice(-20).reverse(),
  tests
};

fs.writeFileSync(REPORT_JSON,JSON.stringify(report,null,2));

const md=[];
md.push('# Matrix TOP-3 · Sequence-6 Backtest');
md.push('');
md.push(`Цель: прогноз тиража **${TARGET_TIME}** по идее «6 по вертикали + 6 по горизонтали».`);
md.push('');
md.push('## Итог');
md.push('');
md.push(`- Проверено исторических точек: **${total}**`);
md.push(`- Sequence-6: точный TOP-3 попал в 4 комбинации **${exactHits}/${total} = ${pct(exactHits,total).toFixed(2)}%**`);
md.push(`- Частотный baseline (тоже 4 комбинации): **${baseHits}/${total} = ${pct(baseHits,total).toFixed(2)}%**`);
md.push(`- Случайные 4 комбинации: ожидаемо около **0.40%**`);
for (const x of report.summary.positions) {
  md.push(`- Разряд ${x.key.toUpperCase()}: top-1 **${x.top1Pct.toFixed(2)}%**, фактическая цифра в top-2 **${x.inTop2Pct.toFixed(2)}%**`);
}
md.push(`- Когда по всем 3 разрядам лучший кандидат имел точное подтверждение и вертикалью, и горизонталью: **${agreeHit}/${agreeFull.length} = ${pct(agreeHit,agreeFull.length).toFixed(2)}%**`);
md.push('');
md.push('## Последние 20 проверок');
md.push('');
md.push('| Дата | Факт | 4 комбинации | Попадание |');
md.push('|---|---:|---|---|');
for (const t of report.recent) {
  md.push(`| ${t.date} | ${t.actual} | ${t.combos.map(x=>x.combo).join(', ')} | ${t.hitTop4?'✅':'—'} |`);
}
md.push('');
md.push('## Правила против подгонки');
md.push('');
md.push('- Для каждой исторической даты следующий тираж скрыт.');
md.push('- Используются только данные с ID меньше проверяемого тиража.');
md.push('- Точное совпадение 6/6 имеет полный вес.');
md.push('- Совпадение 5/6 используется только как слабый сигнал с весом 0.20.');
md.push('- Никакой выбор цепочки после просмотра факта не производится.');
fs.writeFileSync(REPORT_MD,md.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n'));
}

console.log('=== MATRIX TOP-3 SEQUENCE-6 ===');
console.log(`Tests: ${total}`);
console.log(`Top4 exact hits: ${exactHits}/${total} = ${pct(exactHits,total).toFixed(2)}%`);
console.log(`Frequency baseline: ${baseHits}/${total} = ${pct(baseHits,total).toFixed(2)}%`);
for (const x of report.summary.positions) {
  console.log(`${x.key}: top1 ${x.top1Pct.toFixed(2)}%, inTop2 ${x.inTop2Pct.toFixed(2)}%`);
}
console.log(`3-way exact V+H agreement: ${agreeHit}/${agreeFull.length} = ${pct(agreeHit,agreeFull.length).toFixed(2)}%`);
