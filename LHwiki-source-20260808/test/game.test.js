import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = join(root, 'public');
const app = readFileSync(join(publicDir, 'app.js'), 'utf8');
const styles = readFileSync(join(publicDir, 'styles.css'), 'utf8');
const gameDir = join(publicDir, 'games', 'great-luhe');
const gameHtml = readFileSync(join(gameDir, 'index.html'), 'utf8');
const gameJsName = gameHtml.match(/src="\.\/assets\/([^"']+\.js)"/)?.[1];
const gameCssName = gameHtml.match(/href="\.\/assets\/([^"']+\.css)"/)?.[1];
assert.ok(gameJsName && gameCssName, 'game index must reference one JS and one CSS asset');
const gameBundle = readFileSync(join(gameDir, 'assets', gameJsName), 'utf8');
const gameCss = readFileSync(join(gameDir, 'assets', gameCssName), 'utf8');
const gameSourceDir = join(root, 'games', 'great-luhe', 'src');
const sourceFiles = [];
function collectSourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(path);
    else if (/\.(?:ts|css)$/.test(entry.name)) sourceFiles.push(readFileSync(path, 'utf8'));
  }
}
collectSourceFiles(gameSourceDir);

test('LHwiki exposes a secondary Great Luhe game route and lazy isolated iframe', () => {
  assert.match(app, /#\/game/);
  assert.match(app, /function greatLuhePage\(\)/);
  assert.match(app, /loading="lazy"/);
  assert.match(app, /sandbox="allow-scripts allow-same-origin"/);
  assert.match(app, /title="合成潞河小游戏"/);
  assert.match(app, /allow="autoplay"/);
  assert.match(app, /cleanupGameThemeSync/);
});

test('host theme is sent to the game without leaking listeners across rerenders', () => {
  assert.match(app, /type: 'lhwiki-theme-change'/);
  assert.match(app, /window\.addEventListener\('lhwiki-theme-change', sendTheme\)/);
  assert.match(app, /window\.removeEventListener\('lhwiki-theme-change', sendTheme\)/);
  assert.match(app, /location\.origin/);
});

test('game build supports query and postMessage themes and dark canvas surfaces', () => {
  assert.match(gameBundle, /theme=system|URLSearchParams/);
  assert.match(gameBundle, /lhwiki-theme-change/);
  assert.match(gameBundle, /prefers-color-scheme/);
  assert.match(gameCss, /data-theme=.*dark|data-theme=\"dark\"/);
  assert.match(gameCss, /prefers-reduced-motion/);
  assert.match(gameBundle, /#1b2528|#45575a|#566460/);
});

test('game CSP remains same-origin and the game has no backend or analytics calls', () => {
  const index = readFileSync(join(publicDir, 'index.html'), 'utf8');
  assert.match(index, /default-src 'self'/);
  assert.match(index, /rel="icon" href="data:image\/svg\+xml/);
  assert.doesNotMatch(index, /frame-src\s+[^;]*https?:/);
  for (const source of [...sourceFiles, gameCss]) {
    assert.doesNotMatch(source, /(?:https?:\/\/|\/api\/|cloudbase|XMLHttpRequest|fetch\s*\(|sendBeacon|google-analytics|gtag\s*\()/i);
  }
  assert.doesNotMatch(gameBundle, /(?:\/api\/|cloudbase|XMLHttpRequest|sendBeacon|google-analytics|gtag\s*\()/i);
  assert.doesNotMatch(gameHtml, /(?:src|href)=['"]https?:\/\//i);
  assert.doesNotMatch(gameHtml, /(?:\/api\/|cloudbase|XMLHttpRequest|fetch\s*\(|sendBeacon|google-analytics|gtag\s*\()/i);
});

test('only the active game bundle, stylesheet, and ten school marks are published', () => {
  assert.ok(existsSync(join(root, 'games', 'great-luhe', 'package.json')));
  assert.ok(existsSync(join(gameDir, 'assets', gameJsName)));
  assert.ok(existsSync(join(gameDir, 'assets', gameCssName)));
  const assets = readdirSync(join(gameDir, 'assets')).filter(name => name !== 'schools');
  assert.deepEqual(assets.sort(), [gameCssName, gameJsName].sort());
  const schools = readdirSync(join(gameDir, 'assets', 'schools')).filter(name => /^l\d{2}\.png$/.test(name));
  assert.deepEqual(schools.sort(), Array.from({ length: 10 }, (_, i) => `l${String(i + 1).padStart(2, '0')}.png`));
});

test('game entry is not a backend route and iframe does not request privileged capabilities', () => {
  assert.match(gameHtml, /<div id="great-luhe"><\/div>/);
  assert.doesNotMatch(gameHtml, /allow-top-navigation|allow-popups|allow-forms/);
  assert.doesNotMatch(app, /games\/great-luhe[^"']*\/api/);
});
