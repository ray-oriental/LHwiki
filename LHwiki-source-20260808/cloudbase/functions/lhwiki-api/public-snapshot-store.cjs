'use strict';

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
  envId,
  apiKey,
  publicUrl,
  cloudPath = 'lhwiki-system/public-snapshot.json',
  validate,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
} = {}) {
  if (!envId || !apiKey || !publicUrl || typeof validate !== 'function' || typeof fetchImpl !== 'function') {
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
    const response = await request(publicUrl, { headers: { accept: 'application/json' }, cache: 'no-store' });
    return validate(await readJsonResponse(response, 'SNAPSHOT_DOWNLOAD_FAILED'));
  }

  async function save(snapshot) {
    const validated = validate(snapshot);
    const payload = JSON.stringify(validated);
    const infoResponse = await request(`https://${envId}.api.tcloudbasegateway.com/v1/storages/get-objects-upload-info`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify([{ objectId: cloudPath }])
    });
    const info = await readJsonResponse(infoResponse, 'SNAPSHOT_UPLOAD_INFO_FAILED');
    const target = Array.isArray(info) ? info[0] : null;
    if (!target?.uploadUrl || !target?.authorization || !target?.token || !target?.cloudObjectMeta || target.code) {
      throw failure('Public snapshot upload information was incomplete', 'SNAPSHOT_UPLOAD_INFO_INVALID');
    }
    const uploadResponse = await request(target.uploadUrl, {
      method: 'PUT',
      headers: {
        authorization: target.authorization,
        'content-type': 'application/json; charset=utf-8',
        'x-cos-security-token': target.token,
        'x-cos-meta-fileid': target.cloudObjectMeta
      },
      body: payload
    });
    if (!uploadResponse.ok) throw failure('Public snapshot upload failed', 'SNAPSHOT_UPLOAD_FAILED', uploadResponse.status);
    return validated;
  }

  return { load, save };
}

module.exports = { createPublicSnapshotStore };
