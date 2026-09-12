'use strict';

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { AsyncLocalStorage } = require('node:async_hooks');

const PRIMARY_KEYS = Object.freeze({
  sections: 'slug', articles: 'slug', users: 'student_id', submissions: 'id',
  review_events: 'id', contributors: 'student_id', drafts: 'id',
  teacher_submissions: 'id', teacher_additions: 'id', site_stats: 'key', site_visit_events: 'visit_id',
  // Entertainment-only game scores stay in the encrypted COS workflow.  They
  // are deliberately not part of the PostgreSQL store or public snapshot.
  game_scores: 'player_id', game_score_limits: 'bucket_id'
});
const CHUNK_SIZE = 64 * 1024;
const DEFAULT_PREFIX = 'lhwiki-workflow-v1';

function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function pathDigest(secret, value) { return crypto.createHmac('sha256', secret).update(value).digest('hex'); }
function failure(message, code, status) { const error = new Error(message); error.name = 'CosWorkflowStoreError'; error.code = code; if (status) error.status = status; return error; }

function deriveKey(secret, envId) {
  if (!secret || String(secret).length < 32) throw new Error('WORKFLOW_STORE_SECRET or SESSION_SECRET must be at least 32 characters');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(secret)), Buffer.from(`lhwiki:${envId || 'default'}`), Buffer.from('lhwiki-cos-workflow-store-v2'), 32));
}
function encrypt(value, key) {
  const compressed = zlib.gzipSync(Buffer.from(value, 'utf8'), { level: 6 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([Buffer.from('LHW2'), iv, cipher.getAuthTag(), ciphertext]);
}
function decrypt(value, key) {
  if (!Buffer.isBuffer(value) || value.subarray(0, 4).toString() !== 'LHW2' || value.length < 32) throw failure('Invalid workflow object', 'OBJECT_TAMPERED');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(4, 16));
    decipher.setAuthTag(value.subarray(16, 32));
    return zlib.gunzipSync(Buffer.concat([decipher.update(value.subarray(32)), decipher.final()])).toString('utf8');
  } catch { throw failure('Workflow object authentication failed', 'OBJECT_TAMPERED'); }
}

function tableMap(initial = {}) {
  const tables = new Map();
  for (const table of Object.keys(PRIMARY_KEYS)) {
    const rows = new Map();
    for (const row of initial[table] || []) rows.set(String(row[PRIMARY_KEYS[table]]), clone(row));
    tables.set(table, rows);
  }
  return tables;
}
function cloneTables(tables) {
  return new Map([...tables].map(([table, rows]) => [table, new Map([...rows].map(([key, row]) => [key, clone(row)]))]));
}
function stateFromTables(tables, meta = {}) {
  const state = { tables: {}, meta: clone(meta) };
  for (const [table, rows] of tables) state.tables[table] = [...rows.values()].map(clone);
  return state;
}
function tablesFromState(state) { return { tables: tableMap(state?.tables || {}), meta: clone(state?.meta || {}) }; }

function encodeChunks(state, secret) {
  const chunks = new Map();
  const output = clone(state);
  for (const rows of Object.values(output.tables || {})) for (const row of rows) {
    if (typeof row.body_json !== 'string' || Buffer.byteLength(row.body_json, 'utf8') <= CHUNK_SIZE) continue;
    const bytes = Buffer.from(row.body_json, 'utf8');
    const refs = [];
    for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
      const chunk = bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.length));
      const id = pathDigest(secret, chunk);
      refs.push(id);
      if (!chunks.has(id)) chunks.set(id, Buffer.from(chunk));
    }
    row.body_json = { chunks: refs, length: bytes.length, encoding: 'utf8' };
  }
  return { state: output, chunks };
}
async function decodeChunks(state, objectClient, prefix, key, secret) {
  const output = clone(state);
  for (const rows of Object.values(output.tables || {})) for (const row of rows) {
    const ref = row.body_json;
    if (!ref || !Array.isArray(ref.chunks)) continue;
    const parts = [];
    for (const id of ref.chunks) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw failure('Invalid workflow chunk reference', 'OBJECT_TAMPERED');
      const stored = await objectClient.download(`${prefix}/chunks/${id}.bin`);
      const chunk = Buffer.from(decrypt(stored, key), 'base64');
      if (pathDigest(secret, chunk) !== id) throw failure('Workflow chunk authentication failed', 'OBJECT_TAMPERED');
      parts.push(chunk);
    }
    const body = Buffer.concat(parts);
    if (body.length !== ref.length) throw failure('Workflow chunk length mismatch', 'OBJECT_TAMPERED');
    row.body_json = body.toString('utf8');
  }
  return output;
}

function createFakeObjectClient(initial = {}) {
  const objects = new Map(Object.entries(initial).map(([key, value]) => [key, Buffer.from(value)]));
  const stats = { uploads: 0, downloads: 0, heads: 0, lists: 0 };
  const failures = [];
  function consume(operation, path) {
    const index = failures.findIndex(item => item.operation === operation && (!item.path || item.path === path));
    if (index < 0) return;
    const [{ error }] = failures.splice(index, 1);
    throw error;
  }
  return {
    stats, objects,
    failNext(operation, path, error = failure('Injected fake COS failure', 'UPSTREAM_UNAVAILABLE', 503)) { failures.push({ operation, path, error }); },
    async upload(path, body, { forbidOverwrite = true } = {}) { consume('upload', path); if (forbidOverwrite && objects.has(path)) throw failure('Object already exists', 'OBJECT_EXISTS', 409); objects.set(path, Buffer.from(body)); stats.uploads += 1; return { path }; },
    async download(path) { consume('download', path); stats.downloads += 1; if (!objects.has(path)) throw failure('Object not found', 'OBJECT_NOT_FOUND', 404); return Buffer.from(objects.get(path)); },
    async head(path) { consume('head', path); stats.heads += 1; return objects.has(path) ? { path, size: objects.get(path).length } : null; },
    async list(prefix = '') { consume('list', prefix); stats.lists += 1; return [...objects.keys()].filter(path => path.startsWith(prefix)).sort(); },
    async listEntries(prefix = '') { consume('list', prefix); stats.lists += 1; return [...objects].filter(([path]) => path.startsWith(prefix)).map(([path, body]) => ({ path, etag: digest(body), size: body.length })).sort((a, b) => a.path.localeCompare(b.path)); },
    async remove(path) { objects.delete(path); }
  };
}

function createCosWorkflowStore({ objectClient, envId = 'lhwiki', secret, sessionSecret, workflowSecret, prefix = DEFAULT_PREFIX, initialData = {}, clock = Date.now, refreshTtlMs = 2000 } = {}) {
  if (!objectClient?.upload || !objectClient?.download || !objectClient?.list) throw new Error('COS object client is required');
  const encryptionKey = deriveKey(workflowSecret || secret || sessionSecret, envId);
  const pathSecret = Buffer.from(workflowSecret || secret || sessionSecret);
  const als = new AsyncLocalStorage();
  const initial = { tables: tableMap(initialData), meta: {} };
  let current = { tables: cloneTables(initial.tables), meta: {} };
  let loaded = false;
  let lastSyncAt = 0;
  const eventCache = new Map();

  function revisionFingerprint() {
    return digest([...eventCache]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, value]) => `${path}:${value.etag || ''}`)
      .join('\n'));
  }

  function applyEvent(event) {
    if (event.kind === 'snapshot') {
      current = tablesFromState(event.state);
      return;
    }
    if (event.kind !== 'mutation' || !Array.isArray(event.mutations)) throw failure('Invalid workflow event', 'OBJECT_TAMPERED');
    for (const mutation of event.mutations) {
      const rows = current.tables.get(mutation.table);
      if (!rows || !mutation.key) throw failure('Invalid workflow mutation', 'OBJECT_TAMPERED');
      if (mutation.row === null) rows.delete(mutation.key); else rows.set(mutation.key, clone(mutation.row));
    }
    for (const key of event.metaDelete || []) delete current.meta[key];
    for (const [key, value] of Object.entries(event.metaSet || {})) current.meta[key] = clone(value);
    const records = current.meta.idempotency || (current.meta.idempotency = {});
    for (const key of event.idempotencyDelete || []) delete records[key];
    for (const [key, value] of Object.entries(event.idempotencySet || {})) records[key] = clone(value);
  }

  async function readEvent(path) {
    const parsed = JSON.parse(decrypt(await objectClient.download(path), encryptionKey));
    if (parsed.kind === 'snapshot') parsed.state = await decodeChunks(parsed.state, objectClient, prefix, encryptionKey, pathSecret);
    else {
      const pseudo = { tables: {} };
      for (const mutation of parsed.mutations || []) if (mutation.row) (pseudo.tables[mutation.table] ||= []).push(mutation.row);
      const expanded = await decodeChunks(pseudo, objectClient, prefix, encryptionKey, pathSecret);
      const offsets = {};
      for (const mutation of parsed.mutations || []) if (mutation.row) {
        const offset = offsets[mutation.table] || 0;
        mutation.row = expanded.tables[mutation.table][offset];
        offsets[mutation.table] = offset + 1;
      }
    }
    return parsed;
  }

  async function syncEvents({ reset = false } = {}) {
    const rawEntries = objectClient.listEntries
      ? await objectClient.listEntries(`${prefix}/events/`)
      : (await objectClient.list(`${prefix}/events/`)).map(path => ({ path, etag: null }));
    const entries = rawEntries.filter(entry => entry.path.endsWith('.bin')).sort((a, b) => a.path.localeCompare(b.path));
    const listed = new Set(entries.map(entry => entry.path));
    let changed = reset || entries.length !== eventCache.size || [...eventCache.keys()].some(path => !listed.has(path));
    for (const entry of entries) {
      const cached = eventCache.get(entry.path);
      if (!cached || (entry.etag && cached.etag !== entry.etag)) {
        eventCache.set(entry.path, { etag: entry.etag, event: await readEvent(entry.path) });
        changed = true;
      }
    }
    for (const path of [...eventCache.keys()]) if (!listed.has(path)) eventCache.delete(path);
    if (changed) {
      current = { tables: cloneTables(initial.tables), meta: clone(initial.meta) };
      const ordered = [...eventCache].sort(([pathA, a], [pathB, b]) => {
        const generationA = Number.isSafeInteger(a.event.generation) ? a.event.generation : -1;
        const generationB = Number.isSafeInteger(b.event.generation) ? b.event.generation : -1;
        return generationA - generationB || Number(a.event.at || 0) - Number(b.event.at || 0) || pathA.localeCompare(pathB);
      });
      for (const [, cached] of ordered) applyEvent(cached.event);
    }
    loaded = true;
    lastSyncAt = clock();
    return current;
  }
  async function loadLatest() { return syncEvents({ reset: true }); }
  async function ensureLoaded() {
    if (!loaded) await loadLatest();
    else if (clock() - lastSyncAt >= refreshTtlMs) await syncEvents();
    return current;
  }
  function activeTx() { return als.getStore() || null; }
  function tablesForRead() { const tx = activeTx(); return tx && !tx.committed ? tx.tables : current.tables; }
  function tableFor(table) { const rows = tablesForRead().get(table); if (!rows) throw new Error(`Unknown workflow table: ${table}`); return rows; }
  function keyFor(table, row) { const key = PRIMARY_KEYS[table]; const value = row?.[key]; if (value === undefined || value === null || value === '') throw new Error(`Missing primary key ${key} for ${table}`); return String(value); }
  function matches(row, where = null) { return Object.entries(where || {}).every(([field, expected]) => expected && typeof expected === 'object' && expected.operator ? ({ eq: row[field] === expected.value, neq: row[field] !== expected.value, gt: row[field] > expected.value, gte: row[field] >= expected.value, lt: row[field] < expected.value, lte: row[field] <= expected.value }[expected.operator]) : row[field] === expected); }
  function assertUnique(table, row, replacingKey = null) {
    const key = keyFor(table, row), rows = tableFor(table);
    if (key !== replacingKey && rows.has(key)) throw failure(`Duplicate primary key for ${table}`, 'UNIQUE_VIOLATION', 409);
    if (table === 'drafts') for (const [candidateKey, candidate] of rows) if (candidateKey !== replacingKey && candidate.student_id === row.student_id && candidate.draft_key === row.draft_key) throw failure('Duplicate draft key', 'UNIQUE_VIOLATION', 409);
  }
  function markWrite() { const tx = activeTx(); if (!tx) throw failure('Workflow writes require a transaction', 'TRANSACTION_REQUIRED', 500); tx.dirty = true; }

  async function getDocument(table, id) { await ensureLoaded(); return clone(tableFor(table).get(String(id)) || null); }
  async function queryDocuments(table, where = null, limit = 100) { await ensureLoaded(); return [...tableFor(table).values()].filter(row => matches(row, where)).slice(0, limit).map(clone); }
  async function createDocument(table, data) { await ensureLoaded(); markWrite(); assertUnique(table, data); tableFor(table).set(keyFor(table, data), clone(data)); return clone(data); }
  async function setDocument(table, id, data) { await ensureLoaded(); markWrite(); const key = PRIMARY_KEYS[table], row = { ...clone(data), [key]: id }; assertUnique(table, row, String(id)); tableFor(table).set(String(id), row); }
  async function updateDocuments(table, where, data) { await ensureLoaded(); markWrite(); const rows = tableFor(table), updated = []; for (const [storedKey, existing] of [...rows]) { if (!matches(existing, where)) continue; const row = { ...existing, ...clone(data) }; assertUnique(table, row, storedKey); if (keyFor(table, row) !== storedKey) rows.delete(storedKey); rows.set(keyFor(table, row), row); updated.push(clone(row)); } return updated; }
  async function deleteDocument(table, id) { await ensureLoaded(); markWrite(); tableFor(table).delete(String(id)); }
  async function deleteDocuments(table, where) { await ensureLoaded(); markWrite(); const rows = tableFor(table), deleted = []; for (const [key, row] of [...rows]) if (matches(row, where)) { rows.delete(key); deleted.push(clone(row)); } return deleted; }

  function buildEvent(tx) {
    const mutations = [];
    for (const table of Object.keys(PRIMARY_KEYS)) {
      const before = tx.baseTables.get(table), after = tx.tables.get(table);
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const oldRow = before.get(key), newRow = after.get(key);
        if (stable(oldRow) !== stable(newRow)) mutations.push({ table, key, row: newRow === undefined ? null : clone(newRow) });
      }
    }
    const metaSet = {}, metaDelete = [];
    const beforeMeta = { ...tx.baseMeta }, afterMeta = { ...tx.meta };
    delete beforeMeta.idempotency; delete afterMeta.idempotency;
    for (const key of new Set([...Object.keys(beforeMeta), ...Object.keys(afterMeta)])) {
      if (!(key in afterMeta)) metaDelete.push(key);
      else if (stable(beforeMeta[key]) !== stable(afterMeta[key])) metaSet[key] = clone(afterMeta[key]);
    }
    const beforeIdempotency = tx.baseMeta.idempotency || {}, afterIdempotency = tx.meta.idempotency || {};
    const idempotencySet = {}, idempotencyDelete = [];
    for (const key of new Set([...Object.keys(beforeIdempotency), ...Object.keys(afterIdempotency)])) {
      if (!(key in afterIdempotency)) idempotencyDelete.push(key);
      else if (stable(beforeIdempotency[key]) !== stable(afterIdempotency[key])) idempotencySet[key] = clone(afterIdempotency[key]);
    }
    return {
      version: 2, kind: 'mutation', generation: tx.generation,
      parent: tx.baseRevision, at: clock(), mutations, metaSet, metaDelete,
      idempotencySet, idempotencyDelete
    };
  }

  async function commit(tx) {
    const event = buildEvent(tx);
    const pseudo = { tables: {} };
    for (const mutation of event.mutations) if (mutation.row) (pseudo.tables[mutation.table] ||= []).push(mutation.row);
    const encoded = encodeChunks(pseudo, pathSecret);
    const offsets = {};
    for (const mutation of event.mutations) if (mutation.row) {
      const offset = offsets[mutation.table] || 0;
      mutation.row = encoded.state.tables[mutation.table][offset];
      offsets[mutation.table] = offset + 1;
    }
    for (const [id, chunk] of encoded.chunks) {
      const path = `${prefix}/chunks/${id}.bin`;
      if (!objectClient.head || !(await objectClient.head(path))) await objectClient.upload(path, encrypt(chunk.toString('base64'), encryptionKey), { forbidOverwrite: false, acl: 'private' });
    }
    // A generation has exactly one successor object.  The dedicated workflow
    // bucket has versioning disabled, so x-cos-forbid-overwrite makes this a
    // real compare-and-create gate: concurrent writers from the same base
    // generation race for the same object name and only one can commit.
    const eventId = tx.eventKey;
    const path = `${prefix}/events/${eventId}.bin`;
    await objectClient.upload(path, encrypt(JSON.stringify(event), encryptionKey), { forbidOverwrite: true, acl: 'private' });
    await syncEvents();
    tx.committed = true;
    for (const hook of tx.afterCommit) await hook();
  }
  async function runInTransaction(fn) {
    if (activeTx()) return fn();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await syncEvents({ reset: !loaded || attempt > 0 });
      const baseRevision = revisionFingerprint();
      const tx = {
        tables: cloneTables(current.tables), baseTables: cloneTables(current.tables),
        meta: clone(current.meta), baseMeta: clone(current.meta), dirty: false,
        committed: false,
        baseRevision, generation: eventCache.size,
        eventKey: pathDigest(pathSecret, `generation:${baseRevision}`),
        afterCommit: []
      };
      try {
        return await als.run(tx, async () => {
          const value = await fn();
          if (tx.dirty) await commit(tx);
          return value;
        });
      } catch (error) {
        if (error?.code !== 'OBJECT_EXISTS' || attempt === 4) throw error;
        // Another instance advanced the generation. Reload and re-evaluate the
        // business operation against the committed state. Idempotent requests
        // replay their stored result; stale optimistic revisions return 409.
      }
    }
    throw failure('Workflow transaction retry limit exceeded', 'CONCURRENT_WRITE', 409);
  }
  function afterCommit(fn) { const tx = activeTx(); if (!tx) return false; tx.afterCommit.push(fn); return true; }
  function getInternalMeta(key) { return clone((activeTx()?.meta || current.meta)[key]); }
  function setInternalMeta(key, value) { const tx = activeTx(); if (!tx) throw failure('Workflow metadata writes require a transaction', 'TRANSACTION_REQUIRED', 500); if (value === undefined) delete tx.meta[key]; else tx.meta[key] = clone(value); tx.dirty = true; }
  function clearInternalMetaInMemory(key) { delete current.meta[key]; const tx = activeTx(); if (tx) delete tx.meta[key]; }

  async function runIdempotent({ actor = 'anonymous', method, path, key, body } = {}, fn) {
    if (!activeTx()) return runInTransaction(() => runIdempotent({ actor, method, path, key, body }, fn));
    if (!key) return fn();
    const identity = `${actor}:${String(method).toUpperCase()}:${path}:${key}`;
    const bodyHash = digest(stable(body ?? null));
    const records = activeTx().meta.idempotency || (activeTx().meta.idempotency = {});
    const previous = records[identity];
    if (previous) {
      if (previous.bodyHash !== bodyHash) return { status: 409, headers: {}, data: { error: '同一幂等键对应了不同请求', conflict: true } };
      return clone(previous.result);
    }
    const value = await fn();
    records[identity] = { bodyHash, result: clone(value), expiresAt: clock() + 30 * 86400_000 };
    for (const [recordKey, record] of Object.entries(records)) if (record.expiresAt <= clock()) delete records[recordKey];
    activeTx().dirty = true;
    return value;
  }

  function getRevision() {
    return { count: eventCache.size, hash: revisionFingerprint() };
  }

  return { afterCommit, clearInternalMetaInMemory, createDocument, deleteDocument, deleteDocuments, getDocument, getInternalMeta, getRevision, queryDocuments, setDocument, setInternalMeta, updateDocuments, runInTransaction, runIdempotent, get generation() { return eventCache.size; }, loadLatest };
}

module.exports = { CHUNK_SIZE, createCosWorkflowStore, createFakeObjectClient, decrypt, deriveKey, encrypt };
