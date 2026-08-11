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

function fmtDate(date) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: '2-digit'
  }).formatToParts(date);
  const x = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${x.day}.${x.month}.${x.year}`;
}

function moscowNow() {
  return new Date();
}

function dateOffset(days) {
  // Вычисляем календарную дату Москвы через полдень UTC, чтобы не ловить границы суток.
  const now = new Date();
  const msk = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow', year:'numeric', month:'2-digit', day:'2-digit'
  }).formatToParts(now);
  const x = Object.fromEntries(msk.map(p => [p.type, p.value]));
  const base = new Date(Date.UTC(Number(x.year), Number(x.month)-1, Number(x.day), 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return fmtDate(base);
}

function validCalendarDate(s) {
  const m = String(s).match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  if (!m) return false;
  const d = Number(m[1]), mo = Number(m[2]), y = 2000 + Number(m[3]);
  const dt = new Date(Date.UTC(y, mo-1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo-1 && dt.getUTCDate() === d;
}

function validDraw(d) {
  return Number.isInteger(d?.id)
    && d.id >= 100000 && d.id <= 999999
    && validCalendarDate(d.date)
    && REGULAR_TIMES.has(d.time)
    && [d.a,d.b,d.c].every(n => Number.isInteger(n) && n >= 0 && n <= 9);
}

function normalizeDraw(d) {
  const out = {
    id: Number(d?.id),
    date: String(d?.date ?? ''),
    time: String(d?.time ?? ''),
    a: Number(d?.a),
    b: Number(d?.b),
    c: Number(d?.c)
  };
  return validDraw(out) ? out : null;
}

function drawKey(d) {
  return `${d.id}|${d.date}|${d.time}|${d.a}${d.b}${d.c}`;
}

function dedupe(draws) {
  const m = new Map();
  for (const raw of draws) {
    const d = normalizeDraw(raw);
    if (d) m.set(d.id, d);
  }
  return [...m.values()].sort((a,b) => b.id - a.id);
}

function parseSectionDate(line) {
  const t = clean(line).toLowerCase();
  if (t === 'сегодня') return dateOffset(0);
  if (t === 'вчера') return dateOffset(-1);

  let m = t.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2}|\d{4})$/);
  if (m) {
    const yy = String(m[3]).slice(-2);
    const s = `${String(m[1]).padStart(2,'0')}.${String(m[2]).padStart(2,'0')}.${yy}`;
    return validCalendarDate(s) ? s : '';
  }

  const months = {
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12
  };
  m = t.match(/^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?$/i);
  if (m && months[m[2]]) {
    const currentYear = Number(new Intl.DateTimeFormat('en', {
      timeZone:'Europe/Moscow', year:'numeric'
    }).format(new Date()));
    const year = m[3] ? Number(m[3]) : currentYear;
    const s = `${String(m[1]).padStart(2,'0')}.${String(months[m[2]]).padStart(2,'0')}.${String(year).slice(-2)}`;
    return validCalendarDate(s) ? s : '';
  }

  return '';
}

function parseArchiveText(rawText) {
  const lines = String(rawText ?? '')
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const found = [];
  let currentDate = '';

  for (let i=0; i<lines.length; i++) {
    const sectionDate = parseSectionDate(lines[i]);
    if (sectionDate) {
      currentDate = sectionDate;
      continue;
    }

    const head = lines[i].match(/^(\d{2}):(\d{2})(?::\d{2})?\s*[·•]\s*№\s*(\d{6})$/i);
    if (!head || !currentDate) continue;

    const time = `${head[1]}:${head[2]}`;
    const id = Number(head[3]);
    if (!REGULAR_TIMES.has(time)) continue;

    let digits = null;

    for (let j=i+1; j<Math.min(lines.length, i+12); j++) {
      // До следующего тиража не перескакиваем.
      if (/^\d{2}:\d{2}(?::\d{2})?\s*[·•]\s*№\s*\d{6}$/i.test(lines[j])) break;

      let m = lines[j].match(/^([0-9])\s+([0-9])\s+([0-9])$/);
      if (m) {
        digits = [Number(m[1]),Number(m[2]),Number(m[3])];
        break;
      }

      // Иногда innerText отдаёт каждую цифру отдельной строкой.
      if (/^[0-9]$/.test(lines[j])) {
        const tmp = [Number(lines[j])];
        for (let k=j+1; k<Math.min(lines.length,j+5) && tmp.length<3; k++) {
          if (/^[0-9]$/.test(lines[k])) tmp.push(Number(lines[k]));
          else if (tmp.length) break;
        }
        if (tmp.length === 3) {
          digits = tmp;
          break;
        }
      }
    }

    if (!digits) continue;

    const d = { id, date: currentDate, time, a:digits[0], b:digits[1], c:digits[2] };
    if (validDraw(d)) found.push(d);
  }

  return dedupe(found);
}

async function firstVisible(candidates) {
  for (const loc of candidates) {
    if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return loc;
  }
  return null;
}

async function login(page) {
  if (!EMAIL || !PASSWORD) {
    throw new Error('не заданы Secrets STOLOTO_EMAIL / STOLOTO_PASSWORD');
  }

  await page.goto(LOGIN_URL, { waitUntil:'domcontentloaded', timeout:45000 });
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
    page.getByRole('button', { name:/^войти$/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first()
  ]);

  if (!submit) throw new Error('OAuth-форма не отдала кнопку "Войти"');
  if (!(await submit.isEnabled().catch(() => false))) throw new Error('кнопка "Войти" неактивна');

  await submit.click({ timeout:5000 });
  await page.waitForLoadState('domcontentloaded', { timeout:15000 }).catch(() => {});
  await page.waitForTimeout(1800);

  const body = clean(await page.locator('body').innerText().catch(() => ''));
  if (/неверн.*(парол|логин|почт)|пользователь.*не найден|ошибк.*вход/i.test(body)) {
    throw new Error('Столото отклонил авторизацию');
  }

  const stillPassword = await page.locator('input[type="password"]').first()
    .isVisible({ timeout:300 }).catch(() => false);

  if (page.url().includes('/login') && stillPassword) {
    throw new Error('OAuth-вход не подтверждён');
  }
}

async function readArchivePass(browser, pass) {
  const context = await browser.newContext({
    locale:'ru-RU',
    timezoneId:'Europe/Moscow',
    viewport:{width:412,height:1800},
    userAgent:'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });

  const page = await context.newPage();

  try {
    await login(page);
    await page.goto(ARCHIVE_URL, { waitUntil:'domcontentloaded', timeout:45000 });
    await page.waitForTimeout(2200);

    // Чуть прокручиваем, чтобы динамический архив успел дорисовать "Вчера".
    for (let i=0; i<4; i++) {
      await page.mouse.wheel(0, 1400);
      await page.waitForTimeout(350);
    }
    await page.mouse.wheel(0, -6000);
    await page.waitForTimeout(500);

    const body = await page.locator('body').innerText();
    if (!/Архив тиражей/i.test(body)) throw new Error('не найден блок "Архив тиражей"');

    const draws = parseArchiveText(body);
    if (draws.length < 3) {
      throw new Error(`распознано слишком мало тиражей: ${draws.length}`);
    }

    console.log(`PASS ${pass}: ${draws.length} rows; latest №${draws[0].id} ${draws[0].date} ${draws[0].time}=${draws[0].a}${draws[0].b}${draws[0].c}`);
    return draws;
  } finally {
    await context.close();
  }
}

function sameSnapshot(a,b) {
  // Верхние 12 строк должны совпасть. Этого достаточно, чтобы не записать нестабильную выдачу.
  return JSON.stringify(a.slice(0,12)) === JSON.stringify(b.slice(0,12));
}

function moscowStamp(d) {
  const [dd,mm,yy] = d.date.split('.').map(Number);
  const [hh,mi] = d.time.split(':').map(Number);
  return Date.UTC(2000+yy, mm-1, dd, hh-3, mi);
}

async function main() {
  const live = JSON.parse(await fs.readFile(LIVE_FILE, 'utf8'));
  const existing = dedupe(live.draws || []);
  if (!existing.length) throw new Error('top3-live.json не содержит доверенных тиражей');

  const anchor = existing[0];
  console.log(`Доверенный anchor: №${anchor.id} ${anchor.date} ${anchor.time}=${anchor.a}${anchor.b}${anchor.c}`);

  const browser = await chromium.launch({ headless:true });
  let passes;

  try {
    passes = [];
    for (let pass=1; pass<=3; pass++) {
      passes.push(await readArchivePass(browser, pass));
    }
  } finally {
    await browser.close();
  }

  if (!sameSnapshot(passes[0], passes[1]) || !sameSnapshot(passes[1], passes[2])) {
    throw new Error('три независимых чтения Столото не совпали — запись запрещена');
  }

  const source = passes[0];

  const sourceAnchor = source.find(d => d.id === anchor.id);
  if (!sourceAnchor) {
    throw new Error(`официальный архив не содержит доверенный anchor №${anchor.id} — запись запрещена`);
  }

  if (drawKey(sourceAnchor) !== drawKey(anchor)) {
    throw new Error(
      `anchor №${anchor.id} не совпал: ожидалось ${drawKey(anchor)}, получено ${drawKey(sourceAnchor)}`
    );
  }

  // Все пересечения с уже сохранёнными данными обязаны совпадать.
  const existingMap = new Map(existing.map(d => [d.id, d]));
  let overlap = 0;
  for (const d of source) {
    const old = existingMap.get(d.id);
    if (!old) continue;
    overlap++;
    if (drawKey(old) !== drawKey(d)) {
      throw new Error(`несовпадение сохранённого тиража №${d.id}`);
    }
  }
  if (overlap < 1) throw new Error('нет ни одного подтверждённого пересечения с архивом');

  const newer = source
    .filter(d => d.id > anchor.id)
    .sort((a,b) => a.id - b.id);

  for (let i=0; i<newer.length; i++) {
    const expected = anchor.id + 1 + i;
    if (newer[i].id !== expected) {
      throw new Error(`разрыв номеров: ожидался №${expected}, получен №${newer[i].id}`);
    }
  }

  let prev = anchor;
  const seenSlots = new Set(existing.slice(0,30).map(d => `${d.date}|${d.time}`));

  for (const d of newer) {
    if (moscowStamp(d) <= moscowStamp(prev)) {
      throw new Error(`нарушена хронология №${prev.id} -> №${d.id}`);
    }

    const slot = `${d.date}|${d.time}`;
    if (seenSlots.has(slot)) throw new Error(`повтор даты/времени ${slot}`);
    seenSlots.add(slot);
    prev = d;
  }

  if (newer.length > 30) {
    throw new Error(`слишком большой скачок за один запуск: ${newer.length} тиражей`);
  }

  if (!newer.length) {
    console.log('Новых подтверждённых тиражей нет. top3-live.json не меняется.');
    return;
  }

  const merged = dedupe([...newer, ...existing]).slice(0,150);

  const output = {
    ...live,
    schema: 3,
    source: 'Официальный Столото · OAuth · тройная проверка',
    updatedAt: new Date().toISOString(),
    latest: merged[0].id,
    draws: merged
  };

  await fs.writeFile(LIVE_FILE, JSON.stringify(output, null, 2) + '\n', 'utf8');

  console.log(`ГОТОВО: добавлено ${newer.length}; latest №${merged[0].id}`);
  for (const d of newer) {
    console.log(`№${d.id} ${d.date} ${d.time} = ${d.a}${d.b}${d.c}`);
  }
}

main().catch(err => {
  console.error('SAFE STOLOTO UPDATER ERROR:', err.message);
  process.exit(1);
});
