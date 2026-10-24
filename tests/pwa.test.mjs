import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('Inter is declared as a local variable font and has a system fallback', () => {
  const css = read('assets/css/style.css');
  assert.match(css, /font-family:\s*Inter/i);
  assert.match(css, /font-weight:\s*100\s+900/);
  assert.match(css, /url\(['"]\.\.\/fonts\/InterVariable\.woff2['"]\)/);
  assert.match(css, /--font:\s*Inter,\s*system-ui/i);
});

test('service worker routes the local font URL through its cache-aware handler', () => {
  const sw = read('sw.js');
  assert.match(sw, /CACHE_VERSION\s*=\s*'quocphonganninh-v\d+'/);
  assert.match(sw, /InterVariable\.woff2/);
  assert.match(sw, /url\.href\s*===\s*interFontUrl\.href/);
  assert.match(sw, /event\.respondWith\(serveInterFont\(request\)\)/);
  assert.match(sw, /new AbortController\(\)/);
  assert.match(sw, /cache\.put\(request, response\.clone\(\)\)/);
});

test('quiz UI keeps accessible live regions for changing questions and feedback', () => {
  const html = read('index.html');
  assert.match(html, /id=["']q-text["'][^>]*aria-live=["']polite["']/);
  assert.match(html, /id=["']feedback["'][^>]*role=["']status["']/);
  assert.match(html, /id=["']network-status["'][^>]*aria-live=["']polite["']/);
  assert.match(html, /id=["']screen-loading["'][^>]*aria-label=["']Đang tải dữ liệu["']/);
  assert.ok(read('assets/css/style.css').includes('.loading-spinner'));
});

test('quiz session persists on page lifecycle changes and checks deadlines on resume', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /window\.addEventListener\('pagehide',[\s\S]*?persistSession\(\)/);
  assert.match(app, /document\.addEventListener\('visibilitychange',[\s\S]*?enforceSessionDeadline\(\)/);
  assert.match(app, /window\.addEventListener\('pageshow',[\s\S]*?enforceSessionDeadline\(\)/);
});


test('the interface remains dark-only and uses a matching browser theme color', () => {
  const html = read('index.html');
  const css = read('assets/css/style.css');
  const manifest = JSON.parse(read('manifest.webmanifest'));

  assert.match(html, /name='color-scheme' content='dark'/);
  assert.doesNotMatch(html, /id='theme-toggle'/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.doesNotMatch(read('assets/js/app.js'), /theme-toggle/);
  assert.equal(manifest.theme_color, '#07111f');
});


test('exam submission rechecks the deadline after awaiting confirmation', () => {
  const app = read('assets/js/app.js');
  assert.match(app, /if \(!ok\) return;[\s\S]*?enforceSessionDeadline\(\) \|\| state\.session !== s \|\| s\.reviewMode/);
});
