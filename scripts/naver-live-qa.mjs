import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This uses an empty browser profile, the built extension and live public Naver.
// It never reads the user's browser profile, pairing token or API key.
const folder = new URL('../docs/screenshots/', import.meta.url);
await mkdir(folder, { recursive: true });
const extensionPath = path.resolve('apps/extension/dist');
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true, viewport: { width: 1440, height: 1100 }, locale: 'ko-KR',
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('https://search.naver.com/search.naver?query=%EB%94%A5%EB%9F%AC%EB%8B%9D', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator('[data-cutling-owned="panel"]')).toBeVisible({ timeout: 20000 });
  const adCards = page.locator('#power_link_body .lst_type > li.lst');
  const ads = await adCards.count();
  if (!ads) throw new Error('This live response contains no Powerlink cards; ad behavior cannot be verified.');
  // Filtering intentionally scans visible results. Bring later ad cards into
  // view before requiring them to have been processed as well.
  for (let index = 0; index < ads; index++) {
    await adCards.nth(index).scrollIntoViewIfNeeded();
    await expect(adCards.nth(index).locator('[data-cutling-collapsed="true"]')).toHaveCount(1, { timeout: 15000 });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: fileURLToPath(new URL('naver-live-desktop.png', folder)), fullPage: false });
  const organic = page.locator('.fds-web-doc-root').first();
  let organicVisible = false;
  if (await organic.count()) {
    await organic.scrollIntoViewIfNeeded();
    await expect(organic.locator('[data-cutling-owned="result"]')).toHaveCount(1, { timeout: 15000 });
    organicVisible = await organic.locator('[data-cutling-owned="result"]').getAttribute('data-cutling-collapsed') === 'false';
    await page.screenshot({ path: fileURLToPath(new URL('naver-live-results.png', folder)), fullPage: false });
  }
  const summary = {
    checkedAt: new Date().toISOString(), extensionVersion: version, query: '딥러닝', paired: false,
    powerlinkCards: ads, collapsedPowerlinkCards: await page.locator('#power_link_body [data-cutling-collapsed="true"]').count(),
    decoratedResults: await page.locator('[data-cutling-owned="result"]').count(),
    collapsedResults: await page.locator('[data-cutling-collapsed="true"]').count(),
    firstOrganicKept: organicVisible,
    pageErrors: errors,
  };
  await writeFile(new URL('naver-live-checks.json', folder), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await context.close(); }
