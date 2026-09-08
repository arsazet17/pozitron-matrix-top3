import { chromium } from 'playwright';

const EMAIL=process.env.STOLOTO_EMAIL||'';
const PASSWORD=process.env.STOLOTO_PASSWORD||'';
const LOGIN='https://oauth.stoloto.ru/login';
const TARGETS=[
  'https://www.stoloto.ru/top-3',
  'https://www.stoloto.ru/top-3/rules?int=faq',
  'https://www.stoloto.ru/top-3/archive',
  'https://m.stoloto.ru/top-3',
  'https://m.stoloto.ru/top-3/archive'
];

async function firstVisible(xs){
  for(const x of xs) if(await x.isVisible({timeout:800}).catch(()=>false)) return x;
  return null;
}
async function login(page){
  if(!EMAIL||!PASSWORD) throw new Error('Нет STOLOTO_EMAIL/STOLOTO_PASSWORD');
  await page.goto(LOGIN,{waitUntil:'domcontentloaded',timeout:60000});
  const email=await firstVisible([
    page.locator('input[type="email"]').first(),
    page.locator('input[autocomplete="username"]').first(),
    page.locator('input[type="text"]').first()
  ]);
  const pass=await firstVisible([
    page.locator('input[type="password"]').first(),
    page.locator('input[autocomplete="current-password"]').first()
  ]);
  if(!email||!pass) throw new Error('Не найдены поля OAuth');
  await email.fill(EMAIL); await pass.fill(PASSWORD);
  const btn=await firstVisible([
    page.getByRole('button',{name:/войти/i}).first(),
    page.locator('button[type="submit"]').first()
  ]);
  if(!btn) throw new Error('Не найдена кнопка Войти');
  await btn.click();
  await page.waitForTimeout(2000);
}

function clean(s){return String(s??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim()}
function short(s,n=900){s=clean(s);return s.length>n?s.slice(0,n)+'…':s}
function interestingText(s){
  return /26775[6-9]|2677[6-9]\d|top-?3|draw|тираж|winner|winning|result/i.test(String(s||''));
}

async function main(){
  const browser=await chromium.launch({headless:true});
  const ctx=await browser.newContext({
    locale:'ru-RU', timezoneId:'Europe/Moscow',
    viewport:{width:430,height:1800},
    userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });
  const page=await ctx.newPage();
  await login(page);

  for(const url of TARGETS){
    console.log('\n====================================================');
    console.log('PROBE URL:',url);
    const hits=[];
    const handler=async response=>{
      try{
        const ru=response.url();
        const ct=(response.headers()['content-type']||'').toLowerCase();
        if(!/json|javascript|text/.test(ct)) return;
        if(!/stoloto/i.test(ru)) return;
        let body='';
        try{ body=await response.text(); }catch{}
        if(interestingText(body)||/draw|result|product|archive|actual|history/i.test(ru)){
          hits.push({status:response.status(),url:ru,ct,body:short(body)});
        }
      }catch{}
    };
    page.on('response',handler);
    try{
      const r=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
      await page.waitForTimeout(6500);
      for(let i=0;i<4;i++){await page.mouse.wheel(0,1500);await page.waitForTimeout(500)}
      await page.mouse.wheel(0,-7000); await page.waitForTimeout(800);
      const body=await page.locator('body').innerText().catch(()=> '');
      console.log('FINAL URL:',page.url());
      console.log('HTTP:',r?.status?.() ?? 'n/a');
      console.log('TITLE:',await page.title().catch(()=>''));      
      const lines=String(body).split(/\r?\n/).map(clean).filter(Boolean);
      const focus=lines.filter(x=>interestingText(x)||/^\d{2}:\d{2}(?::\d{2})?$/.test(x)||/^№\s*\d+/.test(x));
      console.log('DOM FOCUS:',JSON.stringify(focus.slice(0,160),null,2));
    }catch(e){
      console.log('PAGE ERROR:',e.message);
    }
    page.off('response',handler);
    console.log('NETWORK HITS:',hits.length);
    for(const h of hits.slice(0,80)){
      console.log('\n---',h.status,h.ct,h.url);
      console.log(h.body);
    }
  }
  await ctx.close(); await browser.close();
}
main().catch(e=>{console.error('PROBE ERROR:',e);process.exit(1)});
