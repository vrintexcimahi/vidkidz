const { test, expect } = require('@playwright/test');
test.use({ serviceWorkers: 'allow' });

test('installed worker opens the application shell after an offline reload', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('.portal-form-heading')).toBeVisible({ timeout: 60000 });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  });
  const cachedScripts = await page.evaluate(async () => {
    const key = (await caches.keys()).find(k => k.startsWith('vidkidz-static-'));
    return (await (await caches.open(key)).keys()).map(r => r.url);
  });
  expect(cachedScripts.some(url => url.includes('react.production.min.js'))).toBe(true);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('.portal-form-heading')).toBeVisible({ timeout: 60000 });
  await expect(page.getByRole('button', { name: /Anak \(Kids\)/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await context.setOffline(false);
});

test('a replacement worker waits while an open form keeps its draft', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.portal-form-heading')).toBeVisible({ timeout: 60000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.getByRole('button', { name: /Orang Tua Kelola/ }).click();
  await page.getByRole('button', { name: 'Email', exact: true }).click();
  await page.getByLabel('Email akun', { exact: true }).fill('draft@example.test');
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js?update-test=1');
    if (registration.waiting) return;
    const worker = registration.installing;
    if (!worker) throw new Error('Expected replacement worker');
    await new Promise((resolve, reject) => worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') resolve();
      if (worker.state === 'redundant') reject(new Error('Replacement install failed'));
    }));
  });
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state)).toBe('installed');
  await expect(page.getByLabel('Email akun', { exact: true })).toHaveValue('draft@example.test');
});
