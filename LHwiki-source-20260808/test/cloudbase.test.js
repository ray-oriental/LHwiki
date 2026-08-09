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
    contributors: 'student_id',
    drafts: 'id',
    teacher_submissions: 'id',
    teacher_additions: 'id'
  });
});

test('teacher additions use a moderated request before entering the public index', async () => {
  const server = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /path === '\/api\/teacher-submissions'/);
  assert.match(server, /requireUser\(request\)/);
  assert.match(server, /if \(!subject\) return error/);
  assert.match(server, /queryDocuments\('teacher_submissions', \{ name, status: 'pending' \}, 1\)/);
  assert.match(server, /path\.match\(\/\^\\\/api\\\/review\\\/teachers/);
  assert.match(server, /setDocument\('teacher_additions'/);
  assert.match(client, /href="#\/teacher-submit"/);
  assert.match(client, /name="name"[^>]+required/);
  assert.match(client, /name="subject"[^>]+required/);
  assert.match(client, /name="motto"[^>]+maxlength="240"/);
  assert.match(client, /teacherSubmissions = \[\]/);
  assert.match(client, /api\('\/api\/teacher-submissions\/mine'\)/);
  assert.match(client, /state\.teacherAdditions = bootstrap\.teacherAdditions \|\| \[\]/);
});

test('known teacher names guard against duplicate community additions', () => {
  assert.ok(cloudbaseContent.KNOWN_TEACHER_NAMES instanceof Set);
  assert.ok(cloudbaseContent.KNOWN_TEACHER_NAMES.size >= 80);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.has('曲连红'), true);
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
  await store.createDocument('drafts', { id: 'draft-1', student_id: '202600043' });
  await store.updateDocuments('drafts', { id: 'draft-1', revision: 1 }, { revision: 2 });
  await store.deleteDocuments('drafts', { id: 'draft-1', student_id: '202600043' });
  assert.match(calls[0].url, /^https:\/\/example-env\.api\.tcloudbasegateway\.com\/v1\/rdb\/rest\/sections\?/);
  assert.match(calls[0].url, /slug=eq\.campus/);
  assert.equal(calls[0].options.headers.authorization, 'Bearer server-key');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers.prefer, 'resolution=merge-duplicates,return=minimal');
  assert.equal(calls[2].options.method, 'DELETE');
  assert.match(calls[2].url, /slug=eq\.campus/);
  assert.equal(calls[3].options.method, 'POST');
  assert.equal(calls[3].options.headers.prefer, 'return=representation');
  assert.equal(calls[4].options.method, 'PATCH');
  assert.match(calls[4].url, /revision=eq\.1/);
  assert.equal(calls[5].options.method, 'DELETE');
  assert.match(calls[5].url, /student_id=eq\.202600043/);
});

test('CloudBase PostgreSQL adapter bounds requests and retries only safe reads', async () => {
  let readCalls = 0;
  const readStore = createPgStore({
    envId: 'example-env',
    apiKey: 'server-key',
    requestTimeoutMs: 100,
    fetchImpl: async (_url, options) => {
      readCalls += 1;
      assert.ok(options.signal);
      if (readCalls === 1) return { ok: false, status: 503, text: async () => '{"code":"BUSY"}' };
      return { ok: true, status: 200, text: async () => '[]' };
    }
  });
  await readStore.queryDocuments('sections');
  assert.equal(readCalls, 2);

  let writeCalls = 0;
  const writeStore = createPgStore({
    envId: 'example-env',
    apiKey: 'server-key',
    fetchImpl: async () => {
      writeCalls += 1;
      return { ok: false, status: 503, text: async () => '{"code":"BUSY"}' };
    }
  });
  await assert.rejects(() => writeStore.setDocument('sections', 'campus', { title: 'Campus' }), /CloudBase PostgreSQL HTTP request failed/);
  assert.equal(writeCalls, 1);
});

test('health endpoint verifies PostgreSQL instead of reporting a false healthy state', async () => {
  const source = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  const healthRoute = source.slice(source.indexOf("path === '/api/health'"), source.indexOf('await ensureSeed()'));
  assert.match(healthRoute, /await queryDocuments\('sections', null, 1\)/);
  assert.match(healthRoute, /database: 'ready'/);
});

test('in-memory mutation limiter has an absolute bucket cap', async () => {
  const source = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  assert.match(source, /while \(mutationWindows\.size > 2500\)/);
  assert.match(source, /mutationWindows\.delete\(mutationWindows\.keys\(\)\.next\(\)\.value\)/);
});

test('draft routes require ownership and optimistic revisions', async () => {
  const source = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  assert.match(source, /path === '\/api\/drafts\/mine'/);
  assert.match(source, /revision: expectedRevision/);
  assert.match(source, /status: 409|}, 409\)/);
  assert.match(source, /student_id: auth\.user\.student_id/);
  assert.match(source, /draft\.target_type === 'article'/);
});

test('受保护管理员不能被权限接口降权，并拥有已发布文章管理接口', async () => {
  const source = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  assert.match(source, /studentId === ADMIN_LOGIN_ID/);
  assert.match(source, /受保护的站点管理员不能被降权或覆盖/);
  assert.match(source, /adminArticleMatch && \['PUT', 'DELETE'\]\.includes\(method\)/);
  assert.match(source, /requireUser\(request, \['admin'\]\)/);
  assert.match(source, /deleteDocument\('articles', slug\)/);
});

test('公开文章读取不缓存旧正文，管理员保存后刷新仍保持更新', async () => {
  const server = await readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /max-age=300, stale-while-revalidate=600/);
  assert.match(client, /api\(`\/api\/articles\/\$\{encodeURIComponent\(slug\)\}\$\{cacheBust\}`, \{ cache: 'no-store' \}\)/);
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
