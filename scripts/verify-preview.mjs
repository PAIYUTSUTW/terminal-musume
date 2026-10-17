import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const base = process.env.MUSUME_PREVIEW_URL ?? 'http://127.0.0.1:7331';
const artifacts = fileURLToPath(new URL('../artifacts/', import.meta.url));
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 1 });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#avatar').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#avatar').naturalWidth > 0);
  await page.getByRole('button', { name: '還有問題', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#state-label').textContent === '擔心');
  await page.getByRole('button', { name: '需要你決定', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#state-label').textContent === '等你回覆');
  await page.getByRole('button', { name: '修好了', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#state-label').textContent === '開心');
  await page.screenshot({ path: `${artifacts}/preview-claude.png`, fullPage: true });
  await page.getByRole('button', { name: '白髮 / Codex', exact: true }).click();
  await page.getByRole('button', { name: '開心', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#avatar').src.includes('codex/happy.gif'));
  await page.waitForFunction(() => document.querySelector('#avatar').complete);
  const frame = () => page.evaluate(() => {
    const image = document.querySelector('#avatar');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 0, opaque = 0;
    for (let index = 0; index < data.length; index++) hash = (Math.imul(hash, 31) + data[index]) >>> 0;
    for (let index = 3; index < data.length; index += 4) if (data[index]) opaque++;
    return { hash, cornerAlpha: data[3], opaque, width: canvas.width, height: canvas.height,
      pointerEvents: getComputedStyle(image).pointerEvents };
  });
  const first = await frame();
  // Canvas drawImage reads the GIF's default frame in Chromium. Capture the
  // displayed element instead to verify the browser is advancing the animation.
  const firstDisplay = createHash('sha256').update(await page.locator('#avatar').screenshot()).digest('hex');
  await page.waitForTimeout(350);
  const second = await frame();
  const secondDisplay = createHash('sha256').update(await page.locator('#avatar').screenshot()).digest('hex');
  assert.notEqual(firstDisplay, secondDisplay, 'GIF must advance to a different visible frame');
  assert.equal(first.cornerAlpha, 0, 'background around the character is transparent');
  assert.equal(first.pointerEvents, 'none', 'the character does not intercept terminal input');
  assert.ok(first.opaque > 10000 && first.opaque < first.width * first.height * .7);
  await page.screenshot({ path: `${artifacts}/preview-codex.png`, fullPage: true });
  await page.request.post(`${base}/api/demo`, { data: { provider: 'claude', state: 'waiting' } });
  await page.waitForFunction(() => document.querySelector('#state-label').textContent === '等你回覆' && document.querySelector('#cli-name').textContent === 'claude');
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({ path: `${artifacts}/preview-mobile.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(failures, []);
  const report = { checked: ['reply semantics', 'agent switch', 'GIF frame advancement', 'GIF transparency', 'input pass-through', 'live event stream', 'responsive preview'], firstFrame: first, secondFrame: second, displayedFrameHashes: [firstDisplay, secondDisplay], pageErrors: failures };
  await writeFile(`${artifacts}/preview-verification.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
