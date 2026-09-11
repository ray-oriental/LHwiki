import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { CHUNK_SIZE, createCosWorkflowStore, createFakeObjectClient } = require('../cloudbase/functions/lhwiki-api/cos-workflow-store.cjs');

const secret = 'test-workflow-secret-which-is-long-enough-123456';

test('COS workflow store encrypts, chunks, deduplicates and round-trips rows', async () => {
  const objects = createFakeObjectClient();
  const store = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  const body = 'x'.repeat(CHUNK_SIZE + 10);
  await store.runInTransaction(() => store.setDocument('articles', 'a', { slug: 'a', body_json: body }));
  const firstUploads = objects.stats.uploads;
  await store.runInTransaction(() => store.setDocument('articles', 'b', { slug: 'b', body_json: body }));
  assert.equal((await store.getDocument('articles', 'a')).body_json, body);
  assert.equal((await store.getDocument('articles', 'b')).body_json, body);
  // The second mutation needs one event object, not a duplicate body chunk.
  assert.equal(objects.stats.uploads - firstUploads, 1);
  assert.equal([...objects.objects.keys()].filter(key => key.includes('/events/')).length, 2);
});

test('concurrent writers serialize through one create-only generation and both operations survive', async () => {
  const base = createFakeObjectClient();
  const first = createCosWorkflowStore({ objectClient: base, envId: 'test', secret });
  const second = createCosWorkflowStore({ objectClient: base, envId: 'test', secret });
  await first.runInTransaction(() => first.setDocument('sections', 's', { slug: 's', title: 'one' }));
  await second.getDocument('sections', 's');
  await Promise.all([
    first.runInTransaction(() => first.setDocument('sections', 'a', { slug: 'a', title: 'a' })),
    second.runInTransaction(() => second.setDocument('sections', 'b', { slug: 'b', title: 'b' }))
  ].map(p => p.catch(error => error)));
  assert.equal([...base.objects.keys()].filter(key => key.includes('/events/')).length, 3);
  const recovered = createCosWorkflowStore({ objectClient: base, envId: 'test', secret });
  assert.equal((await recovered.getDocument('sections', 'a')).title, 'a');
  assert.equal((await recovered.getDocument('sections', 'b')).title, 'b');
});

test('concurrent optimistic updates from the same revision produce one winner and one conflict', async () => {
  const objects = createFakeObjectClient();
  const first = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  const second = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  await first.runInTransaction(() => first.setDocument('drafts', 'd', { id: 'd', student_id: 'student', revision: 1, title: 'base' }));
  await second.getDocument('drafts', 'd');
  async function update(store, title) {
    return store.runInTransaction(async () => {
      const draft = await store.getDocument('drafts', 'd');
      if (draft.revision !== 1) return { status: 409 };
      await store.setDocument('drafts', 'd', { ...draft, revision: 2, title });
      return { status: 200 };
    });
  }
  const results = await Promise.all([update(first, 'first'), update(second, 'second')]);
  assert.deepEqual(results.map(item => item.status).sort(), [200, 409]);
  const recovered = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  assert.equal((await recovered.getDocument('drafts', 'd')).revision, 2);
  assert.equal([...objects.objects.keys()].filter(key => key.includes('/events/')).length, 2);
});

test('idempotency replays same request and rejects same key with another body', async () => {
  const objects = createFakeObjectClient();
  const store = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  const request = { actor: 'student', method: 'POST', path: '/api/x', key: 'key-1', body: { value: 1 } };
  const first = await store.runInTransaction(() => store.runIdempotent(request, async () => {
    await store.setDocument('sections', 's', { slug: 's', title: 'one' });
    return { status: 201, headers: {}, data: { ok: true } };
  }));
  const second = await store.runInTransaction(() => store.runIdempotent(request, async () => { throw new Error('must replay'); }));
  assert.deepEqual(second, first);
  const conflict = await store.runInTransaction(() => store.runIdempotent({ ...request, body: { value: 2 } }, async () => null));
  assert.equal(conflict.status, 409);
});

test('after-commit work never runs before the immutable generation wins', async () => {
  const objects = createFakeObjectClient();
  const store = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  const order = [];
  const originalUpload = objects.upload;
  objects.upload = async (...args) => { const result = await originalUpload(...args); if (args[0].includes('/events/')) order.push('event'); return result; };
  await store.runInTransaction(async () => {
    await store.setDocument('sections', 's', { slug: 's', title: 'one' });
    store.afterCommit(async () => { order.push('published'); });
  });
  assert.deepEqual(order, ['event', 'published']);
});

test('a stale writer merges its mutation with events committed elsewhere', async () => {
  const objects = createFakeObjectClient();
  const first = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  const stale = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  await first.runInTransaction(() => first.setDocument('sections', 'base', { slug: 'base', title: 'base' }));
  await stale.getDocument('sections', 'base');
  await first.runInTransaction(() => first.setDocument('sections', 'winner', { slug: 'winner', title: 'winner' }));
  await stale.runInTransaction(() => stale.setDocument('sections', 'loser', { slug: 'loser', title: 'loser' }));
  assert.equal((await stale.getDocument('sections', 'winner')).title, 'winner');
  assert.equal((await stale.getDocument('sections', 'loser')).title, 'loser');
});

test('generation order stays deterministic when function instance clocks are skewed', async () => {
  const objects = createFakeObjectClient();
  const ahead = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret, clock: () => 9_000 });
  const behind = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret, clock: () => 1_000 });
  await ahead.runInTransaction(() => ahead.setDocument('sections', 's', { slug: 's', title: 'first', revision: 1 }));
  await behind.runInTransaction(async () => {
    const row = await behind.getDocument('sections', 's');
    await behind.setDocument('sections', 's', { ...row, title: 'second', revision: 2 });
  });
  const recovered = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  assert.deepEqual(await recovered.getDocument('sections', 's'), { slug: 's', title: 'second', revision: 2 });
});

test('same idempotency key recovers after event PUT succeeds but LIST fails', async () => {
  const objects = createFakeObjectClient();
  const store = createCosWorkflowStore({ objectClient: objects, envId: 'test', secret });
  const originalList = objects.listEntries;
  let lists = 0;
  objects.listEntries = async prefix => {
    lists += 1;
    if (lists === 2) throw Object.assign(new Error('temporary list failure'), { code: 'UPSTREAM_UNAVAILABLE' });
    return originalList(prefix);
  };
  const request = { actor: 'student', method: 'POST', path: '/api/x', key: 'recover-key', body: { value: 1 } };
  await assert.rejects(store.runInTransaction(() => store.runIdempotent(request, async () => {
    await store.setDocument('sections', 'once', { slug: 'once', title: 'once' });
    return { status: 201, headers: {}, data: { ok: true } };
  })), /temporary list failure/);
  assert.equal([...objects.objects.keys()].filter(key => key.includes('/events/')).length, 1);
  const replay = await store.runInTransaction(() => store.runIdempotent(request, async () => { throw new Error('must not execute twice'); }));
  assert.equal(replay.status, 201);
  assert.equal([...objects.objects.keys()].filter(key => key.includes('/events/')).length, 1);
  assert.equal((await store.getDocument('sections', 'once')).title, 'once');
});
