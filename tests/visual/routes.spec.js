const { test, expect } = require('@playwright/test');
const routes = {
  admin: ['families','userdata','monitoring','backup','settings'],
  family: ['kids','duel','art','bedtime','coins','videos','photos','control','monitor','certificate','ai','telegram'],
};
for (const [role, tabs] of Object.entries(routes)) for (const tab of tabs) {
  test(`${role}/${tab}: visible page, no rendering exception`, async ({ page }) => {
    const errors=[];page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`/?preview_role=${role}&tab=${tab}`);
    const content=page.locator(role==='admin'?'.admin-main':'.family-main');
    await expect(content).toBeVisible({ timeout:60000 });
    await expect(page.locator('.sidebar > .nav-item[aria-current="page"]')).toHaveCount(1);
    const dims=await content.evaluate(el=>({width:el.clientWidth,scrollWidth:el.scrollWidth,text:el.innerText.trim()}));
    expect(dims.text.length).toBeGreaterThan(20);
    expect(dims.scrollWidth, `${role}/${tab} horizontal content overflow`).toBeLessThanOrEqual(dims.width+1);
    expect(errors).toEqual([]);
    await page.screenshot({path:`test-results/${role}-${tab}.png`});
  });
}
