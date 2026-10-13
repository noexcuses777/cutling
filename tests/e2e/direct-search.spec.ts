import { test, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('unpaired direct Naver search collapses ads and unrelated posts, restores and handles new results', async ({}, testInfo) => {
  const fixture = await readFile('tests/e2e/fixtures/direct-naver.html', 'utf8');
  const extensionPath = path.resolve('apps/extension/dist');
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1400 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const backendRequests: string[] = [];
  context.on('request', request => {
    if (/^http:\/\/(localhost|127\.0\.0\.1):3000\/api\//.test(request.url())) backendRequests.push(request.url());
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get('token')).token)).toBeUndefined();
    await context.route('https://search.naver.com/**', route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('https://search.naver.com/search.naver?query=%EB%94%A5%EB%9F%AC%EB%8B%9D');

    const ad = page.locator('#powerlink');
    const unrelated = page.locator('#unrelated');
    const learning = page.locator('#learning');
    await expect(page.locator('[data-cutling-owned="result"]')).toHaveCount(3);
    await expect(ad.locator('[data-cutling-owned="result"]')).toHaveAttribute('data-cutling-collapsed', 'true');
    await expect(unrelated.locator('[data-cutling-owned="result"]')).toHaveAttribute('data-cutling-collapsed', 'true');
    await expect(learning.locator('[data-cutling-owned="result"]')).not.toHaveAttribute('data-cutling-collapsed', 'true');
    await expect(ad.locator('.lnk_head')).toHaveCSS('filter', /blur/);
    await expect(learning.locator('a')).toHaveCSS('filter', 'none');
    expect((await ad.boundingBox())!.height).toBeLessThan(180);
    const collapsedHeight = (await ad.boundingBox())!.height;
    const sourceUrl = await ad.locator('.lnk_head').getAttribute('href');
    await ad.getByRole('button', { name: '다시 보기', exact: true }).click();
    await expect(ad.locator('[data-cutling-owned="result"]')).not.toHaveAttribute('data-cutling-collapsed', 'true');
    expect((await ad.boundingBox())!.height).toBeGreaterThan(collapsedHeight);
    expect(await ad.locator('.lnk_head').getAttribute('href')).toBe(sourceUrl);
    await expect(ad.locator('.lnk_head')).toHaveCSS('filter', 'none');
    await ad.getByRole('button', { name: '다시 접기', exact: true }).click();
    await expect(ad.locator('[data-cutling-owned="result"]')).toHaveAttribute('data-cutling-collapsed', 'true');

    const panel = page.locator('[data-cutling-owned="panel"]');
    if (!await panel.getByLabel('필터 켜기', { exact: true }).isVisible()) {
      await panel.getByRole('button', { expanded: false }).click();
    }
    await panel.getByLabel('필터 켜기', { exact: true }).uncheck();
    await expect(page.locator('[data-cutling-owned="result"]')).toHaveCount(0);
    await expect(page.locator('[data-cutling-collapsed="true"]')).toHaveCount(0);
    await expect(unrelated.locator('.source-content')).toHaveCSS('filter', 'none');
    expect((await unrelated.boundingBox())!.height).toBeGreaterThan(220);
    expect(await ad.locator('.lnk_head').getAttribute('href')).toBe(sourceUrl);
    expect(await ad.locator('.inner').evaluate(el => (el as HTMLElement).style.getPropertyPriority('display'))).toBe('important');
    await expect(ad.locator('.inner')).toHaveCSS('display', 'block');

    await panel.getByLabel('필터 켜기', { exact: true }).check();
    await expect(ad.locator('[data-cutling-owned="result"]')).toHaveAttribute('data-cutling-collapsed', 'true');
    await expect(unrelated.locator('[data-cutling-owned="result"]')).toHaveAttribute('data-cutling-collapsed', 'true');
    await expect(page.locator('[data-cutling-owned="result"]')).toHaveCount(3);

    await page.evaluate(() => {
      document.querySelector('main')!.insertAdjacentHTML('beforeend', '<div class="fds-web-doc-root" id="dynamic"><div class="source-content"><a href="https://blog.naver.com/example/busan"><span class="sds-comps-text-type-headline1">부산 바다 여행과 해운대 맛집</span></a><div class="sds-comps-text-ellipsis-3"><span class="sds-comps-text-content">부산 여행에서 바다 전망 카페와 해운대 맛집을 방문한 주말 여행기입니다.</span></div></div></div>');
    });
    await page.locator('#dynamic').scrollIntoViewIfNeeded();
    await expect(page.locator('#dynamic [data-cutling-owned="result"]')).toHaveAttribute('data-cutling-collapsed', 'true');
    await expect(page.locator('#dynamic [data-cutling-owned="result"]')).toHaveCount(1);
    await expect(page.locator('[data-cutling-owned="result"]')).toHaveCount(4);
    expect(backendRequests).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('direct-search.png'), fullPage: true });
    await testInfo.attach('unpaired-direct-search', { path: testInfo.outputPath('direct-search.png'), contentType: 'image/png' });
  } finally { await context.close(); }
});
