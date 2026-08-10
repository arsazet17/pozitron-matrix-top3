import fs from 'node:fs/promises';

import {
  parseStolotoJson,
  parseStolotoText,
  validateAgainstTrusted,
  uniqueDraws,
  ensureServerForecast
} from './update-top3.mjs';

const LIVE_FILE = new URL('./top3-live.json', import.meta.url);
const SEED_FILE = new URL('./top3-data.js', import.meta.url);

const STOLOTO_ARCHIVE_URL = 'https://www.stoloto.ru/top3/archive';
const STOLOTO_API_URLS = [
  'https://www.stoloto.ru/p/api/mobile/api/v36/service/draws/archive?count=100&game=top3&page=1',
  'https://www.stoloto.ru/p/api/mobile/api/v35/service/draws/archive?count=100&game=top3&page=1',
  'https://www.stoloto.ru/p/api/mobile/api/v34/service/draws/archive?count=100&game=top3&page=1'
];

const REGULAR_DRAW_TIMES = [
  '02:40','04:40','06:40','07:40','09:40',
  '11:40','13:40','16:25','21:25','22:40'
];

async function fetchText(url, headers = {}, timeoutMs = 40_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Pozitron-TOP3-Stoloto/2.0',
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...headers
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText || ''}`.trim());
    return await response.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Столото не ответил за ${Math.round(timeoutMs / 1000)} секунд`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSeed() {
  const text = (await fs.readFile(SEED_FILE, 'utf8')).trim();
  const json = text
    .replace(/^\s*window\.TOP3_SEED\s*=\s*/, '')
    .replace(/;\s*$/, '');
  const rows = JSON.parse(json);
  return uniqueDraws(rows.map(row => ({
    id: row[0],
    date: row[1],
    time: row[2],
    a: row[3],
    b: row[4],
    c: row[5]
  })));
}

async function readExisting() {
  try {
    const payload = JSON.parse(await fs.readFile(LIVE_FILE, 'utf8'));
    const draws = uniqueDraws(Array.isArray(payload) ? payload : (payload.draws || []));
    return {
      schema: Number(payload?.schema) || 3,
      source: String(payload?.source || ''),
      updatedAt: payload?.updatedAt || null,
      latest: Number(payload?.latest) || draws[0]?.id || 0,
      forecasts: Array.isArray(payload?.forecasts) ? payload.forecasts : [],
      draws
    };
  } catch {
    return {
      schema: 3,
      source: '',
      updatedAt: null,
      latest: 0,
      forecasts: [],
      draws: []
    };
  }
}

async function fetchOfficialApi(reference) {
  const stamp = Date.now();

  const attempts = await Promise.allSettled(
    STOLOTO_API_URLS.map(async baseUrl => {
      const text = await fetchText(`${baseUrl}&_=${stamp}`, {
        'Accept': 'application/json,text/plain,*/*',
        'Referer': `${STOLOTO_ARCHIVE_URL}/`
      });

      const parsed = parseStolotoJson(text);
      const draws = validateAgainstTrusted(parsed, reference);

      return {
        draws,
        source: `Столото API v${baseUrl.match(/\/v(\d+)\//)?.[1] || '?'}`
      };
    })
  );

  const ok = attempts
    .filter(item => item.status === 'fulfilled')
    .map(item => item.value)
    .sort((a, b) => (b.draws[0]?.id || 0) - (a.draws[0]?.id || 0));

  if (ok.length) return ok[0];

  const errors = attempts
    .filter(item => item.status === 'rejected')
    .map(item => item.reason?.message || String(item.reason));

  throw new Error(`Столото API: ${errors.join(' | ')}`);
}

async function fetchOfficialArchive(reference) {
  const text = await fetchText(`${STOLOTO_ARCHIVE_URL}?_=${Date.now()}`, {
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Referer': 'https://www.stoloto.ru/'
  });

  const draws = validateAgainstTrusted(parseStolotoText(text), reference);
  return {
    draws,
    source: 'Столото — официальный архив'
  };
}

async function fetchOfficialPages(reference) {
  const trusted = uniqueDraws(reference);
  const latestKnown = trusted[0]?.id || 0;
  if (!latestKnown) throw new Error('нет последнего известного тиража');

  const found = new Map();
  const errors = [];
  let misses = 0;

  // Контроль: 3 уже известных тиража + запас до 20 следующих.
  // Это позволяет догнать приложение, даже если обновления не работали несколько часов.
  for (let id = Math.max(100000, latestKnown - 2); id <= latestKnown + 20; id += 1) {
    try {
      const text = await fetchText(
        `${STOLOTO_ARCHIVE_URL}/${id}?_=${Date.now()}`,
        {
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Referer': `${STOLOTO_ARCHIVE_URL}/`
        },
        25_000
      );

      const draw = parseStolotoText(text, id).find(item => item.id === id);
      if (draw) {
        found.set(draw.id, draw);
        misses = 0;
      } else if (id > latestKnown) {
        misses += 1;
      }
    } catch (error) {
      errors.push(`№${id}: ${error?.message || error}`);
      if (id > latestKnown) misses += 1;
    }

    // Три подряд отсутствующих будущих номера означают, что мы уже вышли вперёд.
    if (id > latestKnown && misses >= 3) break;
  }

  try {
    const draws = validateAgainstTrusted([...found.values()], reference);
    return {
      draws,
      source: 'Столото — официальные страницы тиражей'
    };
  } catch (error) {
    throw new Error(
      `Столото страницы: ${error.message}` +
      (errors.length ? ` | ${errors.slice(0, 5).join(' | ')}` : '')
    );
  }
}

async function fetchLatestOfficial(reference) {
  const attempts = await Promise.allSettled([
    fetchOfficialApi(reference),
    fetchOfficialArchive(reference),
    fetchOfficialPages(reference)
  ]);

  const labels = ['API', 'АРХИВ', 'СТРАНИЦЫ'];
  const successes = [];
  const errors = [];

  attempts.forEach((item, index) => {
    if (item.status === 'fulfilled') {
      successes.push(item.value);
      console.log(
        `Столото ${labels[index]}: последний №${item.value.draws[0]?.id}; строк ${item.value.draws.length}`
      );
    } else {
      const message = item.reason?.message || String(item.reason);
      errors.push(`${labels[index]}: ${message}`);
      console.warn(`Столото ${labels[index]} недоступен: ${message}`);
    }
  });

  if (!successes.length) {
    throw new Error(`Не удалось получить TOP-3 со Столото. ${errors.join(' || ')}`);
  }

  successes.sort((a, b) => {
    const latestDiff = (b.draws[0]?.id || 0) - (a.draws[0]?.id || 0);
    return latestDiff || b.draws.length - a.draws.length;
  });

  return successes[0];
}

function sameDraws(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  const seed = await readSeed();
  const existing = await readExisting();

  // Контрольная база — встроенный архив + уже сохранённый live.
  const reference = uniqueDraws([...existing.draws, ...seed]);

  // ВАЖНО: здесь НЕТ Lucky Numbers.
  // Единственные источники — официальные API/архив/страницы Столото.
  const result = await fetchLatestOfficial(reference);

  const history = uniqueDraws([
    ...seed,
    ...existing.draws,
    ...result.draws
  ]);

  const draws = history.slice(0, 150);
  if (draws.length < 3) {
    throw new Error('после объединения осталось меньше трёх тиражей');
  }

  // Сохраняем существующий алгоритм серверного прогноза из update-top3.mjs.
  const forecasts = ensureServerForecast(existing.forecasts, history);

  const oldForecasts = Array.isArray(existing.forecasts) ? existing.forecasts : [];
  const drawsChanged = !sameDraws(draws, existing.draws);
  const forecastsChanged = JSON.stringify(forecasts) !== JSON.stringify(oldForecasts);

  if (!drawsChanged && !forecastsChanged) {
    console.log(
      `Новых тиражей на Столото нет. Последний сохранённый №${draws[0].id}.`
    );
    return;
  }

  const payload = {
    schema: 3,
    source: result.source,
    updatedAt: new Date().toISOString(),
    latest: draws[0].id,
    regularTimes: REGULAR_DRAW_TIMES,
    forecasts,
    draws
  };

  await fs.writeFile(
    LIVE_FILE,
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8'
  );

  console.log(
    `TOP-3 обновлён только со Столото. Последний №${draws[0].id}; ` +
    `строк ${draws.length}; источник: ${result.source}.`
  );
}

main().catch(error => {
  console.error('STOLOTO-ONLY UPDATER ERROR:', error);
  process.exit(1);
});
