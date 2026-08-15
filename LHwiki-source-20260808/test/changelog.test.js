import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { CHANGELOG_ENTRIES, changelogPage } from '../public/changelog.js';

test('站内更新日志倒序覆盖所有历史版本且不记录改名', () => {
  assert.deepEqual(CHANGELOG_ENTRIES.map(entry => entry.version), [
    'v0.8.1', 'v0.8.0', 'v0.7.0', 'v0.6.0', 'v0.5.1', 'v0.5.0', 'v0.4.0', 'v0.3.0', 'v0.2.0', 'v0.1.0'
  ]);
  assert.ok(CHANGELOG_ENTRIES.every(entry => entry.date && entry.title && entry.items.length));
  assert.doesNotMatch(JSON.stringify(CHANGELOG_ENTRIES), /更名|改名|同窗手册/);
});

test('更新日志页面和侧栏入口保持可访问', async () => {
  const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /#\/changelog/);
  assert.match(appSource, /changelog:\s*changelogPage/);
  assert.match(changelogPage(), /<h1>更新日志<\/h1>/);
  assert.equal((changelogPage().match(/class="changelog-entry"/g) || []).length, CHANGELOG_ENTRIES.length);
});
