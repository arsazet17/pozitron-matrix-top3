import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const ARCHIVE_URL = 'https://www.stoloto.ru/top3/archive';
const REPORT = new globalThis.URL('./stoloto-download-test-report.json', import.meta.url);

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function printablePreview(buf) {
  const utf8 = buf.toString('utf8', 0, Math.min(buf.length, 8000));
  const cleaned = utf8.replace(/\u0000/g, '').replace(/\r/g, '');
  return cleaned.slice(0, 5000);
}

async function dismiss(page) {
  for (const label of ['Принять','Согласен','Хорошо','Понятно','Закрыть','Продолжить']) {
    try {
      const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await b.isVisible({ timeout: 300 })) await b.click({ timeout: 1000 });
    } catch {}
  }
}

async function onePass(browser, pass) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    acceptDownloads: true,
    viewport: { width: 1440, height: 1200 }
  });
  const page = await context.newPage();

  const requests = [];
  page.on('response', async r => {
    try {
      const u = r.url();
      if (!u.includes('stoloto.ru')) return;
      const h = r.headers();
      const ct = h['content-type'] || '';
      const cd = h['content-disposition'] || '';
      if (/csv|excel|spreadsheet|zip|octet-stream/i.test(ct + ' ' + cd + ' ' + u)) {
        requests.push({
          url: u,
          status: r.status(),
          contentType: ct,
          contentDisposition: cd
        });
      }
    } catch {}
  });

  try {
    await page.goto(`${ARCHIVE_URL}?download_test=${Date.now()}_${pass}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });
    await dismiss(page);
    await page.waitForTimeout(5000);

    // Открываем официальный блок "Скачать архив".
    const downloadArchiveText = page.getByText('Скачать архив', { exact: true }).first();
    if (!(await downloadArchiveText.isVisible({ timeout: 5000 }))) {
      throw new Error('не найден официальный элемент "Скачать архив"');
    }
    await downloadArchiveText.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // Если появился выбор периода, предпочитаем "За сегодня".
    for (const label of ['За сегодня', 'Сегодня']) {
      try {
        const loc = page.getByText(label, { exact: true }).last();
        if (await loc.isVisible({ timeout: 500 })) {
          await loc.click({ timeout: 1500 });
          break;
        }
      } catch {}
    }

    // Находим именно кнопку "Скачать", не заголовок "Скачать архив".
    let buttons = page.getByRole('button', { name: /^Скачать$/i });
    let count = await buttons.count();
    let trigger = null;
    for (let i = count - 1; i >= 0; i--) {
      const b = buttons.nth(i);
      try {
        if (await b.isVisible({ timeout: 300 })) { trigger = b; break; }
      } catch {}
    }

    if (!trigger) {
      // Резерв: ссылка с точным текстом "Скачать".
      const links = page.getByRole('link', { name: /^Скачать$/i });
      for (let i = (await links.count()) - 1; i >= 0; i--) {
        const a = links.nth(i);
        try {
          if (await a.isVisible({ timeout: 300 })) { trigger = a; break; }
        } catch {}
      }
    }

    if (!trigger) {
      throw new Error('после открытия блока не найдена кнопка "Скачать"');
    }

    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await trigger.click({ timeout: 5000 });
    const download = await downloadPromise;

    const filePath = await download.path();
    if (!filePath) throw new Error('браузер не дал путь к скачанному архиву');
    const buf = await fs.readFile(filePath);
    if (buf.length < 50) throw new Error(`скачанный файл подозрительно мал: ${buf.length} байт`);

    const suggested = download.suggestedFilename();
    const hash = sha256(buf);
    const preview = printablePreview(buf);

    // Ищем контрольные признаки, но не считаем их обязательными для бинарного xlsx/zip.
    const has267467 = buf.includes(Buffer.from('267467'));
    const has216Text = buf.includes(Buffer.from('216'));
    const magicHex = buf.subarray(0, 16).toString('hex');

    return {
      pass,
      ok: true,
      suggestedFilename: suggested,
      size: buf.length,
      sha256: hash,
      magicHex,
      has267467,
      has216Text,
      downloadResponses: requests,
      textPreview: preview
    };
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const report = {
    testedAt: new Date().toISOString(),
    source: ARCHIVE_URL,
    mode: 'TEST ONLY — официальный "Скачать архив"; top3-live.json НЕ изменяется',
    passes: [],
    consensus: false,
    status: 'FAIL'
  };

  try {
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await onePass(browser, i);
        report.passes.push(r);
        console.log(`PASS ${i}: OK ${r.suggestedFilename} ${r.size} bytes ${r.sha256}`);
      } catch (e) {
        report.passes.push({ pass: i, ok: false, error: e.message });
        console.error(`PASS ${i}: FAIL ${e.message}`);
      }
    }

    const ok = report.passes.every(x => x.ok);
    if (ok) {
      // Размер/имя должны быть устойчивыми; хэш может меняться, если сервер генерирует файл динамически.
      const names = new Set(report.passes.map(x => x.suggestedFilename));
      const sizes = report.passes.map(x => x.size);
      const max = Math.max(...sizes), min = Math.min(...sizes);
      const stableSize = min > 0 && max / min < 1.10;

      report.consensus = names.size === 1 && stableSize;
      report.status = report.consensus ? 'PASS' : 'FAIL';
      if (!report.consensus) {
        report.reason = `нестабильное скачивание: names=${[...names].join(', ')}, sizes=${sizes.join(', ')}`;
      }
    } else {
      report.reason = 'не все три прохода смогли скачать официальный архив';
    }
  } finally {
    await browser.close();
    await fs.writeFile(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(async e => {
  await fs.writeFile(REPORT, JSON.stringify({
    testedAt: new Date().toISOString(),
    source: ARCHIVE_URL,
    status: 'FAIL',
    fatalError: e.message
  }, null, 2) + '\n', 'utf8');
  console.error(e);
});
