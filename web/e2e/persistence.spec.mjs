// What survives a page reload of the packaged app, the webOS equivalent of a
// relaunch: the theme chosen in Settings, the imported floor plan, and the
// Keymanager3-encrypted credentials that reconnect automatically. The token is
// a fixture value; the test asserts it never lands in browser storage.
import { expect, test } from '@playwright/test';
import { FIXTURE_TOKEN, gotoApp, importPlan, openSettings, planFile, startMockHA, submitCredentials } from './helpers.mjs';

test('keeps theme, plan and encrypted credentials across reload', async ({ page }) => {
  const mock = await startMockHA();
  await gotoApp(page);
  await importPlan(page, await planFile());

  await openSettings(page);
  await page.locator('.appearance-option[data-appearance="light"]').click();
  await expect(page.locator('.appearance-option[data-appearance="light"]')).toHaveAttribute('aria-pressed', 'true');
  await submitCredentials(page, mock.url, FIXTURE_TOKEN);

  await page.reload();
  await expect(page.locator('#app h1')).toHaveText('Whole home');
  // The stored theme is applied by the pre-boot <script>, before any app module runs.
  expect(await page.evaluate(() => document.documentElement.dataset)).toMatchObject({ appearance: 'light', theme: 'day' });

  // Stored credentials reconnect without the settings form, using a fresh socket.
  await expect(page.locator('#status')).toHaveText('Home Assistant connected');
  expect(mock.connections).toBe(2);
  expect(mock.auths).toEqual([FIXTURE_TOKEN, FIXTURE_TOKEN]);

  await expect(page.locator('[data-room="living"]')).toHaveText('Living room');

  const storage = await page.evaluate(() => ({ ...localStorage }));
  const serialized = JSON.stringify(storage);
  expect(serialized).not.toContain(FIXTURE_TOKEN);
  expect(Object.keys(storage)).toContain('house-control-ha-encrypted-v1');
  await mock.close();
});