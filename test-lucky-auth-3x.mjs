import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const EMAIL = process.env.LUCKY_EMAIL || '';
const PASSWORD = process.env.LUCKY_PASSWORD || '';
const REPORT = new URL('./lucky-auth-test-report.json', import.meta.url);

const EXPECTED = [
  [267472,'11.08.26','02:40','063'],
  [267471,'10.08.26','22:40','383'],
  [267470,'10.08.26','21:25','114'],
  [267469,'10.08.26','16:25','679'],
  [267468,'10.08.26','13:40','317'],
  [267467,'10.08.26','11:40','216']
];

function norm(s){ return String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim(); }

async function dismiss(page){
  for(const x of ['Принять','Согласен','Хорошо','Понятно','Закрыть','Продолжить']){
    try{
      const b=page.getByRole('button',{name:new RegExp(`^${x}$`,'i')}).first();
      if(await b.isVisible({timeout:250})) await b.click({timeout:1000});
    }catch{}
  }
}

async function login(page){
  if(!EMAIL||!PASSWORD) throw new Error('не заданы Secrets LUCKY_EMAIL / LUCKY_PASSWORD');

  let fields=null;
  for(const url of ['https://lucky-numbers.ru/login','https://lucky-numbers.ru/auth/login']){
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
      await dismiss(page);
      const e=page.locator('input[type="email"],input[name*="email" i],input[autocomplete="email"]').first();
      const p=page.locator('input[type="password"],input[autocomplete="current-password"]').first();
      if(await e.isVisible({timeout:1000}).catch(()=>false) && await p.isVisible({timeout:1000}).catch(()=>false)){
        fields={e,p}; break;
      }
    }catch{}
  }

  if(!fields) throw new Error('не найдены поля входа Lucky Numbers');

  await fields.e.fill(EMAIL);
  await fields.p.fill(PASSWORD);

  let done=false;
  for(const re of [/^войти$/i,/^вход$/i,/login/i]){
    const b=page.getByRole('button',{name:re}).first();
    if(await b.isVisible({timeout:500}).catch(()=>false)){
      await b.click({timeout:3000});
      done=true; break;
    }
  }
  if(!done) await fields.p.press('Enter');
  await page.waitForTimeout(2500);
}

function verifyText(body){
  const text=norm(body);
  const rows=[];
  for(const [id,date,time,digits] of EXPECTED){
    const p1=String(id);
    const p2=String(id).replace(/(\d{3})(\d{3})/,'$1 $2');
    const idx=Math.max(text.indexOf(p1),text.indexOf(p2));
    if(idx<0) throw new Error(`нет №${id}`);

    const start=Math.max(0,idx-120), end=Math.min(text.length,idx+180);
    const frag=text.slice(start,end);

    if(!frag.includes(date) || !frag.includes(time)) {
      throw new Error(`№${id}: не совпали дата/время`);
    }

    const left=frag.slice(0, Math.max(frag.indexOf(p1),frag.indexOf(p2)));
    const nums=[...left.matchAll(/(?:^|\D)([0-9])(?=\D|$)/g)].map(m=>m[1]);
    const got=nums.slice(-3).join('');
    if(got!==digits) throw new Error(`№${id}: ожидалось ${digits}, получено ${got||'нет'}`);

    rows.push({id,date,time,digits});
  }
  return rows;
}

async function onePass(browser,pass){
  const context=await browser.newContext({
    locale:'ru-RU',
    timezoneId:'Europe/Moscow',
    userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
  });
  const page=await context.newPage();
  try{
    await login(page);

    let body='';
    let usedUrl='';
    for(const url of ['https://lucky-numbers.ru/lottery/ru/top3','https://lucky-numbers.ru/lottery/top3/arhiv']){
      try{
        await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
        await dismiss(page);
        await page.waitForTimeout(3500);
        body=await page.locator('body').innerText();
        if(/267[\s\u00a0]?472/.test(body)){ usedUrl=url; break; }
      }catch{}
    }
    if(!usedUrl) throw new Error('после входа архив не показал №267472');

    return {pass,ok:true,usedUrl,rows:verifyText(body)};
  }finally{
    await context.close();
  }
}

async function main(){
  const report={
    testedAt:new Date().toISOString(),
    mode:'TEST ONLY — Lucky Numbers с авторизацией; top3-live.json НЕ изменяется',
    passes:[],consensus:false,status:'FAIL'
  };
  const browser=await chromium.launch({headless:true});
  try{
    for(let i=1;i<=3;i++){
      try{
        const r=await onePass(browser,i);
        report.passes.push(r);
        console.log(`PASS ${i}: OK`);
      }catch(e){
        report.passes.push({pass:i,ok:false,error:e.message});
        console.error(`PASS ${i}: FAIL ${e.message}`);
      }
    }
    if(report.passes.every(x=>x.ok)){
      const snaps=report.passes.map(x=>JSON.stringify(x.rows));
      report.consensus=snaps.every(x=>x===snaps[0]);
      report.status=report.consensus?'PASS':'FAIL';
    }else{
      report.reason='не все три прохода подтвердили контрольные тиражи';
    }
  }finally{
    await browser.close();
    await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n','utf8');
    console.log(JSON.stringify(report,null,2));
  }
  if(report.status!=='PASS') process.exit(1);
}
main();
