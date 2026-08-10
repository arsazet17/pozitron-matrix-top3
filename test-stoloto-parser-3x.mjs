import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const ARCHIVE_URL = 'https://www.stoloto.ru/top3/archive';
const LIVE_FILE = new URL('./top3-live.json', import.meta.url);
const REPORT_FILE = new URL('./stoloto-parser-test-report.json', import.meta.url);

const REGULAR_TIMES = new Set([
  '02:40','04:40','06:40','07:40','09:40',
  '11:40','13:40','16:25','21:25','22:40'
]);

function isValidDateParts(dd, mm, yyyy) {
  const d = Number(dd), m = Number(mm), y = Number(yyyy);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return false;
  if (y < 2024 || y > 2030 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normalizeDate(value) {
  const m = String(value ?? '').match(/(?:^|\D)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2}|\d{4})(?:\D|$)/);
  if (!m) return '';
  const yyyy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (!isValidDateParts(m[1], m[2], yyyy)) return '';
  return `${m[1].padStart(2,'0')}.${m[2].padStart(2,'0')}.${String(yyyy).slice(-2)}`;
}

function normalizeTime(value) {
  const m = String(value ?? '').match(/(?:^|\D)(\d{1,2}):(\d{2})(?::\d{2})?(?:\D|$)/);
  if (!m) return '';
  const hh = String(Number(m[1])).padStart(2,'0');
  const mm = m[2];
  const t = `${hh}:${mm}`;
  return REGULAR_TIMES.has(t) ? t : '';
}

function parseMoscowStamp(date, time) {
  const [dd, mm, yy] = date.split('.').map(Number);
  const [hh, mi] = time.split(':').map(Number);
  // Moscow is UTC+3 year-round.
  return Date.UTC(2000 + yy, mm - 1, dd, hh - 3, mi, 0);
}

function normalizeDraw(raw) {
  const id = Number(raw?.id);
  const date = normalizeDate(raw?.date);
  const time = normalizeTime(raw?.time);
  const a = Number(raw?.a), b = Number(raw?.b), c = Number(raw?.c);

  if (!Number.isInteger(id) || id < 100000 || id > 999999) return null;
  if (!date || !time) return null;
  if (![a,b,c].every(x => Number.isInteger(x) && x >= 0 && x <= 9)) return null;

  return { id, date, time, a, b, c };
}

function extractSingleDigits(text) {
  return [...String(text).matchAll(/(?:^|[\s,;|()[\]{}:+-])([0-9])(?=$|[\s,;|()[\]{}:+-])/g)]
    .map(m => Number(m[1]));
}

function parseStrictRowText(text, id) {
  let clean = String(text ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!new RegExp(`(?:№\\s*)?${id}(?!\\d)`).test(clean)) return null;

  const dateMatches = [...clean.matchAll(/(\d{1,2}[.\/-]\d{1,2}[.\/-](?:\d{2}|\d{4}))/g)]
    .map(m => m[1])
    .map(normalizeDate)
    .filter(Boolean);
  const dates = [...new Set(dateMatches)];
  if (dates.length !== 1) return null;

  const timeMatches = [...clean.matchAll(/(\d{1,2}:\d{2})(?::\d{2})?/g)]
    .map(m => normalizeTime(m[1]))
    .filter(Boolean);
  const times = [...new Set(timeMatches)];
  if (times.length !== 1) return null;

  const date = dates[0], time = times[0];

  // Убираем номер тиража, дату, время и денежные суммы.
  let rest = ` ${clean} `;
  rest = rest.replace(new RegExp(`№?\\s*${id}(?!\\d)`, 'g'), ' ');
  rest = rest.replace(/\d{1,2}[.\/-]\d{1,2}[.\/-](?:\d{2}|\d{4})/g, ' ');
  rest = rest.replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ');
  rest = rest.replace(/\d[\d\s]*₽/g, ' ');
  rest = rest.replace(/\b\d{2,}\b/g, ' ');

  const digits = extractSingleDigits(rest);

  // Строго: в строке тиража после удаления служебных чисел должна быть ровно одна тройка.
  if (digits.length !== 3) return null;

  return normalizeDraw({ id, date, time, a: digits[0], b: digits[1], c: digits[2] });
}

function drawKey(d) {
  return `${d.id}|${d.date}|${d.time}|${d.a}${d.b}${d.c}`;
}

function uniqueDraws(list) {
  const map = new Map();
  for (const x of list) {
    const d = normalizeDraw(x);
    if (d) map.set(d.id, d);
  }
  return [...map.values()].sort((a,b) => b.id-a.id);
}

async function readTrusted() {
  const live = JSON.parse(await fs.readFile(LIVE_FILE, 'utf8'));
  const draws = uniqueDraws(live.draws || []);
  if (!draws.length) throw new Error('top3-live.json пуст');
  return draws;
}

async function dismissOverlays(page) {
  for (const label of ['Принять','Согласен','Хорошо','Понятно','Закрыть','Продолжить']) {
    try {
      const b = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
      if (await b.isVisible({ timeout: 350 })) await b.click({ timeout: 800 });
    } catch {}
  }
}

async function collectFromDom(page) {
  const candidates = await page.locator('a[href*="/top3/archive/"]').evaluateAll(nodes => {
    const out = [];
    for (const a of nodes) {
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/top3\/archive\/(\d{6})(?:\D|$)/);
      if (!m) continue;

      let el = a;
      for (let depth = 0; depth < 7 && el; depth++, el = el.parentElement) {
        const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (text.length < 20 || text.length > 500) continue;
        out.push({ id: Number(m[1]), depth, text });
      }
    }
    return out;
  });

  const byId = new Map();
  for (const c of candidates) {
    const parsed = parseStrictRowText(c.text, c.id);
    if (!parsed) continue;
    const prev = byId.get(parsed.id);
    // Берём наиболее близкий к ссылке валидный контейнер.
    if (!prev || c.depth < prev.depth) byId.set(parsed.id, { ...parsed, depth: c.depth });
  }

  return [...byId.values()]
    .map(({depth, ...d}) => d)
    .sort((a,b) => b.id-a.id);
}

function collectJsonCandidates(value, out = [], depth = 0) {
  if (depth > 12 || value == null) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonCandidates(item, out, depth + 1);
    return out;
  }
  if (typeof value !== 'object') return out;

  const idKeys = ['drawNumber','draw_number','drawId','draw_id','draw','number','id'];
  const dateKeys = ['drawDate','draw_date','date','drawTime','draw_time','time','timestamp'];
  const numberKeys = ['winningNumbers','winning_numbers','numbers','balls','combination','result','winningCombination'];

  let id = null;
  for (const k of idKeys) {
    if (Object.hasOwn(value, k)) {
      const n = Number(String(value[k]).replace(/\D/g,''));
      if (Number.isInteger(n) && n >= 100000 && n <= 999999) { id = n; break; }
    }
  }

  if (id) {
    let date = '', time = '';
    for (const k of dateKeys) {
      if (!Object.hasOwn(value, k)) continue;
      const s = String(value[k]);
      date ||= normalizeDate(s);
      time ||= normalizeTime(s);
    }

    let digits = null;
    for (const k of numberKeys) {
      if (!Object.hasOwn(value, k)) continue;
      const v = value[k];

      if (Array.isArray(v)) {
        const nums = v.map(x => {
          if (typeof x === 'object' && x) {
            for (const kk of ['value','number','num','ball']) {
              if (Object.hasOwn(x, kk)) return Number(x[kk]);
            }
          }
          return Number(x);
        }).filter(n => Number.isInteger(n) && n >= 0 && n <= 9);
        if (nums.length === 3) { digits = nums; break; }
      }

      if (typeof v === 'string') {
        const nums = extractSingleDigits(v);
        if (nums.length === 3) { digits = nums; break; }
      }
    }

    const d = digits && normalizeDraw({ id, date, time, a: digits[0], b: digits[1], c: digits[2] });
    if (d) out.push(d);
  }

  for (const child of Object.values(value)) collectJsonCandidates(child, out, depth + 1);
  return out;
}

async function collectOnePass(browser, passNo, trusted) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    viewport: { width: 1440, height: 1200 }
  });

  const page = await context.newPage();
  const jsonDraws = [];

  page.on('response', async response => {
    try {
      const ct = (response.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('json')) return;
      if (!response.url().includes('stoloto.ru')) return;
      const body = await response.json();
      jsonDraws.push(...collectJsonCandidates(body));
    } catch {}
  });

  try {
    await page.goto(`${ARCHIVE_URL}?parser_test=${Date.now()}_${passNo}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await dismissOverlays(page);

    // Ждём сетевые ответы и отрисовку архива.
    await page.waitForTimeout(8000);

    for (let i = 0; i < 3; i++) {
      await page.mouse.wheel(0, 1000);
      await page.waitForTimeout(900);
    }

    const domDraws = await collectFromDom(page);
    const networkDraws = uniqueDraws(jsonDraws);

    const merged = uniqueDraws([...networkDraws, ...domDraws]);
    const trustedById = new Map(trusted.map(d => [d.id, d]));
    const latestKnown = trusted[0].id;

    const anchor = trustedById.get(latestKnown);
    const observedAnchor = merged.find(d => d.id === latestKnown);
    const anchorOk = !!observedAnchor && drawKey(observedAnchor) === drawKey(anchor);

    if (!anchorOk) {
      throw new Error(
        `контрольный тираж №${latestKnown} не подтверждён. ` +
        `Ожидалось ${drawKey(anchor)}, получено ${observedAnchor ? drawKey(observedAnchor) : 'нет строки'}`
      );
    }

    const candidates = merged.filter(d => d.id >= latestKnown - 2);
    const newer = candidates.filter(d => d.id > latestKnown).sort((a,b) => a.id-b.id);

    // Никаких прыжков по номерам.
    for (let i = 0; i < newer.length; i++) {
      const expectedId = latestKnown + 1 + i;
      if (newer[i].id !== expectedId) {
        throw new Error(`разрыв нумерации: ожидался №${expectedId}, получен №${newer[i].id}`);
      }
    }

    // Дата/время каждого следующего тиража должны строго увеличиваться.
    let prev = anchor;
    for (const d of newer) {
      if (parseMoscowStamp(d.date, d.time) <= parseMoscowStamp(prev.date, prev.time)) {
        throw new Error(`неверная хронология: ${drawKey(prev)} -> ${drawKey(d)}`);
      }
      prev = d;
    }

    // Защита от прошлой ошибки: невозможные или одинаковые дата/время не пройдут.
    const stamps = new Set(newer.map(d => `${d.date}|${d.time}`));
    if (stamps.size !== newer.length) {
      throw new Error('у разных новых тиражей повторяется одна и та же дата/время');
    }

    if (newer.length > 10) throw new Error(`подозрительно много новых тиражей за один проход: ${newer.length}`);

    return {
      pass: passNo,
      ok: true,
      archiveUrl: ARCHIVE_URL,
      networkRows: networkDraws.length,
      domRows: domDraws.length,
      anchor: observedAnchor,
      newer,
      sample: candidates.slice(0, 8)
    };
  } finally {
    await context.close();
  }
}

function sameNewer(a, b) {
  return JSON.stringify(a.newer) === JSON.stringify(b.newer);
}

async function main() {
  const trusted = await readTrusted();
  const latestKnown = trusted[0].id;
  const browser = await chromium.launch({ headless: true });

  const report = {
    testedAt: new Date().toISOString(),
    source: 'https://www.stoloto.ru/top3/archive',
    mode: 'TEST ONLY — top3-live.json НЕ изменяется',
    latestTrusted: trusted[0],
    passes: [],
    consensus: false,
    status: 'FAIL'
  };

  try {
    for (let pass = 1; pass <= 3; pass++) {
      try {
        const result = await collectOnePass(browser, pass, trusted);
        report.passes.push(result);
        console.log(`PASS ${pass}: OK`, JSON.stringify(result.newer));
      } catch (error) {
        report.passes.push({ pass, ok: false, error: error.message });
        console.error(`PASS ${pass}: FAIL: ${error.message}`);
      }
    }

    report.consensus =
      report.passes.length === 3 &&
      report.passes.every(p => p.ok) &&
      sameNewer(report.passes[0], report.passes[1]) &&
      sameNewer(report.passes[1], report.passes[2]);

    if (report.consensus) {
      report.status = 'PASS';
      report.detectedNewDraws = report.passes[0].newer;
    } else {
      report.status = 'FAIL';
      report.reason = 'Три независимых прохода не дали одинаковый подтверждённый результат';
    }
  } finally {
    await browser.close();
    await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(async error => {
  const fallback = {
    testedAt: new Date().toISOString(),
    source: ARCHIVE_URL,
    mode: 'TEST ONLY — top3-live.json НЕ изменяется',
    status: 'FAIL',
    fatalError: error.message
  };
  await fs.writeFile(REPORT_FILE, JSON.stringify(fallback, null, 2) + '\n', 'utf8');
  console.error(error);
});
