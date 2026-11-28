// Chromium discovery for the Playwright E2E suite. Same proven order as
// webos/acceptance.mjs findChromium(): $CHROMIUM /
// $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, the newest $HOME/.t3/tools/chrome-headless-shell
// (with $HOME/.t3/chrome-libs on LD_LIBRARY_PATH when present), then chromium,
// chromium-browser, google-chrome or google-chrome-stable on PATH. Keep the two
// implementations in sync; Playwright never downloads its own browsers.
import { constants, existsSync, readdirSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function executable(path) {
  return access(path, constants.X_OK).then(() => true, () => false);
}

export async function findChromium(env = process.env) {
  if (env.CHROMIUM) return { command: env.CHROMIUM, env };
  if (env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) return { command: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, env };
  const home = env.HOME || homedir();
  const shells = join(home, '.t3', 'tools', 'chrome-headless-shell');
  if (existsSync(shells)) {
    const candidates = [];
    for (const entry of readdirSync(shells, { recursive: true, withFileTypes: true })) {
      const path = join(entry.parentPath, entry.name);
      const version = /(?:^|[\\/])(\d+(?:\.\d+){1,3})(?:[\\/]|$)/.exec(path.slice(shells.length))?.[1];
      if (entry.name === 'chrome-headless-shell' && !entry.isDirectory() && version && await executable(path)) {
        candidates.push({ path, version });
      }
    }
    candidates.sort((a, b) => compareVersions(b.version, a.version));
    if (candidates.length) {
      const libs = join(home, '.t3', 'chrome-libs');
      const libraryPath = existsSync(libs) ? [libs, env.LD_LIBRARY_PATH].filter(Boolean).join(delimiter) : env.LD_LIBRARY_PATH;
      return { command: candidates[0].path, env: { ...env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) } };
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
      if (await executable(join(dir, name))) return { command: join(dir, name), env };
    }
  }
  throw new Error('No Chromium found. Fix: set CHROMIUM=/path/to/chromium, or install chromium or google-chrome on PATH.');
}

/** Launch options shared by every test: the discovered browser plus SwiftShader and the HA host alias. */
export async function launchOptions() {
  const { command, env } = await findChromium();
  return {
    executablePath: command,
    env,
    args: [
      // Software WebGL keeps the 3D model rendering deterministic on NixOS and CI.
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      // haURL() in src/webos-ha.js only allows plain HTTP to private addresses,
      // .local hosts or the "homeassistant" hostname, so the mock lives on the
      // alias and no production URL rule is relaxed.
      '--host-resolver-rules=MAP homeassistant 127.0.0.1',
      // CI runners restrict unprivileged user namespaces, which Chrome's sandbox needs.
      ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ],
  };
}