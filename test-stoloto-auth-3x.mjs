import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const EMAIL = process.env.STOLOTO_EMAIL || '';
const PASSWORD = process.env.STOLOTO_PASSWORD || '';
const REPORT = new URL('./stoloto-auth-test-report.json', import.meta.url);

async function clickIfVisible(loc, timeout=2000){
  try{ if(await loc.isVisible({timeout})){ await loc.click({timeout:5000}); return true; } }catch{}
  return false;
}

async function onePass(browser, pass){
  const context = await browser.newContext({
    locale:'ru-RU',
    timezoneId:'Europe/Moscow',
    viewport:{width:412,height:915},
    userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });
  const page = await context.newPage();

  try{
    if(!EMAIL || !PASSWORD) throw new Error('нет Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');

    await page.goto('https://m.stoloto.ru/', {waitUntil:'domcontentloaded', timeout:45000});
    await page.waitForTimeout(1200);

    let opened = await clickIfVisible(page.getByText('Вход',{exact:true}).first(), 3000);
    if(!opened) opened = await clickIfVisible(page.getByRole('link',{name:/^вход$/i}).first(), 1200);
    if(!opened) opened = await clickIfVisible(page.getByRole('button',{name:/^вход$/i}).first(), 1200);
    if(!opened) throw new Error('не найден "Вход"');

    await page.waitForTimeout(1200);

    const mailTab = page.getByText('Почта',{exact:true}).last();
    if(!(await clickIfVisible(mailTab,3000))) throw new Error('не найдена вкладка "Почта"');

    await page.waitForTimeout(500);

    let email = page.locator('input[type="email"]').first();
    if(!(await email.isVisible({timeout:1200}).catch(()=>false))){
      email = page.locator('input').filter({has: page.locator('')}).first();
      const inputs = page.locator('input');
      const n = await inputs.count();
      email = null;
      for(let i=0;i<n;i++){
        const el=inputs.nth(i);
        const type=(await el.getAttribute('type').catch(()=>''))||'';
        if(await el.isVisible({timeout:100}).catch(()=>false) && (!type || type==='text' || type==='email')){ email=el; break; }
      }
    }
    const password = page.locator('input[type="password"]').first();
    if(!email || !(await password.isVisible({timeout:1200}).catch(()=>false))) throw new Error('не найдены поля Почта/Пароль');

    await email.fill(EMAIL);
    await password.fill(PASSWORD);

    const loginBtn = page.getByRole('button',{name:/^войти$/i}).first();
    if(!(await loginBtn.isVisible({timeout:2000}).catch(()=>false))) throw new Error('не найдена кнопка "Войти"');
    if(!(await loginBtn.isEnabled().catch(()=>false))) throw new Error('кнопка "Войти" неактивна');

    await loginBtn.click({timeout:5000});
    await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
    await page.waitForTimeout(2500);

    const bodyAfterLogin = (await page.locator('body').innerText().catch(()=>'')); 
    if(/неверн.*(парол|почт)|ошибка.*вход/i.test(bodyAfterLogin)) throw new Error('Столото отклонил логин/пароль');

    await page.goto('https://m.stoloto.ru/top3/archive',{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(2500);
    const body = await page.locator('body').innerText();

    if(!/Архив тиражей/i.test(body)) throw new Error('не открылся архив TOP-3');
    const m = body.match(/№\s*(\d{6})/);
    if(!m) throw new Error('архив открылся, но строки тиражей не загрузились');

    return {
      pass,
      ok:true,
      firstVisibleDraw:Number(m[1]),
      hasDownloadArchive:/Скачать архив/i.test(body),
      archiveUrl:page.url()
    };
  } finally {
    await context.close();
  }
}

async function main(){
  const report = {
    testedAt:new Date().toISOString(),
    mode:'TEST ONLY — Stoloto auth 3x; top3-live.json НЕ изменяется',
    passes:[],
    consensus:false,
    status:'FAIL'
  };

  const browser=await chromium.launch({headless:true});
  try{
    for(let i=1;i<=3;i++){
      try{
        const r=await onePass(browser,i);
        report.passes.push(r);
        console.log('PASS',i,'OK',r.firstVisibleDraw);
      }catch(e){
        report.passes.push({pass:i,ok:false,error:e.message});
        console.error('PASS',i,'FAIL',e.message);
      }
    }

    if(report.passes.every(x=>x.ok)){
      const ids=report.passes.map(x=>x.firstVisibleDraw);
      report.consensus=ids.every(x=>x===ids[0]);
      report.status=report.consensus?'PASS':'FAIL';
      if(!report.consensus) report.reason='разные верхние тиражи: '+ids.join(', ');
    } else {
      report.reason='не все три прохода смогли войти и открыть архив';
    }
  } finally {
    await browser.close();
    await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n','utf8');
    console.log(JSON.stringify(report,null,2));
  }

  if(report.status!=='PASS') process.exit(1);
}

main();
