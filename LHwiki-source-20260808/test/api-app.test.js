import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../cloudbase/functions/lhwiki-api/api-app.cjs');
const productionEntry = require('../cloudbase/functions/lhwiki-api/server.js');

function rejectingStore() {
  const reject = async () => { throw new Error('store must not be called'); };
  return {
    createDocument: reject,
    deleteDocument: reject,
    deleteDocuments: reject,
    getDocument: reject,
    queryDocuments: reject,
    setDocument: reject,
    updateDocuments: reject
  };
}

async function withServer(app, callback) {
  const server = http.createServer(app.handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('production entry can be imported without CloudBase credentials or opening a port', () => {
  assert.equal(typeof productionEntry.createProductionApp, 'function');
  assert.equal(typeof productionEntry.startServer, 'function');
});

test('createApp requires an injected store', () => {
  assert.throws(() => createApp(), /API store is required/);
});

test('injected maintenance configuration blocks private routes before store access', async () => {
  const app = createApp({
    store: rejectingStore(),
    sessionSecret: 'local-test-session-secret-at-least-32-characters',
    emergencyMaintenance: true,
    maintenanceReviewDate: '2099-12-31',
    publicSnapshot: { sections: [], articles: [], contributors: [], teacherAdditions: [] },
    logger: { error() {} }
  });
  await withServer(app, async origin => {
    const health = await fetch(`${origin}/api/health`).then(response => response.json());
    assert.deepEqual(health, {
      ok: true,
      database: 'suspended-by-application',
      maintenance: true,
      reviewDate: '2099-12-31',
      platform: 'cloudbase',
      region: 'ap-shanghai'
    });
    const blocked = await fetch(`${origin}/api/drafts/mine`);
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).maintenance, true);
    const login = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ studentId: '209900001' })
    });
    assert.equal(login.status, 503);
    assert.equal((await login.json()).maintenance, true);
    const session = await fetch(`${origin}/api/session`).then(response => response.json());
    assert.deepEqual(session, { user: null, maintenance: true, reviewDate: '2099-12-31' });
    const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { origin } });
    assert.equal(logout.status, 200);
    assert.equal((await logout.json()).maintenance, true);
    const bootstrap = await fetch(`${origin}/api/bootstrap`);
    assert.equal(bootstrap.status, 200);
    assert.deepEqual((await bootstrap.json()).sections, []);
  });
});

test('production-style public routes load the object-storage snapshot without PostgreSQL access', async () => {
  let loads = 0;
  const snapshot = {
    schemaVersion: 1,
    generatedAt: '2030-01-02T03:04:05.000Z',
    sections: [{ slug: 'start', title: '开始', description: '公开快照', icon: '书', sort_order: 1 }],
    articles: [{
      slug: 'snapshot-article', section_slug: 'start', title: '快照文章', summary: '来自对象存储的公开摘要',
      content_type: '说明', subject: '测试', author_label: '测试组', published_at: '2030-01-01T00:00:00.000Z',
      updated_at: '2030-01-01T00:00:00.000Z', body: [{ type: 'paragraph', text: '对象存储正文' }]
    }],
    contributors: [],
    teacherAdditions: []
  };
  const app = createApp({
    store: rejectingStore(),
    sessionSecret: 'local-test-session-secret-at-least-32-characters',
    emergencyMaintenance: false,
    publicSnapshot: { sections: [], articles: [], contributors: [], teacherAdditions: [] },
    publicSnapshotStore: { async load() { loads += 1; return structuredClone(snapshot); } },
    logger: { error() {} }
  });
  await withServer(app, async origin => {
    const bootstrap = await fetch(`${origin}/api/bootstrap`).then(response => response.json());
    assert.equal(bootstrap.sections[0].slug, 'start');
    assert.equal(bootstrap.articles[0].slug, 'snapshot-article');
    assert.equal(Object.hasOwn(bootstrap.articles[0], 'body'), false);
    const article = await fetch(`${origin}/api/articles/snapshot-article`).then(response => response.json());
    assert.equal(article.article.body[0].text, '对象存储正文');
    assert.equal(loads, 1);
  });
});

test('handler configuration is instance-local and validates the injected session secret', async () => {
  const app = createApp({
    store: rejectingStore(),
    emergencyMaintenance: false,
    sessionSecret: '',
    logger: { error() {} }
  });
  await withServer(app, async origin => {
    const response = await fetch(`${origin}/api/health`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, '服务端尚未配置 SESSION_SECRET');
  });
});
