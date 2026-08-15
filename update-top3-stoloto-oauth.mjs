import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const EMAIL = process.env.STOLOTO_EMAIL || '';
const PASSWORD = process.env.STOLOTO_PASSWORD || '';

const LIVE_FILE = new URL('./top3-live.json', import.meta.url);
const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const ARCHIVE_URL = 'https://m.stoloto.ru/top3/archive';

const REGULAR_TIMES = new Set([
  '02:40','04:40','06:40','07:40','09:40',
  '11:40','13:40','16:25','21:25','22:40'
]);

function clean(s) {
  return String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function moscowDateParts(offsetDays=0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  const d = new Date(Date.UTC(Number(p.year), Number(p.month)-1, Number(p.day), 12, 0, 0));
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}

function formatDate(d) {
  return `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}.${String(d.getUTCFullYear()).slice(-2)}`;
}

function validDate(s) {
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return false;
  const d = Number(m[1]), mo = Number(m[2]), y = 2000+Number(m[3]);
  const dt = new Date(Date.UTC(y,mo-1,d));
  return dt.getUTCFullYear()===y && dt.getUTCMonth()===mo-1 && dt.getUTCDate()===d;
}

function validDraw(d) {
  return Number.isInteger(d?.id)
    && d.id >= 100000 && d.id <= 999999
    && validDate(d.date)
    && REGULAR_TIMES.has(d.time)
    && [d.a,d.b,d.c].every(n => Number.isInteger(n) && n >= 0 && n <= 9);
}

function normalizeDraw(d) {
  const x = {
    id:Number(d?.id),
    date:String(d?.date ?? ''),
    time:String(d?.time ?? ''),
    a:Number(d?.a), b:Number(d?.b), c:Number(d?.c)
  };
  return validDraw(x) ? x : null;
}

function dedupe(draws) {
  const m = new Map();
  for (const raw of draws) {
    const d = normalizeDraw(raw);
    if (d) m.set(d.id,d);
  }
  return [...m.values()].sort((a,b)=>b.id-a.id);
}

function drawKey(d) {
  return `${d.id}|${d.date}|${d.time}|${d.a}${d.b}${d.c}`;
}

function extractDigits(lines, startIndex) {
  // 1) одна строка вида "9 1 5"
  for (let j=startIndex+1; j<Math.min(lines.length,startIndex+14); j++) {
    if (/^\d{2}:\d{2}(?::\d{2})?\b/.test(lines[j]) && /№/.test(lines[j])) break;

    const m = lines[j].match(/^([0-9])\s+([0-9])\s+([0-9])$/);
    if (m) return [Number(m[1]),Number(m[2]),Number(m[3])];

    // 2) три одиночные цифры подряд
    if (/^[0-9]$/.test(lines[j])) {
      const vals = [Number(lines[j])];
      for (let k=j+1; k<Math.min(lines.length,j+6) && vals.length<3; k++) {
        if (/^[0-9]$/.test(lines[k])) vals.push(Number(lines[k]));
        else if (vals.length) break;
      }
      if (vals.length===3) return vals;
    }
  }
  return null;
}

function parseArchiveText(rawText) {
  const lines = String(rawText ?? '')
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const months = {
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12
  };

  const currentYear = Number(new Intl.DateTimeFormat('en', {
    timeZone:'Europe/Moscow',
    year:'numeric'
  }).format(new Date()));

  const found = [];
  let currentDate = '';

  function setExplicitDate(line) {
    if (/^Сегодня$/i.test(line)) {
      currentDate = formatDate(moscowDateParts(0));
      return true;
    }

    if (/^Вчера$/i.test(line)) {
      currentDate = formatDate(moscowDateParts(-1));
      return true;
    }

    // Форматы вида "9 августа", "9 августа 2026"
    let m = line.toLowerCase().match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
    if (m && months[m[2]]) {
      const day = Number(m[1]);
      const month = months[m[2]];
      const year = m[3] ? Number(m[3]) : currentYear;
      const d = new Date(Date.UTC(year, month - 1, day));
      const candidate = formatDate(d);
      if (validDate(candidate)) {
        currentDate = candidate;
        return true;
      }
    }

    // Форматы вида 09.08.2026 / 09.08.26
    m = line.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
    if (m) {
      const year = String(m[3]).length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[1])));
      const candidate = formatDate(d);
      if (validDate(candidate)) {
        currentDate = candidate;
        return true;
      }
    }

    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (setExplicitDate(line)) continue;

    // Реальный формат Столото:
    // 04:40:00
    // № 267473
    // 9
    // 1
    // 5
    const tm = line.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
    if (!tm || !currentDate) continue;

    const time = `${tm[1]}:${tm[2]}`;
    if (!REGULAR_TIMES.has(time)) continue;

    const idLine = lines[i + 1] || '';
    const idm = idLine.match(/^№\s*(\d{6})$/i);
    if (!idm) continue;

    const digits = lines.slice(i + 2, i + 5);
    if (digits.length !== 3 || !digits.every(x => /^[0-9]$/.test(x))) continue;

    const d = {
      id: Number(idm[1]),
      date: currentDate,
      time,
      a: Number(digits[0]),
      b: Number(digits[1]),
      c: Number(digits[2])
    };

    if (validDraw(d)) found.push(d);
  }

  return dedupe(found);
}

async function firstVisible(candidates) {
  for (const loc of candidates) {
    if (await loc.isVisible({timeout:800}).catch(()=>false)) return loc;
  }
  return null;
}

async function login(page) {
  if (!EMAIL || !PASSWORD) throw new Error('не заданы Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');

  await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForTimeout(900);

  const email = await firstVisible([
    page.getByLabel(/телефон или email/i).first(),
    page.getByLabel(/email/i).first(),
    page.locator('input[type="email"]').first(),
    page.locator('input[name*="email" i]').first(),
    page.locator('input[name*="login" i]').first(),
    page.locator('input[autocomplete="username"]').first(),
    page.locator('input[type="text"]').first()
  ]);

  const password = await firstVisible([
    page.getByLabel(/пароль/i).first(),
    page.locator('input[type="password"]').first(),
    page.locator('input[name*="password" i]').first(),
    page.locator('input[autocomplete="current-password"]').first()
  ]);

  if (!email || !password) throw new Error('OAuth-форма не отдала поля логин/пароль');

  await email.fill(EMAIL);
  await password.fill(PASSWORD);

  const submit = await firstVisible([
    page.getByRole('button',{name:/^войти$/i}).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first()
  ]);

  if (!submit) throw new Error('OAuth-форма не отдала кнопку "Войти"');
  if (!(await submit.isEnabled().catch(()=>false))) throw new Error('кнопка "Войти" неактивна');

  await submit.click({timeout:10000});
  await page.waitForLoadState('domcontentloaded',{timeout:15000}).catch(()=>{});
  await page.waitForTimeout(1800);

  const body = clean(await page.locator('body').innerText().catch(()=>''));
  if (/неверн.*(парол|логин|почт)|пользователь.*не найден|ошибк.*вход/i.test(body)) {
    throw new Error('Столото отклонил авторизацию');
  }

  const stillPassword = await page.locator('input[type="password"]').first()
    .isVisible({timeout:300}).catch(()=>false);

  if (page.url().includes('/login') && stillPassword) throw new Error('OAuth-вход не подтверждён');
}

async function readArchivePass(browser,pass) {
  const context = await browser.newContext({
    locale:'ru-RU',
    timezoneId:'Europe/Moscow',
    viewport:{width:412,height:1800},
    userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await login(page);
    await page.goto(ARCHIVE_URL,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(2200);

    for (let i=0;i<5;i++) {
      await page.mouse.wheel(0,1400);
      await page.waitForTimeout(350);
    }

    await page.mouse.wheel(0,-7000);
    await page.waitForTimeout(500);

    const body = await page.locator('body').innerText();

    const draws = parseArchiveText(body);

    if (draws.length < 3) {
      // Диагностика без секретов: покажет первые строки страницы, если формат снова изменится.
      const sample = body.split(/\r?\n/).map(clean).filter(Boolean).slice(0,80);
      console.log('ARCHIVE TEXT SAMPLE:', JSON.stringify(sample));
      throw new Error(`распознано слишком мало тиражей: ${draws.length}`);
    }

    console.log(`PASS ${pass}: rows=${draws.length}; latest №${draws[0].id} ${draws[0].date} ${draws[0].time}=${draws[0].a}${draws[0].b}${draws[0].c}`);
    return draws;
  } finally {
    await context.close();
  }
}

function sameSnapshot(a,b) {
  return JSON.stringify(a.slice(0,12))===JSON.stringify(b.slice(0,12));
}

function moscowStamp(d) {
  const [dd,mm,yy]=d.date.split('.').map(Number);
  const [hh,mi]=d.time.split(':').map(Number);
  return Date.UTC(2000+yy,mm-1,dd,hh-3,mi);
}

async function main() {
  const live = JSON.parse(await fs.readFile(LIVE_FILE,'utf8'));
  const existing = dedupe(live.draws||[]);
  if (!existing.length) throw new Error('top3-live.json не содержит доверенных тиражей');

  const anchor = existing[0];
  console.log(`Доверенный anchor: №${anchor.id} ${anchor.date} ${anchor.time}=${anchor.a}${anchor.b}${anchor.c}`);

  const browser = await chromium.launch({headless:true});
  let passes=[];
  try {
    for (let i=1;i<=3;i++) passes.push(await readArchivePass(browser,i));
  } finally {
    await browser.close();
  }

  if (!sameSnapshot(passes[0],passes[1]) || !sameSnapshot(passes[1],passes[2])) {
    throw new Error('три независимых чтения Столото не совпали — запись запрещена');
  }

  const source = passes[0];
  const sourceAnchor = source.find(d=>d.id===anchor.id);
  if (!sourceAnchor) throw new Error(`официальный архив не содержит доверенный anchor №${anchor.id}`);

  if (drawKey(sourceAnchor)!==drawKey(anchor)) {
    throw new Error(`anchor №${anchor.id} не совпал: ожидалось ${drawKey(anchor)}, получено ${drawKey(sourceAnchor)}`);
  }

  const existingMap = new Map(existing.map(d=>[d.id,d]));
  let overlap=0;

  for (const d of source) {
    const old=existingMap.get(d.id);
    if (!old) continue;
    overlap++;
    if (drawKey(old)!==drawKey(d)) throw new Error(`несовпадение сохранённого тиража №${d.id}`);
  }

  if (overlap<1) throw new Error('нет подтверждённого пересечения с архивом');

  const newer = source.filter(d=>d.id>anchor.id).sort((a,b)=>a.id-b.id);

  for (let i=0;i<newer.length;i++) {
    const expected=anchor.id+1+i;
    if (newer[i].id!==expected) throw new Error(`разрыв номеров: ожидался №${expected}, получен №${newer[i].id}`);
  }

  let prev=anchor;
  const slots=new Set(existing.slice(0,30).map(d=>`${d.date}|${d.time}`));

  for (const d of newer) {
    if (moscowStamp(d)<=moscowStamp(prev)) throw new Error(`нарушена хронология №${prev.id} -> №${d.id}`);
    const slot=`${d.date}|${d.time}`;
    if (slots.has(slot)) throw new Error(`повтор даты/времени ${slot}`);
    slots.add(slot);
    prev=d;
  }

  if (newer.length>30) throw new Error(`слишком большой скачок: ${newer.length}`);

  if (!newer.length) {
    console.log('Новых подтверждённых тиражей нет.');
    return;
  }

  const merged=dedupe([...newer,...existing]).slice(0,150);

  const output={
    ...live,
    schema:3,
    source:'Официальный Столото · OAuth · тройная проверка',
    updatedAt:new Date().toISOString(),
    latest:merged[0].id,
    draws:merged
  };

  await fs.writeFile(LIVE_FILE,JSON.stringify(output,null,2)+'\n','utf8');

  console.log(`ГОТОВО: добавлено ${newer.length}; latest №${merged[0].id}`);
  for (const d of newer) console.log(`№${d.id} ${d.date} ${d.time}=${d.a}${d.b}${d.c}`);
}

main().catch(err=>{
  console.error('SAFE STOLOTO UPDATER ERROR:',err.message);
  process.exit(1);
});
