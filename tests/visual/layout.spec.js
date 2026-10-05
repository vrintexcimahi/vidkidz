const { test, expect } = require('@playwright/test');
const kidsPages = ['home','videos','drawing','stories','games','photos','hafalan','coins','duel'];
for (const width of [320, 375, 430]) {
  test(`kids shell stays visible and navigation stays at the bottom at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 760 });
    await page.goto('/?preview_role=kids&tab=home');
    const workspace = page.locator('.kids-workspace');
    await expect(workspace).toBeVisible({ timeout: 60000 });
    const main = await workspace.boundingBox();
    const nav = await page.locator('.kids-tabbar').boundingBox();
    expect(main.height).toBeGreaterThan(600);
    expect(nav.y).toBeGreaterThan(650);
    expect(main.y + main.height).toBeLessThanOrEqual(nav.y + 1);
    expect(nav.y + nav.height).toBeLessThanOrEqual(761);
    await workspace.evaluate(el => { el.scrollTop = el.scrollHeight; });
    expect((await page.locator('.kids-tabbar').boundingBox()).y).toBe(nav.y);
    await page.screenshot({ path: `test-results/kids-${width}.png` });
  });
}
for (const tab of kidsPages) {
  test(`kids ${tab} renders usable content without overflow or broken icons`, async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`/?preview_role=kids&tab=${tab}`);
    await expect(page.locator('.kids-workspace')).toBeVisible({ timeout: 60000 });
    await page.locator('.kids-workspace img').evaluateAll(images => Promise.all(images.map(i => i.decode().catch(() => {}))));
    const layout = await page.locator('.kids-workspace').evaluate(el => ({
      width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight,
      broken: [...el.querySelectorAll('img')].filter(i => !i.naturalWidth).map(i => i.getAttribute('src')),
      text: el.innerText.trim(),
    }));
    expect(layout.height).toBeGreaterThan(600);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.broken).toEqual([]);
    expect(layout.text.length).toBeGreaterThan(40);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/kids-${tab}.png` });
  });
}
for (const role of ['admin','family']) {
  test(`${role} dashboard has readable labels and semantic 3D icons`, async ({ page }) => {
    await page.goto(`/?preview_role=${role}&tab=overview`);
    await expect(page.locator('.sidebar > button.nav-item').first()).toBeVisible({ timeout: 60000 });
    await expect(page.locator('.sidebar > button.nav-item .nav-label-popup').first()).toBeVisible();
    await expect(page.getByText('profile', { exact: true })).toHaveCount(0);
    await expect(page.getByText('crown', { exact: true })).toHaveCount(0);
    const icons = await page.locator('.sidebar > button.nav-item img').evaluateAll(images => images.map(i => i.getAttribute('src')));
    expect(icons.every(src => src.startsWith('/assets/icons/pixar/'))).toBe(true);
    await page.screenshot({ path: `test-results/${role}.png` });
  });
}
test('three-phone workbench keeps kids content visible inside its real iframe', async ({ page }) => {
  await page.setViewportSize({ width: 1780, height: 980 });
  await page.goto('/?preview_role=admin&tab=devmode');
  const kids = page.frameLocator('iframe[src*="preview_role=kids"]');
  await expect(kids.locator('.kids-workspace')).toBeVisible({ timeout: 60000 });
  expect((await kids.locator('.kids-workspace').boundingBox()).height).toBeGreaterThan(350);
  await expect(kids.locator('.kids-tabbar')).toBeVisible();
  await page.screenshot({ path: 'test-results/workbench.png' });
});
test('kids activities remain reachable through the additional menu', async ({ page }) => {
  await page.goto('/?preview_role=kids&tab=home');
  await page.getByRole('button', { name: 'Lainnya', exact: true }).click();
  await expect(page.locator('.kids-menu')).toBeVisible();
  await page.locator('.kids-menu-grid button').filter({ hasText: 'Game' }).click();
  await expect(page.locator('.kids-menu')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Game Edukatif Seru!' })).toBeVisible();
});
