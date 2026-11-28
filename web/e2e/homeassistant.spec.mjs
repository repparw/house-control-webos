// Packaged-UI behavior with a live Home Assistant connection: the settings
// form connects to a loopback mock through the homeassistant host alias, live
// state flows into the device list, commands become HA service calls, and a
// dropped socket moves devices to stale before the client reconnects.
import { expect, test } from '@playwright/test';
import { connectHomeAssistant, FIXTURE_TOKEN, gotoApp, importPlan, planFile, startMockHA } from './helpers.mjs';

test('connects through the settings form and applies live state and commands', async ({ page }) => {
  const mock = await startMockHA();
  const errors = [];
  page.on('pageerror', error => errors.push(error));
  await gotoApp(page);
  await importPlan(page, await planFile());

  await connectHomeAssistant(page, mock.url, FIXTURE_TOKEN);
  // displayName comes from HA's friendly_name, the on/off state from the snapshot.
  const row = page.getByRole('button', { name: 'Pieza, off' });
  await expect(row).toBeEnabled();
  await expect(row).toContainText('Living room');

  await row.click();
  await expect(page.getByRole('button', { name: 'Pieza, on' })).toBeVisible();
  expect(mock.calls).toEqual([
    { domain: 'light', service: 'turn_on', service_data: { entity_id: 'light.pieza' } },
  ]);
  expect(errors).toEqual([]);
  await mock.close();
});

test('marks linked devices stale and reconnects after the socket drops', async ({ page }) => {
  const mock = await startMockHA();
  await gotoApp(page);
  await importPlan(page, await planFile());
  await connectHomeAssistant(page, mock.url, FIXTURE_TOKEN);
  const row = page.getByRole('button', { name: 'Pieza, off' });
  await expect(row).toBeEnabled();

  mock.drop();
  await expect(page.locator('#status')).toHaveText('Home Assistant disconnected. Reconnecting.');
  await expect(row).toBeDisabled();
  await expect(row).toContainText('Last known');

  // The client retries with bounded backoff; the first retry lands after one second.
  await expect(page.locator('#status')).toHaveText('Home Assistant connected');
  await expect(row).toBeEnabled();
  expect(mock.connections).toBe(2);
  expect(mock.auths).toEqual([FIXTURE_TOKEN, FIXTURE_TOKEN]);
  await mock.close();
});