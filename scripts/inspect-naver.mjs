import { chromium } from '@playwright/test';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
try {
  await page.goto('https://search.naver.com/search.naver?query=%EB%94%A5%EB%9F%AC%EB%8B%9D', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);
  console.log(JSON.stringify(await page.evaluate(() => {
    const shape = element => {
      const chain = [];
      for (let current = element, i = 0; current && i < 7; current = current.parentElement, i++) {
        chain.push({ tag: current.tagName, id: current.id, classes: current.className, attrs: [...current.attributes].filter(a => /^(data-|aria-|role)/.test(a.name)).map(a => [a.name, a.value]), text: current.textContent?.trim().slice(0, 200) });
      }
      return chain;
    };
    const adLabels = [...document.querySelectorAll('span,strong,h2,a,div')].filter(el => /^(광고|파워링크|AD)$/.test(el.textContent?.trim() || '') && el.children.length < 2).slice(0, 14);
    const links = [...document.querySelectorAll('a')].filter(el => el.getAttribute('href')?.startsWith('http') && /딥러닝/.test(el.textContent || '') && el.textContent.trim().length > 8).slice(0, 10);
    return { title: document.title, ads: adLabels.map(shape), links: links.map(shape) };
  }), null, 2));
} finally { await browser.close(); }
