import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const EMAIL=process.env.STOLOTO_EMAIL||'';
const PASSWORD=process.env.STOLOTO_PASSWORD||'';
const LIVE_FILE=new URL('./top3-live.json',import.meta.url);
const LOGIN_URL='https://oauth.stoloto.ru/login';
const CUTOVER_ID=267756;

const NEW_PAGES=[
  'https://www.stoloto.ru/top-3/archive',
  'https://m.stoloto.ru/top-3/archive',
  'https://www.stoloto.ru/top-3/rules?int=faq',
  'https://www.stoloto.ru/top-3'
];

const clean=s=>String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const validTime=s=>/^\d{2}:\d{2}$/.test(String(s));
function validDate(s){
  const m=String(s).match(/^(\d{2})\.(\d{2})\.(\d{2})$/); if(!m)return false;
  const d=+m[1],mo=+m[2],y=2000+(+m[3]),x=new Date(Date.UTC(y,mo-1,d));
  return x.getUTCFullYear()===y&&x.getUTCMonth()===mo-1&&x.getUTCDate()===d;
}
function validDraw(d){
  return Number.isInteger(d?.id)&&d.id>=100000&&d.id<=999999&&
    validDate(d.date)&&validTime(d.time)&&
    [d.a,d.b,d.c].every(n=>Number.isInteger(n)&&n>=0&&n<=9);
}
function norm(d){
  const x={id:+d?.id,date:String(d?.date??''),time:String(d?.time??'').slice(0,5),
    a:+d?.a,b:+d?.b,c:+d?.c};
  return validDraw(x)?x:null;
}
function dedupe(xs){
  const m=new Map();
  for(const r of xs){const d=norm(r);if(d&&!m.has(d.id))m.set(d.id,d)}
  return [...m.values()].sort((a,b)=>b.id-a.id);
}
const key=d=>`${d.id}|${d.date}|${d.time}|${d.a}${d.b}${d.c}`;
function stamp(d){
  const[dd,mm,yy]=d.date.split('.').map(Number),[hh,mi]=d.time.split(':').map(Number);
  return Date.UTC(2000+yy,mm-1,dd,hh-3,mi);
}
function fmtDateAny(v){
  if(v==null)return '';
  const s=String(v);
  let m=s.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{2}|\d{4})/);
  if(m){
    const yy=String(m[3]).length===4?String(m[3]).slice(-2):m[3];
    return `${m[1]}.${m[2]}.${yy}`;
  }
  const dt=new Date(v);
  if(!Number.isNaN(dt.getTime())){
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'2-digit'}).formatToParts(dt);
    const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return `${o.day}.${o.month}.${o.year}`;
  }
  return '';
}
function fmtTimeAny(v){
  if(v==null)return '';
  const s=String(v);
  let m=s.match(/(?:^|T|\s)(\d{2}):(\d{2})(?::\d{2})?/);
  if(m)return `${m[1]}:${m[2]}`;
  const dt=new Date(v);
  if(!Number.isNaN(dt.getTime()))
    return new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit',hour12:false}).format(dt);
  return '';
}
function digitsFrom(v){
  if(Array.isArray(v)){
    const a=v.map(x=>Number(typeof x==='object'?(x?.value??x?.number??x?.num):x)).filter(Number.isInteger);
    if(a.length>=3&&a.slice(0,3).every(n=>n>=0&&n<=9))return a.slice(0,3);
  }
  if(typeof v==='string'){
    const a=(v.match(/\d/g)||[]).map(Number);
    if(a.length===3)return a;
  }
  return null;
}
function objectToDraw(o){
  if(!o||typeof o!=='object'||Array.isArray(o))return null;
  const id=Number(o.drawNumber??o.draw_number??o.drawId??o.draw_id??o.draw?.number??o.number??o.id);
  if(!Number.isInteger(id)||id<100000||id>999999)return null;
  const date=fmtDateAny(o.drawDate??o.draw_date??o.date??o.drawTime??o.draw_time??o.datetime??o.timestamp);
  const time=fmtTimeAny(o.drawTime??o.draw_time??o.time??o.date??o.datetime??o.timestamp);
  const candidates=[
    o.winningNumbers,o.winning_numbers,o.winNumbers,o.win_numbers,o.numbers,o.result,o.results,
    o.combination,o.winningCombination,o.winning_combination,o.draw?.numbers
  ];
  let ds=null;
  for(const c of candidates){ds=digitsFrom(c);if(ds)break}
  if(!ds){
    const a=Number(o.a??o.first??o.number1??o.n1),b=Number(o.b??o.second??o.number2??o.n2),c=Number(o.c??o.third??o.number3??o.n3);
    if([a,b,c].every(Number.isInteger))ds=[a,b,c];
  }
  return norm({id,date,time,a:ds?.[0],b:ds?.[1],c:ds?.[2]});
}
function walkJson(x,out,depth=0){
  if(depth>12||x==null)return;
  if(Array.isArray(x)){for(const v of x)walkJson(v,out,depth+1);return}
  if(typeof x!=='object')return;
  const d=objectToDraw(x);if(d)out.push(d);
  for(const v of Object.values(x))if(v&&typeof v==='object')walkJson(v,out,depth+1);
}

function moscowToday(offset=0){
  const s=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [y,m,d]=s.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d+offset,12));
  return `${String(x.getUTCDate()).padStart(2,'0')}.${String(x.getUTCMonth()+1).padStart(2,'0')}.${String(x.getUTCFullYear()).slice(-2)}`;
}
function parseArchiveText(raw){
  const lines=String(raw??'').split(/\r?\n/).map(clean).filter(Boolean);
  const months={'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12};
  const year=+new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',year:'numeric'}).format(new Date());
  let currentDate='',found=[];
  const setDate=line=>{
    if(/^Сегодня$/i.test(line)){currentDate=moscowToday(0);return true}
    if(/^Вчера$/i.test(line)){currentDate=moscowToday(-1);return true}
    let m=line.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
    if(m&&months[m[2]]){
      const y=m[3]?+m[3]:year;
      currentDate=`${String(+m[1]).padStart(2,'0')}.${String(months[m[2]]).padStart(2,'0')}.${String(y).slice(-2)}`;
      return true;
    }
    m=line.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})$/);
    if(m){currentDate=`${String(+m[1]).padStart(2,'0')}.${String(+m[2]).padStart(2,'0')}.${String(m[3]).slice(-2)}`;return true}
    return false;
  };
  for(let i=0;i<lines.length;i++){
    if(setDate(lines[i]))continue;
    // New pages may put "Тираж №267760 15:55" on one line.
    let m=lines[i].match(/(?:Тираж\s*)?№\s*(\d{6}).*?(\d{2}):(\d{2})(?::\d{2})?/i);
    if(m&&currentDate){
      const nearby=lines.slice(i+1,i+12).flatMap(x=>/^[0-9]$/.test(x)?[+x]:[]);
      if(nearby.length>=3)found.push({id:+m[1],date:currentDate,time:`${m[2]}:${m[3]}`,a:nearby[0],b:nearby[1],c:nearby[2]});
    }
    // Old/archive row order: time -> №id -> three digits.
    const tm=lines[i].match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
    if(tm&&currentDate){
      const idm=(lines[i+1]||'').match(/^№\s*(\d{6})$/i);
      if(idm){
        const ds=lines.slice(i+2,i+5);
        if(ds.length===3&&ds.every(x=>/^[0-9]$/.test(x)))
          found.push({id:+idm[1],date:currentDate,time:`${tm[1]}:${tm[2]}`,a:+ds[0],b:+ds[1],c:+ds[2]});
      }
    }
  }
  return dedupe(found);
}
async function firstVisible(xs){
  for(const x of xs)if(await x.isVisible({timeout:800}).catch(()=>false))return x;
  return null;
}
async function login(page){
  if(!EMAIL||!PASSWORD)throw new Error('не заданы Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');
  await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(900);
  const email=await firstVisible([
    page.getByLabel(/телефон или email/i).first(),page.getByLabel(/email/i).first(),
    page.locator('input[type="email"]').first(),page.locator('input[autocomplete="username"]').first(),
    page.locator('input[type="text"]').first()
  ]);
  const pass=await firstVisible([page.getByLabel(/пароль/i).first(),page.locator('input[type="password"]').first()]);
  if(!email||!pass)throw new Error('OAuth-форма не отдала поля логин/пароль');
  await email.fill(EMAIL);await pass.fill(PASSWORD);
  const submit=await firstVisible([
    page.getByRole('button',{name:/^войти$/i}).first(),page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first()
  ]);
  if(!submit)throw new Error('OAuth-форма не отдала кнопку Войти');
  await submit.click({timeout:10000});await page.waitForTimeout(1800);
}

async function readNewSource(browser,n){
  const ctx=await browser.newContext({
    locale:'ru-RU',timezoneId:'Europe/Moscow',viewport:{width:430,height:2000},
    userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/139 Mobile Safari/537.36'
  });
  const page=await ctx.newPage();
  const net=[];
  page.on('response',async r=>{
    try{
      const ct=(r.headers()['content-type']||'').toLowerCase();
      if(!ct.includes('json'))return;
      const u=r.url();
      if(!/stoloto/i.test(u))return;
      const j=await r.json();
      const rows=[];walkJson(j,rows);
      if(rows.length)net.push(...rows);
    }catch{}
  });
  try{
    await login(page);
    let all=[];
    for(const url of NEW_PAGES){
      try{
        const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
        await page.waitForTimeout(2500);
        for(let i=0;i<10;i++){await page.mouse.wheel(0,1500);await page.waitForTimeout(220)}
        const body=await page.locator('body').innerText().catch(()=> '');
        all.push(...parseArchiveText(body));
        console.log(`PASS ${n} PAGE ${resp?.status?.()??'?'} ${page.url()} DOM=${parseArchiveText(body).length} NET=${net.length}`);
      }catch(e){console.log(`PASS ${n} PAGE FAIL ${url}: ${e.message}`)}
    }
    all=dedupe([...all,...net]).filter(d=>d.id>=CUTOVER_ID);
    if(!all.length)throw new Error('новый /top-3 источник не отдал ни одного валидного тиража №267756+');
    console.log(`PASS ${n}: newRows=${all.length}; latest №${all[0].id} ${all[0].date} ${all[0].time}=${all[0].a}${all[0].b}${all[0].c}`);
    return all;
  }finally{await ctx.close()}
}
function assertNoDuplicateSlots(draws){
  const seen=new Map();
  for(const d of draws){
    const k=`${d.date}|${d.time}`;
    if(seen.has(k)&&seen.get(k)!==d.id)throw new Error(`дубликат слота ${k}: №${seen.get(k)} и №${d.id}`);
    seen.set(k,d.id);
  }
}
function compareStable(a,b){
  const am=new Map(a.map(d=>[d.id,key(d)])),bm=new Map(b.map(d=>[d.id,key(d)]));
  const common=[...am.keys()].filter(id=>bm.has(id));
  if(!common.length)return false;
  return common.every(id=>am.get(id)===bm.get(id));
}
async function main(){
  const live=JSON.parse(await fs.readFile(LIVE_FILE,'utf8'));
  const existing=dedupe(live.draws||[]);
  if(!existing.length)throw new Error('нет доверенного архива');
  const anchor=existing[0];
  console.log(`LOCAL anchor №${anchor.id} ${anchor.date} ${anchor.time}=${anchor.a}${anchor.b}${anchor.c}; rows=${existing.length}`);

  const browser=await chromium.launch({headless:true});
  let passes=[];
  try{for(let i=1;i<=3;i++)passes.push(await readNewSource(browser,i))}
  finally{await browser.close()}

  if(!compareStable(passes[0],passes[1])||!compareStable(passes[1],passes[2]))
    throw new Error('три чтения нового Столото расходятся на одинаковых номерах');

  const source=dedupe(passes.flat());
  // Every existing overlap must be bit-for-bit identical.
  const existingById=new Map(existing.map(d=>[d.id,d]));
  for(const d of source){
    const old=existingById.get(d.id);
    if(old&&key(old)!==key(d))throw new Error(`конфликт с локальным архивом на №${d.id}`);
  }

  const newer=source.filter(d=>d.id>anchor.id).sort((a,b)=>a.id-b.id);
  if(!newer.length){console.log('Новых подтверждённых тиражей нет.');return}

  // At cutover the new product page may not contain old №267755, so require first new ID exactly 267756.
  const expectedFirst=anchor.id+1;
  if(newer[0].id!==expectedFirst)
    throw new Error(`разрыв после локального архива: ожидался №${expectedFirst}, первый новый №${newer[0].id}`);
  for(let i=1;i<newer.length;i++)
    if(newer[i].id!==newer[i-1].id+1)
      throw new Error(`разрыв номеров: №${newer[i-1].id} -> №${newer[i].id}`);

  let prev=anchor;
  for(const d of newer){
    if(stamp(d)<=stamp(prev))throw new Error(`нарушена хронология №${prev.id} -> №${d.id}`);
    prev=d;
  }

  // NEVER truncate the historical archive.
  const merged=dedupe([...newer,...existing]);
  assertNoDuplicateSlots(merged);

  const newTimes=[...new Set(merged.filter(d=>d.id>=CUTOVER_ID).map(d=>d.time))].sort();
  const output={
    ...live,
    schema:4,
    source:'Официальный Столото · OAuth · /top-3 · тройная проверка',
    updatedAt:new Date().toISOString(),
    latest:merged[0].id,
    // Keep old regularTimes for LAB until the full new daily schedule is independently confirmed.
    regularTimes:Array.isArray(live.regularTimes)?live.regularTimes:[],
    scheduleEras:{
      old:{toId:267755,times:Array.isArray(live.regularTimes)?live.regularTimes:[]},
      current:{fromId:267756,observedTimes:newTimes}
    },
    draws:merged
  };
  await fs.writeFile(LIVE_FILE,JSON.stringify(output,null,2)+'\n','utf8');
  console.log(`ГОТОВО: добавлено ${newer.length}; latest №${merged[0].id}; всего=${merged.length}; observed new times=${newTimes.join(', ')}`);
}
main().catch(e=>{console.error('SAFE TOP-3 NEW-SOURCE ERROR:',e.message);process.exit(1)});
