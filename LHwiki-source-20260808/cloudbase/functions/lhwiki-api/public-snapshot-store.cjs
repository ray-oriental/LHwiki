'use strict';

const crypto = require('node:crypto');

function failure(message, code, status) {
  const error = new Error(message);
  error.name = 'PublicSnapshotStoreError';
  error.code = code;
  if (status) error.status = status;
  return error;
}

async function readJsonResponse(response, code) {
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { throw failure('Public snapshot response was not valid JSON', code, response.status); }
  if (!response.ok) throw failure('Public snapshot request failed', code, response.status);
  return data;
}

function createPublicSnapshotStore({
  objectClient,
  publicUrl,
  cloudPath = 'lhwiki-system/public-snapshot.json',
  snapshotPrefix = 'lhwiki-public-workflow-v2/snapshots',
  validate,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
} = {}) {
  if (!objectClient?.upload || !publicUrl || typeof validate !== 'function' || typeof fetchImpl !== 'function') {
    throw new Error('Public snapshot storage configuration is unavailable');
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      throw failure('Public snapshot storage is unavailable', error?.name === 'AbortError' ? 'SNAPSHOT_TIMEOUT' : 'SNAPSHOT_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function load() {
    try {
      const paths = (await objectClient.list(`${snapshotPrefix}/`)).filter(path => /\/\d{12}-[a-f0-9]{64}\.json$/.test(path)).sort();
      if (paths.length) return validate(JSON.parse((await objectClient.download(paths.at(-1))).toString('utf8')));
    } catch { /* The checked-in/CDN snapshot remains the read-only fallback. */ }
    const response = await request(publicUrl, { headers: { accept: 'application/json' }, cache: 'no-store' });
    return validate(await readJsonResponse(response, 'SNAPSHOT_DOWNLOAD_FAILED'));
  }

  async function save(snapshot, { revision } = {}) {
    const validated = validate(snapshot);
    const payload = JSON.stringify(validated);
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const count = String(Number(revision?.count || 0)).padStart(12, '0');
    try {
      await objectClient.upload(`${snapshotPrefix}/${count}-${hash}.json`, Buffer.from(payload), {
        contentType: 'application/json; charset=utf-8', forbidOverwrite: false, acl: 'public-read'
      });
      // Keep the historical fixed CDN object as a compatibility alias. It is
      // not authoritative, so a concurrent stale alias cannot lose content.
      await objectClient.upload(cloudPath, Buffer.from(payload), {
        contentType: 'application/json; charset=utf-8', forbidOverwrite: false, acl: 'public-read'
      }).catch(() => {});
    } catch (error) {
      throw failure('Public snapshot upload failed', 'SNAPSHOT_UPLOAD_FAILED', error?.status || 503);
    }
    return validated;
  }

  return { load, save };
}

module.exports = { createPublicSnapshotStore };
