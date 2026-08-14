import fs from 'node:fs';

const DATA_FILE='top3-live.json';
const OUT_JSON='sequence6-v4-single-report.json';
const OUT_MD='sequence6-v4-single-report.md';
const TARGET_TIME='02:40';
const L=6;
const TIMES=['02:40','04:40','06:40','07:40','09:40','11:40','13:40','16:25','21:25','22:40'];
const KEYS=['a','b','c'];

function parseDate(s){ const [dd,mm,yy]=s.split('.').map(Number); return new Date(Date.UTC(2000+yy,mm-1,dd)); }
function fmtDate(d){ return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${String(d.getUTCFullYear()%100).padStart(2,'0')}`; }
function prevDateKey(s){ const d=parseDate(s); d.setUTCDate(d.getUTCDate()-1); return fmtDate(d); }
function similarity(a,b){ let n=0; for(let i=0;i<L;i++) if(a[i]===b[i]) n++; return n; }
function weight(s){ return s===6?100:s===5?30:s===4?10:s===3?3:0; }
function addVote(map,digit,w,sim){
  if(!map.has(digit)) map.set(digit,{score:0,evidence:0,exact6:0,exact5:0,exact4:0,exact3:0});
  const x=map.get(digit); x.score+=w; x.evidence++; x[`exact${sim}`]++;
}
function rank(map){
  return [...map.entries()].map(([digit,x])=>({digit,...x}))
    .sort((a,b)=>b.score-a.score || b.exact6-a.exact6 || b.exact5-a.exact5 || b.exact4-a.exact4 || b.evidence-a.evidence || a.digit-b.digit);
}

const raw=JSON.parse(fs.readFileSync(DATA_FILE,'utf8'));
const draws=[...raw.draws].sort((x,y)=>x.id-y.id);
const byDate=new Map();
for(const d of draws){ if(!byDate.has(d.date)) byDate.set(d.date,new Map()); byDate.get(d.date).set(d.time,d); }
const dates=[...byDate.keys()].sort((a,b)=>parseDate(a)-parseDate(b));
const pastDates=date=>dates.filter(d=>parseDate(d)<parseDate(date));

function verticalPattern(targetDate,key){
  const ds=pastDates(targetDate).filter(d=>byDate.get(d)?.has(TARGET_TIME));
  if(ds.length<L) return null;
  return ds.slice(-L).map(d=>byDate.get(d).get(TARGET_TIME)[key]);
}
function horizontalPattern(targetDate,key){
  const row=byDate.get(prevDateKey(targetDate)); if(!row) return null;
  const vals=TIMES.map(t=>row.get(t)?.[key]); if(vals.some(v=>v===undefined)) return null;
  return vals.slice(-L);
}
function searchVertical(query,targetDate,key){
  const out=new Map(), cutoff=parseDate(targetDate);
  for(const time of TIMES){
    const vals=[];
    for(const d of dates){
      if(parseDate(d)>=cutoff) break;
      const draw=byDate.get(d)?.get(time); if(draw) vals.push(draw[key]);
    }
    for(let i=0;i+L<vals.length;i++){
      const s=similarity(query,vals.slice(i,i+L)), w=weight(s);
      if(w) addVote(out,vals[i+L],w,s);
    }
  }
  return out;
}
function searchHorizontal(query,targetDate,key){
  const out=new Map(), cutoff=parseDate(targetDate);
  for(const d of dates){
    if(parseDate(d)>=cutoff) break;
    const row=byDate.get(d); if(!row) continue;
    const vals=TIMES.map(t=>row.get(t)?.[key]); if(vals.some(v=>v===undefined)) continue;
    for(let i=0;i+L<TIMES.length;i++){
      const s=similarity(query,vals.slice(i,i+L)), w=weight(s);
      if(w) addVote(out,vals[i+L],w,s);
    }
  }
  return out;
}
function merge(...maps){
  const out=new Map();
  for(const m of maps) for(const [d,x] of m){
    if(!out.has(d)) out.set(d,{score:0,evidence:0,exact6:0,exact5:0,exact4:0,exact3:0});
    const y=out.get(d); for(const k of ['score','evidence','exact6','exact5','exact4','exact3']) y[k]+=x[k];
  }
  return out;
}
function predictOneDigit(date,key){
  const vp=verticalPattern(date,key), hp=horizontalPattern(date,key);
  if(!vp||!hp) return null;
  const ranked=rank(merge(
    searchVertical(vp,date,key),
    searchHorizontal(vp,date,key),
    searchVertical(hp,date,key),
    searchHorizontal(hp,date,key)
  ));
  if(!ranked.length) return null;
  return {prediction:ranked[0].digit, verticalPattern:vp, horizontalPattern:hp, ranked};
}

const tests=[];
for(const date of dates){
  const target=byDate.get(date)?.get(TARGET_TIME);
  if(!target || pastDates(date).length<L+1) continue;
  const p=KEYS.map(k=>predictOneDigit(date,k));
  if(p.some(x=>!x)) continue;
  const prediction=p.map(x=>x.prediction).join('');
  const actual=`${target.a}${target.b}${target.c}`;
  tests.push({
    date,id:target.id,prediction,actual,exactHit:prediction===actual,
    digits:KEYS.map((k,i)=>({key:k,prediction:p[i].prediction,actual:target[k],hit:p[i].prediction===target[k],verticalPattern:p[i].verticalPattern,horizontalPattern:p[i].horizontalPattern,ranked:p[i].ranked.slice(0,10)}))
  });
}
const pct=(n,d)=>d?100*n/d:0;
const summary={
  tests:tests.length,
  exactHits:tests.filter(t=>t.exactHit).length,
  exactPct:pct(tests.filter(t=>t.exactHit).length,tests.length),
  digits:KEYS.map((k,i)=>({key:k,hits:tests.filter(t=>t.digits[i].hit).length,pct:pct(tests.filter(t=>t.digits[i].hit).length,tests.length)}))
};
const report={generatedAt:new Date().toISOString(),method:{name:'Sequence-6 v4 SINGLE DIGIT',rule:'A/B/C are separate matrices; each outputs exactly one digit; three digits form one TOP-3 prediction.',targetTime:TARGET_TIME,leakage:'Only earlier dates are used.'},summary,recent:tests.slice(-20).reverse(),tests};
fs.writeFileSync(OUT_JSON,JSON.stringify(report,null,2));

const md=['# Matrix TOP-3 · Sequence-6 v4 SINGLE DIGIT','',`Проверок: **${summary.tests}**`,`Точных TOP-3: **${summary.exactHits}/${summary.tests} = ${summary.exactPct.toFixed(2)}%**`];
for(const s of summary.digits) md.push(`${s.key.toUpperCase()}: **${s.hits}/${summary.tests} = ${s.pct.toFixed(2)}%**`);
md.push('','| Дата | Прогноз | Факт |','|---|---:|---:|');
for(const t of report.recent) md.push(`| ${t.date} | ${t.prediction} | ${t.actual} |`);
fs.writeFileSync(OUT_MD,md.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n'));

console.log('=== MATRIX TOP-3 SEQUENCE-6 v4 SINGLE DIGIT ===');
console.log(`tests=${summary.tests}`);
console.log(`exact=${summary.exactHits}/${summary.tests} = ${summary.exactPct.toFixed(2)}%`);
for(const s of summary.digits) console.log(`${s.key}: ${s.hits}/${summary.tests} = ${s.pct.toFixed(2)}%`);
