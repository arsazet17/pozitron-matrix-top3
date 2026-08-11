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

function norm(s){
  return String(s ?? '').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
}

async function dismiss(page){
  for(const label of ['Принять','Согласен','Хорошо','Понятно','Закрыть','Продолжить']){
    try{
      const b=page.getByRole('button',{name:new RegExp(`^${label}$`,'i')}).first();
      if(await b.isVisible({timeout:300})) await b.click({timeout:1200});
    }catch{}
  }
}

async function openRealLogin(page){
  await page.goto('https://lucky-numbers.ru/',{
    waitUntil:'domcontentloaded',
    timeout:45000
  });
  await dismiss(page);
  await page.waitForTimeout(1500);

  // Реальный верхний пункт "Вход", как на мобильной странице.
  let clicked=false;

  const link = page.getByRole('link',{name:/^вход$/i}).first();
  if(await link.isVisible({timeout:2500}).catch(()=>false)){
    await link.click({timeout:5000});
    clicked=true;
  }

  if(!clicked){
    const text = page.getByText('Вход',{exact:true}).first();
    if(await text.isVisible({timeout:1800}).catch(()=>false)){
      await text.click({timeout:5000});
      clicked=true;
    }
  }

  if(!clicked){
    // Иногда это кнопка или элемент меню.
    const candidates = page.locator('a,button,[role="button"]');
    const n=Math.min(await candidates.count(),500);
    for(let i=0;i<n;i++){
      const el=candidates.nth(i);
      const t=norm(await el.innerText({timeout:100}).catch(()=>'')); 
      if(/^вход$/i.test(t)){
        await el.click({timeout:4000});
        clicked=true;
        break;
      }
    }
  }

  if(!clicked) throw new Error('на главной странице не найден пункт "Вход"');

  await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(1800);
}

async function findFields(page){
  const emailCandidates = [
    page.getByLabel(/почта/i).first(),
    page.locator('input[type="email"]').first(),
    page.locator('input[name*="email" i]').first(),
    page.locator('input[placeholder*="mail" i]').first(),
    page.locator('input[autocomplete="email"]').first()
  ];

  const passCandidates = [
    page.getByLabel(/пароль/i).first(),
    page.locator('input[type="password"]').first(),
    page.locator('input[name*="password" i]').first(),
    page.locator('input[autocomplete="current-password"]').first()
  ];

  let email=null, pass=null;

  for(const c of emailCandidates){
    if(await c.isVisible({timeout:700}).catch(()=>false)){ email=c; break; }
  }
  for(const c of passCandidates){
    if(await c.isVisible({timeout:700}).catch(()=>false)){ pass=c; break; }
  }

  return email && pass ? {email,pass} : null;
}

async function waitForCloudflare(page){
  // На форме у пользователя виден Cloudflare Turnstile "Успешно".
  // Ждём до 20 секунд: либо iframe/challenge исчезнет/пройдёт,
  // либо кнопка "Вход" станет доступна.
  const started=Date.now();
  while(Date.now()-started < 20000){
    const body=norm(await page.locator('body').innerText().catch(()=>'')); 
    const loginButton = page.getByRole('button',{name:/^вход$/i}).first();
    const visible = await loginButton.isVisible({timeout:300}).catch(()=>false);
    const enabled = visible ? await loginButton.isEnabled().catch(()=>false) : false;

    if(enabled && (!/провер(ка|ьте)|cloudflare|verify you are human/i.test(body) || /успешно/i.test(body))){
      return;
    }
    await page.waitForTimeout(1000);
  }
}

async function login(page){
  if(!EMAIL || !PASSWORD) throw new Error('не заданы GitHub Secrets LUCKY_EMAIL / LUCKY_PASSWORD');

  await openRealLogin(page);

  const fields=await findFields(page);
  if(!fields){
    const url=page.url();
    const title=await page.title().catch(()=> '');
    throw new Error(`форма входа открылась, но поля "Почта/Пароль" не найдены; url=${url}; title=${title}`);
  }

  await fields.email.fill(EMAIL);
  await fields.pass.fill(PASSWORD);

  await waitForCloudflare(page);

  let button = page.getByRole('button',{name:/^вход$/i}).first();
  if(!(await button.isVisible({timeout:1500}).catch(()=>false))){
    button = page.locator('button').filter({hasText:/^вход$/i}).first();
  }

  if(!(await button.isVisible({timeout:1500}).catch(()=>false))){
    throw new Error('не найдена кнопка "Вход" после заполнения формы');
  }

  if(!(await button.isEnabled().catch(()=>false))){
    throw new Error('кнопка "Вход" осталась заблокирована — вероятно Cloudflare не пропустил GitHub runner');
  }

  await button.click({timeout:5000});
  await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(2500);

  const body=norm(await page.locator('body').innerText().catch(()=>'')); 

  // Надёжный признак кабинета: "Выход", "Сессии и устройства", "Премиум доступ".
  if(!/выход|сессии и устройства|премиум доступ/i.test(body)){
    if(/неверн|ошибк|парол|почт/i.test(body)){
      throw new Error('Lucky Numbers отклонил авторизацию');
    }
    throw new Error(`после нажатия "Вход" кабинет не подтверждён; url=${page.url()}`);
  }
}

function verifyBody(body){
  const text=norm(body);
  const results=[];

  for(const [id,date,time,digits] of EXPECTED){
    const compact=String(id);
    const spaced=compact.replace(/(\d{3})(\d{3})/,'$1 $2');

    let idx=text.indexOf(compact);
    if(idx<0) idx=text.indexOf(spaced);
    if(idx<0) throw new Error(`в архиве нет контрольного тиража №${id}`);

    const frag=text.slice(Math.max(0,idx-160),Math.min(text.length,idx+220));

    if(!frag.includes(date) || !frag.includes(time)){
      throw new Error(`№${id}: не совпали дата/время`);
    }

    const pos=Math.max(frag.indexOf(compact),frag.indexOf(spaced));
    const left=frag.slice(0,pos);
    const nums=[...left.matchAll(/(?:^|\D)([0-9])(?=\D|$)/g)].map(m=>m[1]);
    const got=nums.slice(-3).join('');

    if(got !== digits){
      throw new Error(`№${id}: ожидалось ${digits}, получено ${got || 'нет цифр'}`);
    }

    results.push({id,date,time,digits});
  }

  return results;
}

async function openTop3Archive(page){
  // Сначала текущий маршрут, который раньше использовался проектом.
  for(const url of [
    'https://lucky-numbers.ru/lottery/ru/top3',
    'https://lucky-numbers.ru/lottery/ru/top3/arhiv'
  ]){
    try{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:35000});
      await dismiss(page);
      await page.waitForTimeout(2500);

      const body=await page.locator('body').innerText();
      if(/267[\s\u00a0]?472/.test(body)){
        return {url:page.url(),body};
      }
    }catch{}
  }

  // Если прямой маршрут изменился, используем поиск ссылки TOP-3 по сайту.
  await page.goto('https://lucky-numbers.ru/',{waitUntil:'domcontentloaded',timeout:35000});
  await dismiss(page);

  const links=page.locator('a');
  const n=Math.min(await links.count(),1200);

  for(let i=0;i<n;i++){
    const a=links.nth(i);
    const t=norm(await a.innerText({timeout:80}).catch(()=>'')); 
    const href=await a.getAttribute('href').catch(()=>null);
    if(!href) continue;
    if(/top[\s-]?3/i.test(t) || /\/top3(?:\/|$)/i.test(href)){
      try{
        await a.click({timeout:4000});
        await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
        await page.waitForTimeout(2000);
        const body=await page.locator('body').innerText();
        if(/267[\s\u00a0]?472/.test(body)){
          return {url:page.url(),body};
        }
      }catch{}
    }
  }

  throw new Error('после входа не удалось открыть актуальный архив TOP-3 с №267472');
}

async function onePass(browser,pass){
  const context=await browser.newContext({
    locale:'ru-RU',
    timezoneId:'Europe/Moscow',
    viewport:{width:412,height:915},
    userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });

  const page=await context.newPage();

  try{
    await login(page);
    const archive=await openTop3Archive(page);
    const rows=verifyBody(archive.body);
    return {pass,ok:true,archiveUrl:archive.url,rows};
  }finally{
    await context.close();
  }
}

async function main(){
  const report={
    testedAt:new Date().toISOString(),
    mode:'TEST ONLY — реальная форма Lucky Numbers + авторизация; top3-live.json НЕ изменяется',
    passes:[],
    consensus:false,
    status:'FAIL'
  };

  const browser=await chromium.launch({headless:true});

  try{
    for(let pass=1; pass<=3; pass++){
      try{
        const r=await onePass(browser,pass);
        report.passes.push(r);
        console.log(`PASS ${pass}: OK`);
      }catch(e){
        report.passes.push({pass,ok:false,error:e.message});
        console.error(`PASS ${pass}: FAIL ${e.message}`);
      }
    }

    if(report.passes.every(x=>x.ok)){
      const snaps=report.passes.map(x=>JSON.stringify(x.rows));
      report.consensus=snaps.every(x=>x===snaps[0]);
      report.status=report.consensus?'PASS':'FAIL';
      if(!report.consensus) report.reason='три прохода дали разные данные';
    }else{
      report.reason='не все три прохода подтвердили авторизацию и контрольные тиражи';
    }
  }finally{
    await browser.close();
    await fs.writeFile(REPORT,JSON.stringify(report,null,2)+'\n','utf8');
    console.log(JSON.stringify(report,null,2));
  }

  if(report.status!=='PASS') process.exit(1);
}

main().catch(async e=>{
  try{
    await fs.writeFile(REPORT,JSON.stringify({
      testedAt:new Date().toISOString(),
      status:'FAIL',
      fatalError:e.message
    },null,2)+'\n','utf8');
  }catch{}
  console.error(e);
  process.exit(1);
});
