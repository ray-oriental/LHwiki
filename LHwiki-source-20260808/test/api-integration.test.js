import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../cloudbase/functions/lhwiki-api/api-app.cjs');
const { fromBackup } = require('../cloudbase/functions/lhwiki-api/public-snapshot.cjs');
const { createMemoryStore } = require('./helpers/memory-store.cjs');

const SESSION_SECRET = 'lhwiki-local-integration-session-secret-0001';
const FIXED_TIME = Date.parse('2030-01-02T03:04:05.000Z');
const STUDENT_ID = '209900001';
const REVIEWER_ID = '209900002';
const OTHER_ID = '209900003';
const LOCKED_ID = '209900004';
const ADMIN_ID = 'ray_oriental';

function fixtureData(extra = {}) {
  return {
    sections: [{ slug: 'start', title: '开始', description: '测试分区', icon: '书', sort_order: 1 }],
    users: [
      { student_id: REVIEWER_ID, role: 'reviewer', role_locked: 0, created_at: '2030-01-01T00:00:00.000Z', last_login_at: '2030-01-01T00:00:00.000Z' },
      { student_id: LOCKED_ID, role: 'student', role_locked: 1, created_at: '2030-01-01T00:00:00.000Z', last_login_at: '2030-01-01T00:00:00.000Z' }
    ],
    ...extra
  };
}

function validSnapshot(overrides = {}) {
  return {
    schemaVersion: 2,
    sectionSlug: 'start',
    title: '完整测试投稿',
    summary: '这是一段用于本地集成测试的完整摘要内容',
    body: [{ type: 'paragraph', text: '这是完全虚构的本地测试正文。'.repeat(8) }],
    contentType: '经验',
    subject: '本地测试',
    authorLabel: '测试同学',
    anonymous: false,
    ...overrides
  };
}

function submissionInput(overrides = {}) {
  return validSnapshot(overrides);
}

async function createHarness({ data = fixtureData(), appOptions = {} } = {}) {
  const store = createMemoryStore(data);
  let sequence = 0;
  const errors = [];
  const app = createApp({
    store,
    seed: { sections: [], articles: [] },
    publicSnapshot: { sections: [], articles: [], contributors: [], teacherAdditions: [] },
    sessionSecret: SESSION_SECRET,
    adminBootstrapCode: 'admin-fixture-code',
    reviewerAccessCode: 'reviewer-fixture-code',
    emergencyMaintenance: false,
    clock: () => FIXED_TIME,
    randomUUID: () => `fixture-${String(++sequence).padStart(4, '0')}`,
    logger: { error(error) { errors.push(error); } },
    ...appOptions
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  function client() {
    let cookie = '';
    return {
      async request(path, { method = 'GET', body, cookie: cookieOverride, requestOrigin = origin } = {}) {
        const headers = { accept: 'application/json' };
        if (!['GET', 'HEAD'].includes(method) && requestOrigin !== null) headers.origin = requestOrigin;
        const sentCookie = cookieOverride === undefined ? cookie : cookieOverride;
        if (sentCookie) headers.cookie = sentCookie;
        if (body !== undefined) headers['content-type'] = 'application/json';
        const response = await fetch(`${origin}${path}`, {
          method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) })
        });
        const setCookie = response.headers.get('set-cookie');
        if (setCookie && cookieOverride === undefined) cookie = setCookie.split(';', 1)[0];
        return { status: response.status, headers: response.headers, data: await response.json() };
      },
      async login(studentId) {
        return this.request('/api/auth/login', { method: 'POST', body: { studentId } });
      },
      cookie() { return cookie; }
    };
  }

  return {
    store,
    errors,
    client,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
}

async function useHarness(options, callback) {
  const harness = await createHarness(options);
  try {
    await callback(harness);
  } finally {
    await harness.close();
  }
}

test('login, signed session, origin validation and logout run entirely locally', async () => {
  await useHarness({}, async ({ store, client }) => {
    const browser = client();
    const invalid = await browser.login('not-a-student');
    assert.equal(invalid.status, 403);

    const wrongOrigin = await browser.request('/api/auth/login', {
      method: 'POST', body: { studentId: STUDENT_ID }, requestOrigin: 'https://invalid.example'
    });
    assert.equal(wrongOrigin.status, 403);

    const login = await browser.login(STUDENT_ID);
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, 'student');
    assert.match(browser.cookie(), /^campus_session=/);
    assert.equal(store.inspect('users').some(user => user.student_id === STUDENT_ID), false);

    const session = await browser.request('/api/session');
    assert.equal(session.data.user.studentId, STUDENT_ID);
    const tampered = await browser.request('/api/session', { cookie: `${browser.cookie()}tampered` });
    assert.equal(tampered.data.user, null);

    const logout = await browser.request('/api/auth/logout', { method: 'POST' });
    assert.equal(logout.status, 200);
    assert.equal((await browser.request('/api/session')).data.user, null);
  });
});

test('ordinary login scans and signed student sessions reuse the privilege cache without per-request user reads', async () => {
  await useHarness({}, async ({ store, client }) => {
    const first = client();
    assert.equal((await first.login(STUDENT_ID)).status, 200);

    store.failNext('queryDocuments', 'users', new Error('privilege cache should be reused'));
    const second = client();
    assert.equal((await second.login(OTHER_ID)).status, 200);

    store.failNext('getDocument', 'users', new Error('student session should be database-free'));
    const session = await first.request('/api/session');
    assert.equal(session.status, 200);
    assert.equal(session.data.user.role, 'student');
  });
});

test('draft CRUD enforces ownership and optimistic revision conflicts over HTTP', async () => {
  await useHarness({}, async ({ client, store }) => {
    const owner = client();
    const outsider = client();
    await owner.login(STUDENT_ID);
    await outsider.login(OTHER_ID);

    const created = await owner.request('/api/drafts', {
      method: 'POST',
      body: { clientVersion: 4, draftKey: 'new:fixture_draft_001', targetType: 'new', snapshot: validSnapshot({ title: '' }) }
    });
    assert.equal(created.status, 201);
    assert.equal(created.data.draft.revision, 1);
    const draftId = created.data.draft.id;
    assert.equal((await owner.request('/api/drafts/mine')).data.drafts.length, 1);

    const duplicateWithoutRevision = await owner.request('/api/drafts', {
      method: 'POST',
      body: { clientVersion: 4, draftKey: 'new:fixture_draft_001', targetType: 'new', snapshot: validSnapshot({ title: '另一标签页' }) }
    });
    assert.equal(duplicateWithoutRevision.status, 409);
    assert.equal(duplicateWithoutRevision.data.conflict.revision, 1);
    assert.equal(store.inspect('drafts')[0].title, '');

    const updated = await owner.request(`/api/drafts/${draftId}`, {
      method: 'PUT',
      body: { clientVersion: 4, expectedRevision: 1, snapshot: validSnapshot({ title: '第二版测试投稿' }) }
    });
    assert.equal(updated.data.draft.revision, 2);

    const stale = await owner.request(`/api/drafts/${draftId}`, {
      method: 'PUT',
      body: { clientVersion: 4, expectedRevision: 1, snapshot: validSnapshot({ title: '过期页面修改' }) }
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.data.conflict.revision, 2);
    assert.equal(stale.data.conflict.title, '第二版测试投稿');

    const hidden = await outsider.request(`/api/drafts/${draftId}`, { method: 'DELETE' });
    assert.equal(hidden.status, 404);
    assert.equal(store.inspect('drafts').length, 1);
    assert.equal((await owner.request(`/api/drafts/${draftId}`, { method: 'DELETE' })).status, 200);
    assert.equal(store.inspect('drafts').length, 0);
  });
});

test('draft submission, requested changes, resubmission and approval form one complete flow', async () => {
  await useHarness({}, async ({ client, store }) => {
    const student = client();
    const reviewer = client();
    await student.login(STUDENT_ID);
    await reviewer.login(REVIEWER_ID);

    const draft = await student.request('/api/drafts', {
      method: 'POST',
      body: { clientVersion: 4, draftKey: 'new:fixture_submit_001', targetType: 'new', snapshot: validSnapshot() }
    });
    const draftId = draft.data.draft.id;
    const submitted = await student.request(`/api/drafts/${draftId}/submit`, {
      method: 'POST', body: { clientVersion: 4, expectedRevision: 1 }
    });
    assert.deepEqual(submitted.data, { ok: true, id: draftId, slug: null, status: 'pending' });
    assert.equal(store.inspect('drafts').length, 0);
    assert.equal(store.inspect('submissions')[0].student_id, STUDENT_ID);

    const studentReview = await student.request('/api/review');
    assert.equal(studentReview.status, 403);
    const queue = await reviewer.request('/api/review');
    assert.equal(queue.status, 200);
    assert.equal(queue.data.submissions[0].student_id, '匿名校内成员');

    const changes = await reviewer.request(`/api/review/${draftId}`, {
      method: 'POST', body: { action: 'request_changes', note: '请补充一个具体场景' }
    });
    assert.equal(changes.data.status, 'changes_requested');

    const revisionDraft = await student.request('/api/drafts', {
      method: 'POST',
      body: { clientVersion: 4, targetType: 'submission', targetId: draftId, snapshot: validSnapshot({ title: '补充后的测试投稿' }) }
    });
    const revisionDraftId = revisionDraft.data.draft.id;
    const resubmitted = await student.request(`/api/drafts/${revisionDraftId}/submit`, {
      method: 'POST', body: { clientVersion: 4, expectedRevision: 1 }
    });
    assert.equal(resubmitted.data.status, 'pending');
    assert.equal(store.inspect('submissions')[0].review_note, '');

    const approved = await reviewer.request(`/api/review/${draftId}`, {
      method: 'POST', body: { action: 'approve', note: '' }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.status, 'approved');
    assert.equal(store.inspect('articles').length, 1);
    const publicBootstrap = await client().request('/api/bootstrap?refresh=1');
    assert.equal(publicBootstrap.data.articles[0].title, '补充后的测试投稿');
    const publicArticle = await client().request(`/api/articles/${encodeURIComponent(approved.data.slug)}?refresh=1`);
    assert.equal(publicArticle.data.article.title, '补充后的测试投稿');
    assert.equal(store.inspect('review_events').filter(event => event.submission_id === draftId).length, 2);
    assert.ok(store.inspect('contributors').find(item => item.student_id === STUDENT_ID)?.approved_at);
    assert.equal((await reviewer.request(`/api/review/${draftId}`, { method: 'POST', body: { action: 'approve' } })).status, 409);
  });
});

test('approval publishes an allowlisted persistent snapshot without changing the review workflow', async () => {
  let remoteSnapshot = fromBackup({
    formatVersion: 1,
    exportedAt: new Date(FIXED_TIME - 1000).toISOString(),
    data: { sections: fixtureData().sections, articles: [], contributors: [], teacher_additions: [] }
  });
  let saves = 0;
  const publicSnapshotStore = {
    async load() { return structuredClone(remoteSnapshot); },
    async save(snapshot) { saves += 1; remoteSnapshot = structuredClone(snapshot); return snapshot; }
  };
  const buildPublicSnapshot = data => fromBackup({ formatVersion: 1, exportedAt: new Date(FIXED_TIME).toISOString(), data });
  await useHarness({ appOptions: { publicSnapshotStore, buildPublicSnapshot } }, async ({ client }) => {
    const student = client();
    const reviewer = client();
    await student.login(STUDENT_ID);
    await reviewer.login(REVIEWER_ID);
    const draft = await student.request('/api/drafts', {
      method: 'POST', body: { clientVersion: 4, draftKey: 'new:persistent_snapshot', targetType: 'new', snapshot: validSnapshot() }
    });
    await student.request(`/api/drafts/${draft.data.draft.id}/submit`, {
      method: 'POST', body: { clientVersion: 4, expectedRevision: 1 }
    });
    const approved = await reviewer.request(`/api/review/${draft.data.draft.id}`, {
      method: 'POST', body: { action: 'approve', note: '' }
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.data.publicSnapshotSynced, true);
    assert.equal(saves, 1);
    assert.equal(remoteSnapshot.articles.length, 1);
    assert.deepEqual(Object.keys(remoteSnapshot.articles[0]).sort(), ['author_label', 'body', 'content_type', 'published_at', 'section_slug', 'slug', 'subject', 'summary', 'title', 'updated_at'].sort());
    const publicArticle = await client().request(`/api/articles/${encodeURIComponent(approved.data.slug)}?refresh=1`);
    assert.equal(publicArticle.data.article.title, '完整测试投稿');
  });
});

test('role matrix protects review, cross-owner editing and administrator operations', async () => {
  const pending = {
    id: 'submission-fixture', student_id: STUDENT_ID, section_slug: 'start', title: '权限矩阵投稿',
    summary: '这是一段用于权限矩阵验证的完整摘要', body_json: JSON.stringify(validSnapshot().body),
    content_type: '经验', subject: '权限', author_label: '测试同学', status: 'pending', review_note: '',
    created_at: '2030-01-01T00:00:00.000Z', updated_at: '2030-01-01T00:00:00.000Z'
  };
  await useHarness({ data: fixtureData({ submissions: [pending] }) }, async ({ client, store }) => {
    const anonymous = client();
    const student = client();
    const outsider = client();
    const reviewer = client();
    const admin = client();
    await student.login(STUDENT_ID);
    await outsider.login(OTHER_ID);
    await reviewer.login(REVIEWER_ID);
    await admin.login(ADMIN_ID);

    assert.equal((await anonymous.request('/api/review')).status, 401);
    assert.equal((await student.request('/api/review')).status, 403);
    assert.equal((await reviewer.request('/api/review')).status, 200);
    assert.equal((await reviewer.request('/api/admin/users')).status, 403);
    assert.equal((await admin.request('/api/review')).status, 200);
    assert.equal((await admin.request('/api/admin/users')).status, 200);

    const outsiderEdit = await outsider.request('/api/submissions/submission-fixture', {
      method: 'PUT', body: submissionInput({ title: '越权修改应当失败' })
    });
    assert.equal(outsiderEdit.status, 404);
    const adminEdit = await admin.request('/api/submissions/submission-fixture', {
      method: 'PUT', body: submissionInput({ title: '管理员校订投稿' })
    });
    assert.equal(adminEdit.status, 200);
    assert.equal(store.inspect('submissions')[0].student_id, STUDENT_ID);
    assert.ok(store.inspect('review_events').some(event => event.action === 'admin_edit'));

    const protectedAdmin = await admin.request('/api/admin/roles', {
      method: 'POST', body: { studentId: ADMIN_ID, role: 'student' }
    });
    assert.equal(protectedAdmin.status, 409);
    assert.equal((await admin.request('/api/admin/roles', {
      method: 'POST', body: { studentId: OTHER_ID, role: 'reviewer' }
    })).status, 200);
    assert.equal(store.inspect('users').find(user => user.student_id === OTHER_ID).role, 'reviewer');
  });
});

test('access codes elevate eligible users but respect administrator locks', async () => {
  await useHarness({}, async ({ client }) => {
    const eligible = client();
    const locked = client();
    await eligible.login(OTHER_ID);
    await locked.login(LOCKED_ID);
    assert.equal((await eligible.request('/api/auth/access', { method: 'POST', body: { code: 'wrong' } })).status, 403);
    const elevated = await eligible.request('/api/auth/access', { method: 'POST', body: { code: 'reviewer-fixture-code' } });
    assert.equal(elevated.data.user.role, 'reviewer');
    assert.equal((await locked.request('/api/auth/access', { method: 'POST', body: { code: 'reviewer-fixture-code' } })).status, 403);
  });
});

test('teacher supplement submission and moderated approval stay anonymous in review queues', async () => {
  await useHarness({}, async ({ client, store }) => {
    const student = client();
    const reviewer = client();
    await student.login(STUDENT_ID);
    await reviewer.login(REVIEWER_ID);
    const submitted = await student.request('/api/teacher-submissions', {
      method: 'POST', body: { name: '测试教师甲', subject: '虚构学科', motto: '仅用于本地测试' }
    });
    assert.equal(submitted.status, 201);
    const id = submitted.data.teacherSubmission.id;
    const queue = await reviewer.request('/api/review');
    assert.equal(queue.data.teacherSubmissions[0].studentId, '匿名校内成员');
    assert.equal((await reviewer.request(`/api/review/teachers/${id}`, {
      method: 'POST', body: { action: 'reject', note: '' }
    })).status, 400);
    assert.equal((await reviewer.request(`/api/review/teachers/${id}`, {
      method: 'POST', body: { action: 'approve', note: '' }
    })).data.status, 'approved');
    assert.equal(store.inspect('teacher_additions')[0].submitted_by, STUDENT_ID);
  });
});

test('database failures return bounded errors without leaking internal messages', async () => {
  await useHarness({}, async ({ client, store, errors }) => {
    const browser = client();
    const unavailable = Object.assign(new Error('secret upstream address'), {
      name: 'CloudBasePgError', code: 'UPSTREAM_UNAVAILABLE', status: 503
    });
    store.failNext('queryDocuments', 'users', unavailable);
    const loginFailure = await browser.login(STUDENT_ID);
    assert.equal(loginFailure.status, 503);
    assert.equal(loginFailure.data.error, '数据库当前请求过多，请稍后重试');
    assert.doesNotMatch(JSON.stringify(loginFailure.data), /secret upstream address/);
    assert.match(loginFailure.data.diagnostic, /CloudBasePgError:UPSTREAM_UNAVAILABLE/);

    assert.equal((await browser.login(STUDENT_ID)).status, 200);
    store.failNext('queryDocuments', 'drafts', new Error('private database detail'));
    const draftFailure = await browser.request('/api/drafts/mine');
    assert.equal(draftFailure.status, 500);
    assert.equal(draftFailure.data.error, '服务器暂时无法处理请求');
    assert.doesNotMatch(JSON.stringify(draftFailure.data), /private database detail/);
    assert.equal(errors.length, 2);
  });
});
