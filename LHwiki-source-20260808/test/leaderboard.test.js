import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createApp } = require('../cloudbase/functions/lhwiki-api/api-app.cjs');
const { createMemoryStore } = require('./helpers/memory-store.cjs');

const SECRET = 'lhwiki-leaderboard-test-session-secret-0001';

function scoreStore(initial = []) {
  const base = createMemoryStore({ sections: [{ slug: 'start' }] });
  const scores = new Map(initial.map(row => [row.player_id, structuredClone(row)]));
  const limits = new Map();
  return {
    ...base,
    async runInTransaction(work) { return work(); },
    async runIdempotent(_options, work) { return work(); },
    getInternalMeta(key) { return key === 'pendingPublicSnapshot' ? { reason: 'test-pending' } : undefined; },
    async getDocument(table, id) {
      if (table === 'game_scores') return structuredClone(scores.get(String(id)) || null);
      if (table === 'game_score_limits') return structuredClone(limits.get(String(id)) || null);
      return base.getDocument(table, id);
    },
    async queryDocuments(table, where, limit) {
      if (table === 'game_scores') return [...scores.values()].slice(0, limit || 100).map(row => structuredClone(row));
      if (table === 'game_score_limits') return [...limits.values()].slice(0, limit || 100).map(row => structuredClone(row));
      return base.queryDocuments(table, where, limit);
    },
    async setDocument(table, id, data) {
      if (table === 'game_scores') { scores.set(String(id), structuredClone({ ...data, player_id: id })); return; }
      if (table === 'game_score_limits') { limits.set(String(id), structuredClone({ ...data, bucket_id: id })); return; }
      return base.setDocument(table, id, data);
    },
    async deleteDocument(table, id) {
      if (table === 'game_scores') { scores.delete(String(id)); return; }
      if (table === 'game_score_limits') { limits.delete(String(id)); return; }
      return base.deleteDocument(table, id);
    },
    inspectScores() { return [...scores.values()].map(row => structuredClone(row)); },
    inspectLimits() { return [...limits.values()].map(row => structuredClone(row)); }
  };
}

async function withServer(options, callback) {
  const store = options.store || scoreStore();
  const app = createApp({
    store,
    sessionSecret: SECRET,
    emergencyMaintenance: false,
    publicSnapshot: { sections: [], articles: [], contributors: [], teacherAdditions: [] },
    clock: () => Date.parse('2030-01-02T03:04:05.000Z'),
    logger: { error() {} },
    ...options
  });
  const server = http.createServer(app.handler);
  await new Promise((resolve, reject) => { server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await callback({ origin, store }); } finally { await new Promise(resolve => server.close(resolve)); }
}

async function request(origin, path, body, options = {}) {
  const mutationHeaders = {
    origin,
    'content-type': 'application/json',
    'idempotency-key': options.idempotencyKey || crypto.randomUUID(),
    ...(options.forwardedFor ? { 'x-forwarded-for': options.forwardedFor } : {})
  };
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : mutationHeaders,
    body: body === undefined ? undefined : options.rawBody ?? JSON.stringify(body)
  });
  return { status: response.status, headers: response.headers, data: await response.json() };
}

test('public leaderboard reads COS workflow data and orders top ten without snapshot sync', async () => {
  const store = scoreStore([
    { player_id: 'player-low-00000001', display_name: '低分', score: 20, luhe_count: 1, achieved_at: '2030-01-01T00:00:00.000Z' },
    { player_id: 'player-high-0000001', display_name: '高分', score: 200, luhe_count: 2, achieved_at: '2030-01-02T00:00:00.000Z' }
  ]);
  let snapshotSaves = 0;
  await withServer({ store, publicSnapshotStore: { async save() { snapshotSaves += 1; } } }, async ({ origin }) => {
    const response = await request(origin, '/api/games/great-luhe/leaderboard');
    assert.equal(response.status, 200);
    assert.deepEqual(response.data.scores.map(item => item.name), ['高分', '低分']);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=1800, stale-while-revalidate=3600');
    assert.equal(snapshotSaves, 0);
  });
});

test('score upload is opt-in, validates fields, and only replaces a device PB', async () => {
  await withServer({}, async ({ origin, store }) => {
    const first = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-test-00000001', displayName: '潞园同学', score: 120, luheCount: 1
    });
    assert.equal(first.status, 200);
    const lower = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-test-00000001', displayName: '不应覆盖', score: 100, luheCount: 4
    });
    assert.equal(lower.status, 200);
    assert.equal(store.inspectScores()[0].display_name, '潞园同学');
    assert.equal(store.inspectScores()[0].score, 120);
    const invalid = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-test-00000002', displayName: '', score: 80, luheCount: 1
    });
    assert.equal(invalid.status, 400);
    const noLuhe = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-test-00000003', displayName: '无潞河', score: 80, luheCount: 0
    });
    assert.equal(noLuhe.status, 400);
    const injected = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-test-00000004', displayName: '<img src=x>', score: 80, luheCount: 1
    });
    assert.equal(injected.status, 400);
  });
});

test('score upload never rebuilds the public article snapshot', async () => {
  let snapshotSaves = 0;
  await withServer({
    publicSnapshotStore: { async save() { snapshotSaves += 1; } },
    buildPublicSnapshot() { return { sections: [], articles: [], contributors: [], teacherAdditions: [] }; }
  }, async ({ origin }) => {
    const response = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-snapshot-00001', displayName: '快照隔离', score: 180, luheCount: 1
    });
    assert.equal(response.status, 200);
    assert.equal(snapshotSaves, 0);
  });
});

test('malicious writes are bounded across function instances and active score rows', async () => {
  const store = scoreStore(Array.from({ length: 100 }, (_, index) => ({
    player_id: `existing-player-${String(index).padStart(4, '0')}`,
    display_name: `玩家${index}`,
    score: 1000 + index,
    luhe_count: 1,
    achieved_at: `2030-01-01T00:${String(index % 60).padStart(2, '0')}:00.000Z`
  })));
  const send = async (origin, index) => request(origin, '/api/games/great-luhe/leaderboard', {
    playerId: `attacker-player-${String(index).padStart(4, '0')}`,
    displayName: `挑战者${index}`,
    score: 5000 + index,
    luheCount: 1
  }, { forwardedFor: '203.0.113.8' });
  await withServer({ store }, async ({ origin }) => {
    for (let index = 0; index < 5; index += 1) assert.equal((await send(origin, index)).status, 200);
  });
  await withServer({ store }, async ({ origin }) => {
    for (let index = 5; index < 8; index += 1) assert.equal((await send(origin, index)).status, 200);
  });
  await withServer({ store }, async ({ origin }) => {
    assert.equal((await send(origin, 8)).status, 429);
  });
  assert.equal(store.inspectScores().length, 100);
  assert.ok(store.inspectLimits().some(row => row.bucket_id.startsWith('ip:2030-01-02:') && row.count === 8));
  assert.equal(store.inspectLimits().find(row => row.bucket_id === 'global:2030-01-02')?.count, 8);
});

test('leaderboard rejects oversized bodies before business writes', async () => {
  const store = scoreStore();
  await withServer({ store }, async ({ origin }) => {
    const response = await request(origin, '/api/games/great-luhe/leaderboard', {}, {
      rawBody: JSON.stringify({ filler: 'x'.repeat(3000) })
    });
    assert.equal(response.status, 413);
    assert.equal(store.inspectScores().length, 0);
    assert.equal(store.inspectLimits().length, 0);
  });
});

test('maintenance guard keeps leaderboard public but blocks writes', async () => {
  await withServer({ emergencyMaintenance: true }, async ({ origin }) => {
    assert.equal((await request(origin, '/api/games/great-luhe/leaderboard')).status, 200);
    const blocked = await request(origin, '/api/games/great-luhe/leaderboard', {
      playerId: 'player-test-00000004', displayName: '维护测试', score: 80, luheCount: 1
    });
    assert.equal(blocked.status, 503);
  });
});
