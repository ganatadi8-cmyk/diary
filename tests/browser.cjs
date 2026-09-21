// Run with `node tests/browser.cjs` against a disposable local server.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5000');
    await page.waitForFunction(() => !document.getElementById('auth-submit-btn').disabled);
    await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
    await page.getByLabel('Your name', { exact: true }).fill('Browser Alice');
    await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
    await page.locator('#auth-submit-btn').click();
    await page.locator('#user-view').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.getElementById('app-status').textContent.includes('up to date'));
    await page.getByLabel('Give this memory a title').fill('My Telugu memory');
    await page.getByLabel('Your thoughts', { exact: true }).fill('నా రోజు బాగుంది. A happy memory. <img src=x onerror=alert(1)>');
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('app-status').textContent === 'Saved to your diary.');
    assert.equal(await page.locator('.entry-card').count(), 1);
    assert.equal(await page.locator('.entry-card img').count(), 0, 'Entry HTML must render as text');
    await page.reload();
    await page.locator('.entry-card').waitFor();
    assert.match(await page.locator('.entry-card').innerText(), /నా రోజు/);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByLabel('Give this memory a title').fill('Edited memory');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.entry-card h3')?.textContent === 'Edited memory');
    await page.getByRole('searchbox').fill('no matching memory');
    assert.equal(await page.locator('.entry-card').count(), 0);
    await page.getByRole('searchbox').fill('happy');
    assert.equal(await page.locator('.entry-card').count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Mobile layout must not overflow');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export diary', exact: true }).click();
    const download = await downloading;
    const exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.equal(exported.entries.length, 1);
    assert.equal(exported.entries[0].title, 'Edited memory');
    // Failed requests must preserve writing, and must not masquerade as saved.
    await page.getByLabel('Give this memory a title').fill('Unsaved memory');
    await page.getByLabel('Your thoughts', { exact: true }).fill('Keep this text on failure');
    await page.route('**/api/entries', route => route.request().method() === 'POST' ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Storage temporarily unavailable'})}) : route.continue());
    await page.getByRole('button', { name: 'Save entry', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('app-status').textContent.includes('temporarily unavailable'));
    assert.equal(await page.getByLabel('Your thoughts', { exact: true }).inputValue(), 'Keep this text on failure');
    await page.unroute('**/api/entries');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('#auth-modal').waitFor({state:'visible'});
    await page.waitForFunction(() => !document.getElementById('auth-submit-btn').disabled);
    await page.getByRole('button', { name: 'Create account', exact: true }).first().click();
    await page.getByLabel('Your name', { exact: true }).fill('Browser Bob');
    await page.getByLabel('Password', { exact: true }).fill('browser-test-password');
    await page.locator('#auth-submit-btn').click();
    await page.locator('#user-view').waitFor({state:'visible'});
    await page.waitForFunction(() => document.getElementById('app-status').textContent.includes('up to date'));
    assert.equal(await page.locator('.entry-card').count(), 0, 'New account must not see previous account entries');
    assert.equal(await page.getByLabel('Your thoughts', { exact: true }).inputValue(), '');
    assert.deepEqual(errors, []);
    console.log('Browser flow passed: register, save, safe text rendering, reload, edit, search, mobile layout, export, failed-save retention, logout, account isolation.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
