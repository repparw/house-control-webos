// Mechanical guardrails for House Control for webOS. Run from web/: pnpm run lint
// Every finding names its fix. Rules encode bugs and drift that shipped once:
//   no-blocking-dialog   428d9cf  webOS has no usable native dialogs on the TV remote
//   credential-storage   HA tokens live only in the Keymanager3 envelope
//   no-android-legacy    Android TV / Mac Bridge / Smart Life copy does not belong in webOS
//   max-lines            webos.js may not grow; split new code into focused modules
//   syntax / unused-import  basic hygiene for files tsc does not cover
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MAX_LINES = 600;
// Existing oversize modules are frozen at their current size. Lower a ceiling when a
// refactor shrinks the file; never raise it.
const LINE_CEILINGS = { 'src/webos.js': 1005 };
const CREDENTIAL_MODULE = 'src/webos-credentials.js';
const SECRET = /token|credential|secret|password|passwd|auth/i;
const ANDROID_LEGACY = /\b(HouseTV|HouseWidget|sync-tv\.py|TV Bridge|Smart Life)\b/;

function files(dir, pattern) {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && pattern.test(entry.name))
    .map(entry => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

// Blank out comments and string/template contents while keeping line numbers, so the
// rules do not trip over prose. Regex literals are rare here and left as code.
function code(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const blank = end => {
      for (; i < end; i++) out += text[i] === '\n' ? '\n' : ' ';
      i--;
    };
    if (c === '/' && text[i + 1] === '/') blank(text.indexOf('\n', i) === -1 ? text.length : text.indexOf('\n', i));
    else if (c === '/' && text[i + 1] === '*') blank(text.indexOf('*/', i) === -1 ? text.length : text.indexOf('*/', i) + 2);
    else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c && !(c !== '`' && text[j] === '\n')) j += text[j] === '\\' ? 2 : 1;
      out += c;
      i++;
      blank(j);
      i++;
      if (i < text.length) out += text[i];
    } else out += c;
  }
  return out;
}

const findings = [];
function report(file, index, rule, message, fix) {
  findings.push(`${file}:${index + 1} ${rule}: ${message} Fix: ${fix}`);
}

const sources = files('src', /\.js$/);
for (const file of sources) {
  const text = readFileSync(join(root, file), 'utf8');
  const rawLines = text.split('\n');
  const lines = code(text).split('\n');

  const ceiling = LINE_CEILINGS[file] ?? MAX_LINES;
  const count = rawLines.length - (text.endsWith('\n') ? 1 : 0);
  if (count > ceiling) {
    report(file, ceiling, 'max-lines', `${count} lines exceeds the ${ceiling}-line ceiling.`,
      LINE_CEILINGS[file]
        ? 'move code out of this file into a focused module instead of growing it.'
        : `split the module below ${MAX_LINES} lines by responsibility.`);
  }

  lines.forEach((line, index) => {
    for (const dialog of line.matchAll(/(?:\b(?:window|globalThis|self)\s*\??\.\s*|(?<![\w$.]))(confirm|alert|prompt)\s*\(/g)) {
      if (/\bfunction\s+(confirm|alert|prompt)\b/.test(line)) break;
      report(file, index, 'no-blocking-dialog', `${dialog[1]}() blocks the webOS app and cannot be answered with the remote.`,
        'use an in-app D-pad/pointer modal (see confirmImport in src/main.js).');
    }

    const original = rawLines[index].replace(/^\s*(\/\/|\*|\/\*).*/, '');
    const legacy = ANDROID_LEGACY.exec(original);
    if (legacy) {
      report(file, index, 'no-android-legacy', `Android/Mac legacy reference "${legacy[1]}" found in webOS source.`,
        'remove Android TV, Mac Bridge, or Smart Life references and use webOS / Home Assistant copy.');
    }

    if (file === CREDENTIAL_MODULE) return;
    const write = /(?<!session)(?:localStorage|[sS]torage\(\)\s*\??|\bstorage|\bdisk)\s*\.\s*setItem\s*\(([^;]*)/.exec(original)
      ?? /localStorage\s*(?:\.\s*[\w$]+|\[[^\]]*\])\s*=(?!=)/.exec(original);
    if (write && SECRET.test(write[0])) {
      report(file, index, 'credential-storage', 'credential or token data is written to localStorage.',
        `use createHACredentialStore() from ${CREDENTIAL_MODULE}, which stores only the Keymanager3 envelope.`);
    }
  });
}

// Syntax for every module, including files outside the tsc include list.
for (const file of [...sources, ...files('webos', /\.mjs$/)]) {
  const result = spawnSync(process.execPath, ['--check', join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) {
    report(file, 0, 'syntax', result.stderr.trim().split('\n').slice(0, 5).join(' | '), 'correct the syntax error reported by node --check.');
  }
}

// Unused named imports. tsc covers the typed modules with noUnusedLocals; this covers the rest.
for (const file of [...sources, ...files('webos', /\.mjs$/)]) {
  const text = readFileSync(join(root, file), 'utf8');
  const body = code(text);
  for (const match of body.matchAll(/^import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s/gm)) {
    const names = [match[1], ...(match[2] ?? '').split(',').map(part => part.trim().split(/\s+as\s+/).pop())]
      .filter(Boolean);
    const rest = body.slice(0, match.index) + body.slice(match.index + match[0].length);
    for (const name of names) {
      if (!new RegExp(`(?<![\\w$])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(rest)) {
        const line = text.slice(0, match.index).split('\n').length - 1;
        report(file, line, 'unused-import', `${name} is imported but never used.`, `remove ${name} from the import.`);
      }
    }
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  console.error(`\n${findings.length} lint finding(s).`);
  process.exit(1);
}
console.log(`lint: ${sources.length} src modules clean`);
