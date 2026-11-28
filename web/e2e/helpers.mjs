// Shared fixtures and UI flows for the packaged-UI E2E specs. Every flow
// drives the app like the remote does, through buttons the user can see.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { MockHomeAssistant } from './mock-ha.mjs';
import { keymanagerBridge } from './webos-bridge.mjs';

// Matches the app's token rule (^[A-Za-z0-9._-]{20,2048}$); a fixture value, never a real token.
export const FIXTURE_TOKEN = 'e2e-fixture-token-' + 'A'.repeat(24);

export const plan = {
  version: 1,
  name: 'E2E mock home',
  levels: [{ id: 'ground', name: 'Ground' }],
  rooms: [{ id: 'living', name: 'Living room', level: 'ground', rect: [0, 0, 5, 5], floor: 'walnut' }],
  lights: [
    {
      id: 'living-light', name: 'Living lamp', room: 'living', type: 'ceiling', pos: [2.5, 2.5],
      link: { service: 'homeassistant', id: 'light.pieza' },
    },
    { id: 'spare-light', name: 'Spare lamp', room: 'living', type: 'ceiling', pos: [3.5, 2.5] },
  ],
};

export async function planFile() {
  const path = join(await mkdtemp(join(tmpdir(), 'webos-e2e-')), 'e2e-home.json');
  await writeFile(path, JSON.stringify(plan));
  return path;
}

/** Loads the app with the Keymanager3 bridge installed before every document. */
export async function gotoApp(page) {
  await page.addInitScript(keymanagerBridge);
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('Demo · no real devices');
}

/** One live entity, light.pieza, off at the snapshot like a real lamp. */
export async function startMockHA() {
  const mock = new MockHomeAssistant({
    token: FIXTURE_TOKEN,
    entities: [{
      entity_id: 'light.pieza', state: 'off',
      attributes: { friendly_name: 'Pieza', supported_color_modes: ['rgb'] },
      last_updated: new Date().toISOString(),
    }],
  });
  await mock.start();
  return mock;
}

export async function openSettings(page) {
  await page.getByRole('button', { name: 'Sync & connect' }).click();
  await expect(page.locator('.login-form input')).toHaveCount(2);
}

/** Imports the fixture plan through the settings file picker and confirms the replacement. */
export async function importPlan(page, path) {
  await openSettings(page);
  await page.locator('input[aria-label="Import floor plan JSON"]').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace floor plan' }).click();
  await expect(page.locator('#status')).toHaveText('Home Assistant is not connected');
}

/** Submits the open settings form; resolves once the app reports the live connection. */
export async function submitCredentials(page, url, token) {
  const form = page.locator('.login-form');
  await form.locator('input').first().fill(url);
  await form.locator('input[type="password"]').fill(token);
  await page.getByRole('button', { name: 'Connect Home Assistant' }).click();
  await expect(page.locator('#status')).toHaveText('Home Assistant connected');
}

export async function connectHomeAssistant(page, url, token) {
  await openSettings(page);
  await submitCredentials(page, url, token);
}