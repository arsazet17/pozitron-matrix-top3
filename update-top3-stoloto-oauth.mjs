import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const EMAIL=process.env.STOLOTO_EMAIL||'';
const PASSWORD=process.env.STOLOTO_PASSWORD||'';
const LIVE_FILE=new URL('./top3-live.json',import.meta.url);
const LOGIN_URL='https://oauth.stoloto.ru/login';
const ARCHIVE_URL='https://m.stoloto.ru/top3/archive';
const CUTOVER_ID=267756;

const clean=s=>String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
const validTime=s=>/^\d{2}:\d{2}$/.test(String(s));
function validDate(s){const m=String(s).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);if(!m)return false;const d=+m[1],mo=+m[2],y=2000+(+m[3]),x=new Date(Date.UTC(y,mo-1,d));return x.getUTCFullYear()===y&&x.getUTCMonth()===mo-1&&x.getUTCDate()===d}
function validDraw(d){return Number.isInteger(d?.id)&&d.id>=100000&&d.id<=999999&&validDate(d.date)&&validTime(d.time)&&[d.a,d.b,d.c].every(n=>Number.isInteger(n)&&n>=0&&n<=9)}
function norm(d){const x={id:+d?.id,date:String(d?.date??''),time:String(d?.time??'').slice(0,5),a:+d?.a,b:+d?.b,c:+d?.c};return validDraw(x)?x:null}
function dedupe(xs){const m=new Map();for(const r of xs){const d=norm(r);if(d)m.set(d.id,d)}return[...m.values()].sort((a,b)=>b.id-a.id)}
const key=d=>`${d.id}|${d.date}|${d.time}|${d.a}${d.b}${d.c}`;

function moscowDateParts(offset=0){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));const d=new Date(Date.UTC(+p.year,+p.month-1,+p.day,12));d.setUTCDate(d.getUTCDate()+offset);return d}
const fmt=d=>`${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${String(d.getUTCFullYear()).slice(-2)}`;

function parseArchiveText(raw){
  const lines=String(raw??'').split(/\r?\n/).map(clean).filter(Boolean);
  const months={'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12};
  const year=+new Intl.DateTimeFormat('en',{timeZone:'Europe/Moscow',year:'numeric'}).format(new Date());
  let currentDate='',found=[];
  const setDate=line=>{
    if(/^Сегодня$/i.test(line)){currentDate=fmt(moscowDateParts(0));return true}
    if(/^Вчера$/i.test(line)){currentDate=fmt(moscowDateParts(-1));return true}
    let m=line.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
    if(m&&months[m[2]]){const d=new Date(Date.UTC(m[3]?+m[3]:year,months[m[2]]-1,+m[1]));const c=fmt(d);if(validDate(c)){currentDate=c;return true}}
    m=line.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
    if(m){const y=String(m[3]).length===2?2000+(+m[3]):+m[3],d=new Date(Date.UTC(y,+m[2]-1,+m[1])),c=fmt(d);if(validDate(c)){currentDate=c;return true}}
    return false;
  };
  for(let i=0;i<lines.length;i++){
    if(setDate(lines[i]))continue;
    const tm=lines[i].match(/^(\d{2}):(\d{2})(?::\d{2})?$/); if(!tm||!currentDate)continue;
    const idm=(lines[i+1]||'').match(/^№\s*(\d{6})$/i); if(!idm)continue;
    const ds=lines.slice(i+2,i+5); if(ds.length!==3||!ds.every(x=>/^[0-9]$/.test(x)))continue;
    const d={id:+idm[1],date:currentDate,time:`${tm[1]}:${tm[2]}`,a:+ds[0],b:+ds[1],c:+ds[2]};
    if(validDraw(d))found.push(d);
  }
  return dedupe(found);
}
async function firstVisible(xs){for(const x of xs)if(await x.isVisible({timeout:800}).catch(()=>false))return x;return null}
async function login(page){
  if(!EMAIL||!PASSWORD)throw new Error('не заданы Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');
  await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(900);
  const email=await firstVisible([page.getByLabel(/телефон или email/i).first(),page.getByLabel(/email/i).first(),page.locator('input[type="email"]').first(),page.locator('input[autocomplete="username"]').first(),page.locator('input[type="text"]').first()]);
  const pass=await firstVisible([page.getByLabel(/пароль/i).first(),page.locator('input[type="password"]').first()]);
  if(!email||!pass)throw new Error('OAuth-форма не отдала поля логин/пароль');
  await email.fill(EMAIL);await pass.fill(PASSWORD);
  const submit=await firstVisible([page.getByRole('button',{name:/^войти$/i}).first(),page.locator('button[type="submit"]').first(),page.locator('input[type="submit"]').first()]);
  if(!submit)throw new Error('OAuth-форма не отдала кнопку Войти');await submit.click({timeout:10000});await page.waitForTimeout(1800);
}
async function readPass(browser,n){
  const ctx=await browser.newContext({locale:'ru-RU',timezoneId:'Europe/Moscow',viewport:{width:412,height:1800},userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'});
  const page=await ctx.newPage();
  try{await login(page);await page.goto(ARCHIVE_URL,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForTimeout(2200);for(let i=0;i<5;i++){await page.mouse.wheel(0,1400);await page.waitForTimeout(350)}await page.mouse.wheel(0,-7000);await page.waitForTimeout(500);const body=await page.locator('body').innerText();const draws=parseArchiveText(body);if(draws.length<3){console.log('ARCHIVE TEXT SAMPLE:',JSON.stringify(body.split(/\r?\n/).map(clean).filter(Boolean).slice(0,80)));throw new Error(`распознано слишком мало тиражей: ${draws.length}`)}console.log(`PASS ${n}: rows=${draws.length}; latest №${draws[0].id} ${draws[0].date} ${draws[0].time}`);return draws}finally{await ctx.close()}
}
const same=(a,b)=>JSON.stringify(a.slice(0,12))===JSON.stringify(b.slice(0,12));
function stamp(d){const[dd,mm,yy]=d.date.split('.').map(Number),[hh,mi]=d.time.split(':').map(Number);return Date.UTC(2000+yy,mm-1,dd,hh-3,mi)}
async function main(){
  const live=JSON.parse(await fs.readFile(LIVE_FILE,'utf8')),existing=dedupe(live.draws||[]);if(!existing.length)throw new Error('нет доверенного архива');
  const anchor=existing[0];console.log(`Anchor №${anchor.id} ${anchor.date} ${anchor.time}=${anchor.a}${anchor.b}${anchor.c}`);
  const browser=await chromium.launch({headless:true});let passes=[];try{for(let i=1;i<=3;i++)passes.push(await readPass(browser,i))}finally{await browser.close()}
  if(!same(passes[0],passes[1])||!same(passes[1],passes[2]))throw new Error('три чтения Столото не совпали');
  const source=passes[0],sourceAnchor=source.find(d=>d.id===anchor.id);if(!sourceAnchor)throw new Error(`архив не содержит anchor №${anchor.id}`);if(key(sourceAnchor)!==key(anchor))throw new Error(`anchor №${anchor.id} не совпал`);
  const newer=source.filter(d=>d.id>anchor.id).sort((a,b)=>a.id-b.id);
  for(let i=0;i<newer.length;i++)if(newer[i].id!==anchor.id+1+i)throw new Error(`разрыв номеров: ожидался №${anchor.id+1+i}, получен №${newer[i].id}`);
  let prev=anchor;for(const d of newer){if(stamp(d)<=stamp(prev))throw new Error(`нарушена хронология №${prev.id} -> №${d.id}`);prev=d}
  if(!newer.length){console.log('Новых подтверждённых тиражей нет.');return}
  const merged=dedupe([...newer,...existing]).slice(0,250);
  const currentTimes=[...new Set(merged.filter(d=>d.id>=CUTOVER_ID).map(d=>d.time))].sort();
  const output={...live,schema:4,source:'Официальный Столото · OAuth · динамическое расписание · тройная проверка',updatedAt:new Date().toISOString(),latest:merged[0].id,regularTimes:currentTimes,draws:merged};
  await fs.writeFile(LIVE_FILE,JSON.stringify(output,null,2)+'\n','utf8');
  console.log(`ГОТОВО: добавлено ${newer.length}; latest №${merged[0].id}; новая сетка: ${currentTimes.join(', ')}`);
}
main().catch(e=>{console.error('SAFE STOLOTO UPDATER ERROR:',e.message);process.exit(1)});
