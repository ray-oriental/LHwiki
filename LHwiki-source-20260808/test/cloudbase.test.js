import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const require = createRequire(import.meta.url);
const cloudbaseContent = require('../cloudbase/functions/lhwiki-api/content.cjs');
const { PRIMARY_KEYS, createPgStore } = require('../cloudbase/functions/lhwiki-api/pg-store.cjs');
const { createPublicSnapshotStore } = require('../cloudbase/functions/lhwiki-api/public-snapshot-store.cjs');
const { fromBackup, loadPublicSnapshot, validatePublicSnapshot } = require('../cloudbase/functions/lhwiki-api/public-snapshot.cjs');

async function readApiSource() {
  const [app, server] = await Promise.all([
    readFile(new URL('../cloudbase/functions/lhwiki-api/api-app.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../cloudbase/functions/lhwiki-api/server.js', import.meta.url), 'utf8')
  ]);
  return `${app}\n${server}`;
}

test('CloudBase 后端沿用相同的登入规则', () => {
  assert.equal(cloudbaseContent.validLoginId('202600043'), true);
  assert.equal(cloudbaseContent.validLoginId('202512343'), true);
  assert.equal(cloudbaseContent.validLoginId('ray_oriental'), true);
  assert.equal(cloudbaseContent.validLoginId('20260043'), false);
});

test('普通登录、管理员登录和会话恢复不会唤醒数据库', async () => {
  const source = await readApiSource();
  assert.match(source, /if \(!origin\) return false/);
  assert.match(source, /enforceMutationRate\(request, 'login-sustained', 60, 15 \* 60_000\)/);
  const loginStart = source.indexOf("if (method === 'POST' && path === '/api/auth/login')");
  const logoutStart = source.indexOf("if (method === 'POST' && path === '/api/auth/logout')", loginStart);
  const loginSource = source.slice(loginStart, logoutStart);
  assert.ok(loginStart > 0 && logoutStart > loginStart);
  assert.doesNotMatch(loginSource, /getDocument\(|queryDocuments\(|setDocument\(|createDocument\(|updateDocuments\(/);
  assert.match(loginSource, /const existingSession = await readSession\(request\)/);
  assert.match(source, /version: 3/);
  assert.match(source, /async function verifyPrivilegedSession\(user\)/);
  assert.match(source, /const stored = withoutId\(await getDocument\('users', user\.student_id\)\)/);
  assert.match(source, /async function ensurePersistentUser\(user\)/);
  assert.match(source, /auth\.user = await ensurePersistentUser\(auth\.user\)/);
  assert.doesNotMatch(source, /privilegedLoginUsers|PRIVILEGED_LOGIN_CACHE_TTL/);
});

test('personal workspace batches three lists into one browser request', async () => {
  const server = await readApiSource();
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /path === '\/api\/mine'/);
  assert.match(server, /Promise\.all\(\[\s*queryDocuments\('drafts'[\s\S]+queryDocuments\('submissions'[\s\S]+queryDocuments\('teacher_submissions'/);
  assert.match(client, /async function loadPrivateWorkspace\(\{ force = false \} = \{\}\)/);
  assert.match(client, /const value = await api\('\/api\/mine'\)/);
  assert.match(client, /const \{ submissions, drafts, teacherSubmissions = \[\] \} = await loadPrivateWorkspace\(\{ force \}\)/);
  assert.doesNotMatch(client, /Promise\.all\(\[\s*api\('\/api\/submissions\/mine'\)/);
});

test('opening the editor restores local work without reading PostgreSQL', async () => {
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = client.indexOf('async function resolveWritingContext()');
  const end = client.indexOf('async function contributePage()', start);
  const resolver = client.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(resolver, /const existingNewDraft = findLocalDraft\(\{ targetType: 'new', targetId: null \}\)/);
  assert.match(resolver, /if \(!draft\) draft = \(await loadPrivateWorkspace\(\)\)\.drafts\.find/);
  assert.match(resolver, /if \(!submission\) submission = \(await loadPrivateWorkspace\(\)\)\.submissions\.find/);
  assert.doesNotMatch(resolver, /const \{ drafts, submissions = \[\] \} = await api\('\/api\/mine'\)/);
});

test('生产稳定性巡检有明确的低并发和总请求预算', async () => {
  const source = await readFile(new URL('../scripts/stability-check.mjs', import.meta.url), 'utf8');
  assert.match(source, /Math\.min\(4, Number\(process\.env\.LHWIKI_CONCURRENCY \|\| 2\)\)/);
  assert.match(source, /Math\.min\(5, Number\(process\.env\.LHWIKI_ROUNDS \|\| 2\)\)/);
  assert.match(source, /requestBudget > 30/);
  const quickBaseline = source.slice(source.indexOf('const quickBaseline'), source.indexOf('const requestBudget'));
  assert.doesNotMatch(quickBaseline, /\/api\/bootstrap/);
  assert.match(source, /queue\.push\(\[origin, '\/api\/health', 'json'\]\)/);
});

test('生产写作冒烟使用当前草稿协议版本', async () => {
  const source = await readFile(new URL('../scripts/functional-smoke.mjs', import.meta.url), 'utf8');
  assert.match(source, /const draftClientVersion = 4/);
  assert.equal((source.match(/clientVersion: draftClientVersion/g) || []).length, 2);
  assert.match(source, /process\.env\.LHWIKI_ORIGIN \|\| 'http:\/\/127\.0\.0\.1:9000'/);
  assert.match(source, /LHWIKI_ALLOW_PRODUCTION_WRITES !== 'I_UNDERSTAND_THIS_WRITES_PRODUCTION'/);
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
    teacher_additions: 'id',
    site_stats: 'key',
    site_visit_events: 'visit_id'
  });
});

test('public snapshot is strictly allowlisted and excludes private backup tables/fields', () => {
  const snapshot = fromBackup({
    formatVersion: 1,
    exportedAt: '2026-08-22T00:00:00.000Z',
    data: {
      sections: [{ slug: 'start', title: '初来潞园', description: '描述', icon: '门', sort_order: 10, private_note: '不要公开' }],
      articles: [{ slug: 'welcome', section_slug: 'start', title: '欢迎', summary: '这是一段足够长的摘要', content_type: '说明', subject: 'LHwiki', author_label: '编写组', published_at: '2026-08-07', updated_at: '2026-08-07', body_json: '[{"type":"paragraph","text":"公开正文"}]', source_submission_id: 'private-submission' }],
      contributors: [{ student_id: '202600043', display_name: '同学', approved_at: '2026-08-08', first_named_at: '2026-08-07' }, { student_id: '202600044', display_name: '未公开', approved_at: null }],
      teacher_additions: [{ id: 'teacher-1', name: '李老师', subject: '语文', motto: '格言', approved_at: '2026-08-09', student_id: 'private' }]
    }
  });
  assert.deepEqual(Object.keys(snapshot.articles[0]).sort(), ['author_label', 'body', 'content_type', 'published_at', 'section_slug', 'subject', 'summary', 'title', 'updated_at', 'slug'].sort());
  assert.deepEqual(snapshot.contributors, [{ displayName: '同学', since: '2026-08-08' }]);
  assert.equal(snapshot.teacherAdditions[0].id, 'teacher-1');
  assert.throws(() => validatePublicSnapshot({ ...snapshot, articles: [{ ...snapshot.articles[0], private: true }] }), /unapproved field/);
});

test('public seed fallback is independent from private migration data', () => {
  const snapshot = loadPublicSnapshot({
    snapshotPath: new URL('../cloudbase/functions/lhwiki-api/public-snapshot-does-not-exist.json', import.meta.url),
    seedPath: new URL('../cloudbase/functions/lhwiki-api/seed-data.json', import.meta.url)
  });
  assert.ok(snapshot.articles.length > 0);
  assert.ok(snapshot.articles.every(article => Array.isArray(article.body)));
});

test('public snapshot storage validates downloads and writes an immutable version plus compatibility alias', async () => {
  const snapshot = validatePublicSnapshot({
    schemaVersion: 1,
    generatedAt: '2030-01-02T03:04:05.000Z',
    sections: [{ slug: 'start', title: '开始', description: '测试', icon: '书', sort_order: 1 }],
    articles: [], contributors: [], teacherAdditions: []
  });
  const calls = [];
  const uploads = [];
  const response = (status, data) => ({ ok: status >= 200 && status < 300, status, text: async () => typeof data === 'string' ? data : JSON.stringify(data) });
  const store = createPublicSnapshotStore({
    objectClient: { async upload(path, body, options) { uploads.push({ path, body: String(body), options }); } },
    publicUrl: 'https://storage.example/public-snapshot.json',
    validate: validatePublicSnapshot,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', headers: options.headers, body: options.body });
      if (String(url) === 'https://storage.example/public-snapshot.json') return response(200, snapshot);
      return response(404, { code: 'NOT_FOUND' });
    }
  });
  assert.deepEqual(await store.load(), snapshot);
  assert.deepEqual(await store.save(snapshot), snapshot);
  assert.equal(calls.length, 1);
  assert.match(uploads[0].path, /^lhwiki-public-workflow-v2\/snapshots\/000000000000-[a-f0-9]{64}\.json$/);
  assert.deepEqual(JSON.parse(uploads[0].body), snapshot);
  assert.equal(uploads[0].options.forbidOverwrite, false);
  assert.equal(uploads[0].options.acl, 'public-read');
  assert.equal(uploads[1].path, 'lhwiki-system/public-snapshot.json');
});

test('PostgreSQL adapter opens a 503 circuit at the per-instance request budget', async () => {
  let calls = 0;
  const store = createPgStore({
    envId: 'example-env', apiKey: 'server-key', requestLimit: 2,
    fetchImpl: async () => { calls += 1; return { ok: true, status: 200, text: async () => '[]' }; }
  });
  await store.queryDocuments('sections');
  await store.queryDocuments('sections');
  await assert.rejects(() => store.queryDocuments('sections'), error => error.code === 'PG_REQUEST_BUDGET_EXCEEDED' && error.status === 503);
  assert.equal(calls, 2);
});

test('decorative visit uploads are permanently removed', async () => {
  const server = await readApiSource();
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../cloudbase/migrations/20260809230000_add_site_visit_counter.sql', import.meta.url), 'utf8');
  assert.match(server, /path === '\/api\/visits'/);
  assert.match(server, /counted: false, paused: true/);
  assert.doesNotMatch(server, /VISIT_TRACKING_START|visitTrackingEnabled|readVisitCount|visit_count: visitCount/);
  assert.doesNotMatch(client, /VISIT_|recordVisit|flushPendingVisits|\/api\/visits/);
  assert.match(client, /为节省免费云资源点/);
  assert.match(migration, /visit_id varchar\(96\) PRIMARY KEY/);
  assert.match(migration, /visit_count integer NOT NULL DEFAULT 1 CHECK \(visit_count BETWEEN 1 AND 20\)/);
  assert.match(migration, /ON CONFLICT \(key\).*total = site_stats\.total \+ NEW\.visit_count/s);
});

test('public browsing batches cache-miss reads and keeps a static outage fallback', async () => {
  const server = await readApiSource();
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(client, /const BOOTSTRAP_TTL = 6 \* 60 \* 60_000/);
  assert.match(client, /const SESSION_TTL = 7 \* 24 \* 60 \* 60_000/);
  assert.match(client, /readCache\(localStorage, BOOTSTRAP_CACHE_KEY, BOOTSTRAP_TTL\)/);
  assert.match(client, /await import\('\.\/teachers\.js\?v=20260810-directory-supplement-2'\)/);
  assert.match(client, /readCache\(localStorage, SESSION_CACHE_KEY, SESSION_TTL\)/);
  assert.match(client, /const tabCache = readCache\(sessionStorage, SESSION_CACHE_KEY, SESSION_TTL\)/);
  assert.doesNotMatch(client, /await api\('\/api\/session'\)/);
  assert.match(client, /const session = await loadSession\(\);\s+const bootstrap = await loadBootstrap\(\);/);
  assert.match(server, /const PUBLIC_CACHE_TTL = 6 \* 60 \* 60_000/);
  assert.match(server, /const ARTICLE_CACHE_TTL = 6 \* 60 \* 60_000/);
  assert.match(server, /let publicCachePromise = null/);
  assert.match(server, /loadPublicSnapshot/);
  assert.match(server, /const publicSnapshot = loadPublicSnapshot/);
  assert.match(server, /async function readPublicArticle\(slug, force = false\)/);
  assert.match(server, /async function readPublicBootstrap\(force = false\)/);
  assert.match(server, /articles: articles\.map\(mapArticleSummary\)/);
  assert.match(server, /const \{ body_json, body, \.\.\.summary \} = clean/);
  assert.match(server, /if \(!force && publicCache && clock\(\) - publicCache\.savedAt < PUBLIC_CACHE_TTL\)/);
  assert.match(server, /invalidatePublicCache\(\)/);
  assert.match(server, /max-age=21600, stale-while-revalidate=604800/);
  assert.match(server, /database: emergencyMaintenance \? 'suspended-by-application' : 'deferred'/);
  assert.match(server, /queryDocuments\('sections'[\s\S]+queryDocuments\('articles'[\s\S]+queryDocuments\('contributors'[\s\S]+queryDocuments\('teacher_additions'/);
  assert.match(server, /value = snapshotBootstrap\(\)/);
  assert.match(server, /value = withoutId\(await getDocument\('articles', slug\)\)/);
  assert.doesNotMatch(server, /\n\s*await ensureSeed\(\);\n\n\s*if \(method === 'GET' && path === '\/api\/visits'/);
});

test('teacher additions use a moderated request before entering the public index', async () => {
  const server = await readApiSource();
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
  assert.match(client, /api\('\/api\/mine'\)/);
  assert.match(client, /state\.teacherAdditions = bootstrap\.teacherAdditions \|\| \[\]/);
});

test('known teacher names guard against duplicate community additions', () => {
  assert.ok(cloudbaseContent.KNOWN_TEACHER_NAMES instanceof Set);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.size, 209);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.has('曲连红'), true);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.has('邵红梅'), true);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.has('肖红蕊'), true);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.has('李柯'), true);
  assert.equal(cloudbaseContent.KNOWN_TEACHER_NAMES.has('张英杰'), true);
});

test('致谢板块只公开显示名，不需要把学号发送到前端', async () => {
  const source = await readApiSource();
  assert.match(source, /contributors: contributors\.sort/);
  assert.match(source, /displayName/);
  assert.doesNotMatch(source, /studentId: item\.student_id/);
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

test('CloudBase PostgreSQL adapter bounds requests without retry multiplication', async () => {
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
  await assert.rejects(() => readStore.queryDocuments('sections'), error => error.status === 503 && /CloudBase PostgreSQL HTTP request failed/.test(error.message));
  assert.equal(readCalls, 1);

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

test('browser does not multiply cloud function retries in low-resource mode', async () => {
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(client, /const maxAttempts = 1/);
  assert.doesNotMatch(client, /const maxAttempts = method === 'GET' \? 2 : 1/);
});

test('low-resource writing mode never schedules automatic cloud writes', async () => {
  const source = await readFile(new URL('../public/draft-manager.js', import.meta.url), 'utf8');
  assert.match(source, /const DRAFT_CLIENT_VERSION = 4/);
  assert.doesNotMatch(source, /SAVE_DELAY|RETRY_DELAYS/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => this\.saveNow/);
  assert.doesNotMatch(source, /automatic|trailingSaveRequested|autoRetryBlocked|retryTimer/);
  assert.match(source, /\[429, 503\]\.includes\(error\?\.status\)/);
  assert.match(source, /云端需手动保存/);
});

test('legacy editor tabs are rejected before authentication or PostgreSQL access', async () => {
  const source = await readApiSource();
  const guard = source.indexOf('if (isDraftWrite)');
  const draftRoute = source.indexOf("if (method === 'POST' && path === '/api/drafts')");
  const guardEnd = source.indexOf("if (method === 'GET' && path === '/api/session')", guard);
  assert.ok(guard > 0 && guardEnd > guard && draftRoute > guard);
  const guardSource = source.slice(guard, guardEnd);
  assert.match(guardSource, /!Number\.isSafeInteger\(Number\(data\?\.clientVersion\)\)/);
  assert.match(guardSource, /Number\(data\.clientVersion\) < draftClientVersion/);
  assert.match(guardSource, /upgradeRequired: true/);
  assert.doesNotMatch(guardSource, /requireUser|getDocument|queryDocuments|setDocument/);
});

test('public bootstrap excludes full article bodies from its batched database list read', async () => {
  const store = await readFile(new URL('../cloudbase/functions/lhwiki-api/pg-store.cjs', import.meta.url), 'utf8');
  const server = await readApiSource();
  assert.match(store, /queryDocuments\(table, where = null, limit = 100, select = '\*'\)/);
  assert.match(server, /queryDocuments\('articles', null, 2000, 'slug,section_slug,title,summary,content_type,subject,author_label,published_at,updated_at'\)/);
  assert.doesNotMatch(server, /queryDocuments\('articles'[^\n]+body_json/);
});

test('routine and deep health are always database-free', async () => {
  const source = await readApiSource();
  const start = source.indexOf("if (method === 'GET' && path === '/api/health')");
  const end = source.indexOf("if (method === 'GET' && path === '/api/visits')", start);
  const healthRoute = source.slice(start, end);
  assert.doesNotMatch(healthRoute, /searchParams/);
  assert.doesNotMatch(healthRoute, /queryDocuments|getDocument|ensureSeed/);
  assert.match(healthRoute, /suspended-by-application/);
});

test('emergency maintenance keeps private and mutation routes away from PostgreSQL', async () => {
  const server = await readApiSource();
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /const EMERGENCY_MAINTENANCE = false/);
  const publicArticle = server.indexOf("path.startsWith('/api/articles/')");
  const gate = server.indexOf('if (emergencyMaintenance) {', publicArticle);
  const legacyDraftGuard = server.indexOf('const isDraftWrite', gate);
  assert.ok(publicArticle > 0 && gate > publicArticle && legacyDraftGuard > gate);
  const gateSource = server.slice(gate, legacyDraftGuard);
  assert.match(gateSource, /maintenance: true/);
  assert.match(gateSource, /}, 503/);
  assert.doesNotMatch(gateSource, /getDocument|queryDocuments|setDocument|deleteDocument|requireUser/);
  assert.match(client, /const MAINTENANCE_MODE = false/);
  assert.match(client, /网站近期运行不稳定，暂时停用云端上传/);
  assert.match(client, /预计于 \$\{MAINTENANCE_REVIEW_DATE\} 恢复/);
  assert.match(client, /return \{ user: null, maintenance: MAINTENANCE_MODE \}/);
});

test('in-memory mutation limiter has an absolute bucket cap', async () => {
  const source = await readApiSource();
  assert.match(source, /while \(mutationWindows\.size > 2500\)/);
  assert.match(source, /mutationWindows\.delete\(mutationWindows\.keys\(\)\.next\(\)\.value\)/);
});

test('draft routes require ownership and optimistic revisions', async () => {
  const source = await readApiSource();
  assert.match(source, /path === '\/api\/drafts\/mine'/);
  assert.match(source, /revision: expectedRevision/);
  assert.match(source, /status: 409|}, 409\)/);
  assert.match(source, /student_id: auth\.user\.student_id/);
  assert.match(source, /draft\.target_type === 'article'/);
  assert.match(source, /containsAdvancedBlocks\(existingBody\)/);
  assert.match(source, /containsAdvancedBlocks\(target\.sourceBody \|\| \[\]\)/);
  assert.match(source, /upgradeRequired: true/);
  assert.match(source, /snapshot\?\.schemaVersion/);
});

test('manual cloud saves are capped to six revisions per hour', async () => {
  const source = await readApiSource();
  assert.match(source, /enforceMutationRate\(request, 'draft-save', 6, 60 \* 60_000\)/);
});

test('CloudBase content parser counts nested advanced content for submission limits', () => {
  const body = cloudbaseContent.parseDocument([
    { type: 'toggle', level: 2, text: '标题', children: [{ type: 'paragraph', text: '正文内容' }] },
    { type: 'table', rows: [['列', '值'], ['人数', '12']] }
  ]);
  assert.deepEqual(cloudbaseContent.documentStats(body), { characters: 12, blocks: 3 });
  assert.equal(cloudbaseContent.containsAdvancedBlocks(body), true);
});

test('受保护管理员不能被权限接口降权，并拥有已发布文章管理接口', async () => {
  const source = await readApiSource();
  assert.match(source, /studentId === ADMIN_LOGIN_ID/);
  assert.match(source, /受保护的站点管理员不能被降权或覆盖/);
  assert.match(source, /adminArticleMatch && \['PUT', 'DELETE'\]\.includes\(method\)/);
  assert.match(source, /requireUser\(request, \['admin'\]\)/);
  assert.match(source, /deleteDocument\('articles', slug\)/);
});

test('管理员可以校订待审核稿件但不会绕过审核或改变投稿归属', async () => {
  const server = await readApiSource();
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../cloudbase/migrations/20260811022500_allow_admin_review_edits.sql', import.meta.url), 'utf8');
  assert.match(server, /submission\.student_id === user\.student_id \|\| user\.role === 'admin'/);
  assert.match(server, /rememberNamedContributor\(submission\.student_id, author_label\)/);
  assert.match(server, /action: 'admin_edit'/);
  assert.match(server, /status: 'pending', review_note: ''/);
  assert.match(client, /data-edit-pending/);
  assert.match(client, /admin-review-edit/);
  assert.match(client, /待审核稿件已更新/);
  assert.match(migration, /'admin_edit'/);
});

test('普通文章读取复用 HTTP 缓存，管理员保存后仍强制刷新正文', async () => {
  const server = await readApiSource();
  const client = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /max-age=21600, stale-while-revalidate=604800/);
  assert.match(client, /const articleOptions = cacheBust \? \{ cache: 'reload' \} : \{\};/);
  assert.match(client, /api\(`\/api\/articles\/\$\{encodeURIComponent\(slug\)\}\$\{cacheBust\}`, articleOptions\)/);
  assert.match(client, /api\(`\/api\/articles\/\$\{encodeURIComponent\(slug\)\}`, \{ cache: 'no-store' \}\)/);
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
