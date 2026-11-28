// Serves the packaged dist/ (the input to ares-package) the way a TV loads it.
// Playwright's webServer starts this; run `pnpm run build` first.
// The CSP mirrors the production intent: the packaged app may open WebSockets
// only to its Home Assistant host, so the tests prove ws://homeassistant:* is
// enough and no script/source rule is relaxed.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const dist = new URL('../dist/', import.meta.url);
const port = Number(process.env.E2E_PORT || 47123);

const html = await readFile(new URL('index.html', dist), 'utf8').catch(() => null);
if (!html?.includes('./webostv/webOSTV.js')) {
  console.error('dist/index.html does not package webOSTV.js. Fix: run pnpm run build first.');
  process.exit(1);
}
for (const file of ['LICENSE', 'UPSTREAM-LICENSE', 'webostv/webOSTV.js', 'webostv/LICENSE-2.0.txt']) {
  await readFile(new URL(file, dist)).catch(() => {
    console.error(`dist/${file} is missing. Fix: run pnpm run build first.`);
    process.exit(1);
  });
}

const contentTypes = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png',
};
const server = createServer(async (request, response) => {
  const path = request.url === '/' ? 'index.html' : request.url.slice(1);
  if (!/^[\w-]+(?:\/[\w-]+)*\.[\w]+$/.test(path)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(new URL(path, dist));
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data:; connect-src 'self' ws://homeassistant:*",
    }).end(body);
  } catch {
    response.writeHead(404).end();
  }
});

server.on('error', error => {
  console.error(`Could not serve dist/ on 127.0.0.1:${port}: ${error.message}`);
  process.exit(1);
});
server.listen(port, '127.0.0.1');