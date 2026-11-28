// Packaged-UI E2E for House Control for webOS. Run from web/ after a build:
//   pnpm run test:e2e          (part of pnpm run check, after test:acceptance)
// The suite serves the packaged dist/ and drives it in the system/T3 Chromium
// (e2e/chromium.mjs) against a loopback Home Assistant mock (e2e/mock-ha.mjs)
// reachable through the "homeassistant" host alias. PLAYWRIGHT_SKIP_BROWSER_
// DOWNLOAD=1 keeps Playwright from pulling glibc binaries that cannot run on
// NixOS; the browser always comes from the machine.
import { defineConfig } from '@playwright/test';
import { launchOptions } from './e2e/chromium.mjs';

const port = Number(process.env.E2E_PORT || 47123);

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  outputDir: './test-results',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 720 },
    colorScheme: 'dark',
    launchOptions: await launchOptions(),
    // Failure evidence stays on disk for CI to upload (see .github/workflows/webos.yml).
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/dist-server.mjs',
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});