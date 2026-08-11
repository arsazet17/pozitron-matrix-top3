import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const EMAIL = process.env.STOLOTO_EMAIL || '';
const PASSWORD = process.env.STOLOTO_PASSWORD || '';

const LOGIN_URL = 'https://oauth.stoloto.ru/login';
const ARCHIVE_URL = 'https://m.stoloto.ru/top3/archive';
const REPORT = new URL('./stoloto-oauth-test-report.json', import.meta.url);

function clean(s) {
  return String(s ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
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

  await page.goto(LOGIN_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await page.waitForTimeout(1200);

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

  if (!email || !password) {
    const title = await page.title().catch(() => '');
    throw new Error(`OAuth-форма открылась, но поля логин/пароль не найдены; title=${title}; url=${page.url()}`);
  }

  await email.fill(EMAIL);
  await password.fill(PASSWORD);

  const submit = await firstVisible([
    page.getByRole('button', { name: /^войти$/i }).first(),
    page.locator('button').filter({ hasText: /^Войти$/i }).first(),
    page.locator('button[type="submit"]').first(),
    page.locator('input[type="submit"]').first()
  ]);

  if (!submit) throw new Error('на OAuth-форме не найдена кнопка "Войти"');

  if (!(await submit.isEnabled().catch(() => false))) {
    throw new Error('кнопка "Войти" неактивна');
  }

  await submit.click({ timeout: 5000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const body = clean(await page.locator('body').innerText().catch(() => ''));

  if (/неверн.*(парол|логин|почт)|ошибк.*вход|пользователь.*не найден/i.test(body)) {
    throw new Error('Столото отклонил логин или пароль');
  }

  // Если остались на oauth login и форма всё ещё видна — вход не прошёл.
  const stillPassword = await page.locator('input[type="password"]').first()
    .isVisible({ timeout: 400 }).catch(() => false);

  if (page.url().includes('oauth.stoloto.ru/login') && stillPassword) {
    throw new Error('после отправки OAuth-формы вход не подтверждён');
  }

  return {
    afterLoginUrl: page.url()
  };
}

async function verifyArchive(page) {
  await page.goto(ARCHIVE_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await page.waitForTimeout(2500);

  const body = clean(await page.locator('body').innerText().catch(() => ''));

  if (!/архив тиражей/i.test(body)) {
    throw new Error('не открылся блок "Архив тиражей"');
  }

  const ids = [...body.matchAll(/№\s*(\d{6})/g)].map(m => Number(m[1]));
  if (!ids.length) {
    throw new Error('архив открылся, но строки тиражей не загрузились');
  }

  return {
    archiveUrl: page.url(),
    firstVisibleDraw: ids[0],
    visibleDraws: ids.slice(0, 5),
    hasDownloadArchive: /скачать архив/i.test(body)
  };
}

async function onePass(browser, pass) {
  const context = await browser.newContext({
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 412, height: 915 },
    userAgent: 'Mozilla/5.0 (Linux; Android 10; VOG-L29) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36'
  });

  const page = await context.newPage();

  try {
    const auth = await login(page);
    const archive = await verifyArchive(page);
    return { pass, ok: true, ...auth, ...archive };
  } finally {
    await context.close();
  }
}

async function main() {
  const report = {
    testedAt: new Date().toISOString(),
    source: {
      login: LOGIN_URL,
      archive: ARCHIVE_URL
    },
    mode: 'TEST ONLY — direct Stoloto OAuth 3x; top3-live.json НЕ изменяется',
    passes: [],
    consensus: false,
    status: 'FAIL'
  };

  const browser = await chromium.launch({ headless: true });

  try {
    for (let pass = 1; pass <= 3; pass++) {
      try {
        const r = await onePass(browser, pass);
        report.passes.push(r);
        console.log(`PASS ${pass}: OK first=${r.firstVisibleDraw}`);
      } catch (e) {
        report.passes.push({ pass, ok: false, error: e.message });
        console.error(`PASS ${pass}: FAIL ${e.message}`);
      }
    }

    if (report.passes.every(x => x.ok)) {
      const snapshots = report.passes.map(x =>
        JSON.stringify({
          firstVisibleDraw: x.firstVisibleDraw,
          visibleDraws: x.visibleDraws
        })
      );

      report.consensus = snapshots.every(x => x === snapshots[0]);
      report.status = report.consensus ? 'PASS' : 'FAIL';

      if (!report.consensus) {
        report.reason = 'три прохода увидели разные наборы верхних тиражей';
      }
    } else {
      report.reason = 'не все три прохода смогли войти через OAuth и открыть архив';
    }
  } finally {
    await browser.close();
    await fs.writeFile(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log(JSON.stringify(report, null, 2));
  }

  if (report.status !== 'PASS') process.exit(1);
}

main().catch(async e => {
  try {
    await fs.writeFile(REPORT, JSON.stringify({
      testedAt: new Date().toISOString(),
      status: 'FAIL',
      fatalError: e.message
    }, null, 2) + '\n', 'utf8');
  } catch {}
  console.error(e);
  process.exit(1);
});
