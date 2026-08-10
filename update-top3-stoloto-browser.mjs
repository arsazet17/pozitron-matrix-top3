import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { uniqueDraws, ensureServerForecast } from './update-top3.mjs';

const LIVE_FILE = new URL('./top3-live.json', import.meta.url);
const SEED_FILE = new URL('./top3-data.js', import.meta.url);
const ARCHIVE_URL = 'https://www.stoloto.ru/top3/archive';
const REGULAR_DRAW_TIMES = new Set([
  '02:40','04:40','06:40','07:40','09:40',
  '11:40','13:40','16:25','21:25','22:40'
]);

function normalizeDate(value) {
  const m = String(value ?? '').match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})/);
  if (!m) return '';
  return `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${m[3].slice(-2)}`;
}

function normalizeTime(value) {
  const m = String(value ?? '').match(/(?:^|\D)(\d{1,2}):(\d{2})(?::\d{2})?(?:\D|$)/);
  if (!m) return '';
  const h = Number(m[1]), min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return '';
  return `${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}`;
}

function normalizeDraw(raw) {
  const draw = {
    id: Number(raw?.id),
    date: normalizeDate(raw?.date),
    time: normalizeTime(raw?.time),
    a: Number(raw?.a),
    b: Number(raw?.b),
    c: Number(raw?.c)
  };
  if (!Number.isInteger(draw.id) || draw.id < 100000 || draw.id > 999999) return null;
  if (!/^\d{2}\.\d{2}\.\d{2}$/.test(draw.date)) return null;
  if (!REGULAR_DRAW_TIMES.has(draw.time)) return null;
  if (![draw.a, draw.b, draw.c].every(v => Number.isInteger(v) && v >= 0 && v <= 9)) return null;
  return draw;
}

async function readSeed() {
  const text = (await fs.readFile(SEED_FILE, 'utf8')).trim();
  const json = text.replace(/^\s*window\.TOP3_SEED\s*=\s*/, '').replace(/;\s*$/, '');
  const rows = JSON.parse(json);
  return uniqueDraws(rows.map(row => normalizeDraw({
    id: row[0], date: row[1], time: row[2], a: row[3], b: row[4], c: row[5]
  })).filter(Boolean));
}

async function readExisting() {
  try {
    const payload = JSON.parse(await fs.readFile(LIVE_FILE, 'utf8'));
    const draws = uniqueDraws((Array.isArray(payload) ? payload : (payload.draws || []))
      .map(normalizeDraw).filter(Boolean));
    return { forecasts: Array.isArray(payload?.forecasts) ? payload.forecasts : [], draws };
  } catch {
    return { forecasts: [], draws: [] };
  }
}

function parseRowText(text, hintedId = null) {
  const clean = String(text ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const id = hintedId ?? Number(clean.match(/(?:№\s*)?(\d{6})/)?.[1]);
  const dateMatch = clean.match(/(\d{1,2}[.\/-]\d{1,2}[.\/-](?:\d{2}|\d{4}))/);
  const timeMatch = clean.match(/(?:^|\s)(\d{1,2}:\d{2})(?::\d{2})?(?:\s|$)/);
  if (!id || !dateMatch || !timeMatch) return null;

  const date = normalizeDate(dateMatch[1]);
  const time = normalizeTime(timeMatch[1]);
  if (!REGULAR_DRAW_TIMES.has(time)) return null;

  let rest = ` ${clean} `
    .replace(dateMatch[0], ' ')
    .replace(timeMatch[0], ' ')
    .replace(new RegExp(`№?\\s*${id}`), ' ')
    .replace(/\d[\d\s\u00a0]*₽/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ');

  const digits = [...rest.matchAll(/(?:^|\D)([0-9])(?=\D|$)/g)].map(m => Number(m[1]));
  if (digits.length < 3) return null;

  return normalizeDraw({ id, date, time, a: digits[0], b: digits[1], c: digits[2] });
}

async function dismissOverlays(page) {
  for (const label of ['Принять','Согласен','Хорошо','Понятно','Закрыть']) {
    try {
      const b = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (await b.isVisible({ timeout: 500 })) await b.click({ timeout: 1000 });
    } catch {}
  }
}

async function collectFromArchivePage(page) {
  await page.goto(`${ARCHIVE_URL}?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await dismissOverlays(page);
  await page.waitForTimeout(7000);

  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(700);
  }

  const candidates = await page.locator('a[href*="/top3/archive/"]').evaluateAll(nodes =>
    nodes.map(a => {
      let el = a, best = a.innerText || '';
      for (let i = 0; i < 7 && el; i++, el = el.parentElement) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length >= best.length && t.length < 700) best = t;
      }
      return { href: a.getAttribute('href') || '', text: best };
    })
  );

  const found = new Map();
  for (const item of candidates) {
    const id = Number(item.href.match(/\/top3\/archive\/(\d{6})/)?.[1]);
    if (!id) continue;
    const draw = parseRowText(item.text, id);
    if (draw) found.set(draw.id, draw);
  }
  console.log(`Основная страница архива: найдено ${found.size} тиражей`);
  return [...found.values()].sort((a,b) => b.id-a.id);
}

async function collectOneDetail(page, id) {
  await page.goto(`${ARCHIVE_URL}/${id}?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await dismissOverlays(page);
  await page.waitForTimeout(3000);
  const text = await page.locator('body').innerText({ timeout: 10000 });
  return parseRowText(text, id);
}

function verifyAgainstExisting(draws, reference) {
  const byId = new Map(uniqueDraws(reference).map(d => [d.id, d]));
  const valid = uniqueDraws(draws);
  for (const draw of valid) {
    const old = byId.get(draw.id);
    if (!old) continue;
    if (draw.date !== old.date || draw.time !== old.time ||
        draw.a !== old.a || draw.b !== old.b || draw.c !== old.c) {
      throw new Error(`контрольная строка №${draw.id} не совпала с сохранённым архивом`);
    }
  }
  return valid;
}

async function main() {
  const seed = await readSeed();
  const existing = await readExisting();
  const reference = uniqueDraws([...existing.draws, ...seed]);
  const latestKnown = reference[0]?.id || 0;
  if (!latestKnown) throw new Error('не найден последний известный тираж');

  console.log(`Последний сохранённый тираж №${latestKnown}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    viewport: { width: 1440, height: 1100 }
  });
  const page = await context.newPage();

  try {
    const found = new Map();

    try {
      const archiveDraws = verifyAgainstExisting(await collectFromArchivePage(page), reference);
      archiveDraws.forEach(d => found.set(d.id, d));
    } catch (error) {
      console.warn(`Основная страница архива: ${error.message}`);
    }

    let consecutiveMissing = 0;
    for (let id = Math.max(100000, latestKnown - 2); id <= latestKnown + 20; id++) {
      if (found.has(id)) continue;
      try {
        const draw = await collectOneDetail(page, id);
        if (draw) {
          const checked = verifyAgainstExisting([draw], reference);
          if (checked.length) {
            found.set(draw.id, draw);
            if (id > latestKnown) consecutiveMissing = 0;
            console.log(`Столото: №${draw.id} ${draw.date} ${draw.time} = ${draw.a}${draw.b}${draw.c}`);
          }
        } else if (id > latestKnown) {
          consecutiveMissing++;
        }
      } catch (error) {
        console.warn(`Страница №${id}: ${error.message}`);
        if (id > latestKnown) consecutiveMissing++;
      }
      if (id > latestKnown && consecutiveMissing >= 3) break;
    }

    const official = [...found.values()].sort((a,b) => b.id-a.id);
    const newer = official.filter(d => d.id > latestKnown);
    if (!official.length) throw new Error('браузер открыл Столото, но не распознал ни одного тиража');

    console.log(`Распознано официальных тиражей: ${official.length}; новых: ${newer.length}`);

    const history = uniqueDraws([...seed, ...existing.draws, ...official]);
    const draws = history.slice(0, 150);
    const forecasts = ensureServerForecast(existing.forecasts, history);

    const drawsChanged = JSON.stringify(draws) !== JSON.stringify(existing.draws);
    const forecastsChanged = JSON.stringify(forecasts) !== JSON.stringify(existing.forecasts || []);
    if (!drawsChanged && !forecastsChanged) {
      console.log(`Новых данных нет. Последний №${draws[0]?.id}.`);
      return;
    }

    const payload = {
      schema: 3,
      source: 'Столото — официальный архив (Chromium)',
      updatedAt: new Date().toISOString(),
      latest: draws[0].id,
      regularTimes: [...REGULAR_DRAW_TIMES],
      forecasts,
      draws
    };

    await fs.writeFile(LIVE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`top3-live.json обновлён. Последний №${draws[0].id}.`);
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error('STOLOTO BROWSER PARSER ERROR:', error);
  process.exit(1);
});
