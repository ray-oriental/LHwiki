import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const cloudbaseContent = require('../cloudbase/functions/lhwiki-api/content.cjs');
const { PRIMARY_KEYS, createPgStore } = require('../cloudbase/functions/lhwiki-api/pg-store.cjs');

test('CloudBase 后端沿用相同的登入规则', () => {
  assert.equal(cloudbaseContent.validLoginId('202600043'), true);
  assert.equal(cloudbaseContent.validLoginId('202512343'), true);
  assert.equal(cloudbaseContent.validLoginId('ray_oriental'), true);
  assert.equal(cloudbaseContent.validLoginId('20260043'), false);
});

test('CloudBase PostgreSQL adapter defines a stable primary key for every table', () => {
  assert.deepEqual(PRIMARY_KEYS, {
    sections: 'slug',
    articles: 'slug',
    users: 'student_id',
    submissions: 'id',
    review_events: 'id',
    contributors: 'student_id'
  });
});

test('致谢板块只公开显示名，不需要把学号发送到前端', async () => {
  const source = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  assert.match(source, /displayName: item\.display_name/);
  assert.match(source, /filter\(item => item\.approved_at\)/);
  assert.doesNotMatch(source, /displayName: item\.display_name, studentId/);
});

test('CloudBase PostgreSQL adapter uses the documented REST endpoint and bearer key', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => '[]' };
  };
  const store = createPgStore({ envId: 'example-env', apiKey: 'server-key', fetchImpl });
  assert.equal(await store.getDocument('sections', 'campus'), null);
  await store.setDocument('sections', 'campus', { title: 'Campus' });
  await store.deleteDocument('sections', 'campus');
  assert.match(calls[0].url, /^https:\/\/example-env\.api\.tcloudbasegateway\.com\/v1\/rdb\/rest\/sections\?/);
  assert.match(calls[0].url, /slug=eq\.campus/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer server-key');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[2].options.method, 'DELETE');
  assert.match(calls[2].url, /slug=eq\.campus/);
});

test('受保护管理员不能被权限接口降权，并拥有已发布文章管理接口', async () => {
  const source = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  assert.match(source, /studentId === ADMIN_LOGIN_ID/);
  assert.match(source, /受保护的站点管理员不能被降权或覆盖/);
  assert.match(source, /adminArticleMatch && \['PUT', 'DELETE'\]\.includes\(method\)/);
  assert.match(source, /requireUser\(request, \['admin'\]\)/);
  assert.match(source, /deleteDocument\('articles', slug\)/);
});

test('CloudBase 种子包含完整基础目录和文章', async () => {
  const raw = await readFile(new URL('../cloudbase/functions/lhwiki-api/seed-data.json', import.meta.url), 'utf8');
  const seed = JSON.parse(raw);
  assert.equal(seed.sections.length, 7);
  assert.ok(seed.articles.length >= 9);
  assert.equal(new Set(seed.sections.map(section => section.slug)).size, seed.sections.length);
  assert.equal(new Set(seed.articles.map(article => article.slug)).size, seed.articles.length);
  for (const article of seed.articles) {
    assert.ok(cloudbaseContent.parseDocument(article.body_json));
  }
});
