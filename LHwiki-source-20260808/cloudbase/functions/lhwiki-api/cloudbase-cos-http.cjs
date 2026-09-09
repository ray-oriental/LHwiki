'use strict';

const crypto = require('node:crypto');

function cosFailure(message, code, status, cause) {
  const error = new Error(message);
  error.name = 'CloudBaseCosError';
  error.code = code;
  if (status) error.status = status;
  if (cause) error.cause = cause;
  return error;
}

function encode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}
function sha1(value) { return crypto.createHash('sha1').update(value).digest('hex'); }
function hmac(key, value) { return crypto.createHmac('sha1', key).update(value).digest('hex'); }

function canonicalHeaders(headers) {
  const entries = Object.entries(headers)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    list: entries.map(([key]) => key).join(';'),
    value: entries.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&')
  };
}

function canonicalQuery(query = {}) {
  const entries = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key.toLowerCase(), String(value)])
    .sort(([a], [b]) => a.localeCompare(b));
  return { list: entries.map(([key]) => key).join(';'), value: entries.map(([key, value]) => `${encode(key)}=${encode(value)}`).join('&') };
}

function signCosRequest({ secretId, secretKey, method, pathname, headers, query = {}, now = Date.now(), expiresSeconds = 900 }) {
  const start = Math.floor(Number(now) / 1000) - 1;
  const keyTime = `${start};${start + expiresSeconds}`;
  const signed = canonicalHeaders(headers);
  const signedQuery = canonicalQuery(query);
  const httpString = `${String(method).toLowerCase()}\n${pathname}\n${signedQuery.value}\n${signed.value}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha1(httpString)}\n`;
  const signature = hmac(hmac(secretKey, keyTime), stringToSign);
  return [
    'q-sign-algorithm=sha1', `q-ak=${encode(secretId)}`, `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`, `q-header-list=${signed.list}`, `q-url-param-list=${signedQuery.list}`, `q-signature=${signature}`
  ].join('&');
}

function validPath(path) {
  return typeof path === 'string' && /^[a-zA-Z0-9._/-]{1,1024}$/.test(path) && !path.includes('..') && !path.startsWith('/');
}

function createCloudBaseCosHttpClient({
  bucket,
  region = 'ap-shanghai',
  secretId,
  secretKey,
  securityToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  clock = Date.now
} = {}) {
  if (!bucket || !region || !secretId || !secretKey || typeof fetchImpl !== 'function') {
    throw new Error('Direct COS storage configuration is unavailable');
  }
  if (!/^[a-z0-9-]+-\d+$/.test(bucket) || !/^[a-z0-9-]+$/.test(region)) throw new Error('Invalid COS bucket or region');
  const host = `${bucket}.cos.${region}.myqcloud.com`;

  function objectId(path) {
    if (!validPath(path)) throw new Error('Invalid COS object path');
    return `cos://${bucket}/${path}`;
  }

  async function request(path, method, body = null, extraHeaders = {}, query = {}) {
    if (path) objectId(path);
    const pathname = path ? `/${path.split('/').map(encode).join('/')}` : '/';
    const payload = body === null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const headers = {
      host,
      date: new Date(clock()).toUTCString(),
      ...(securityToken ? { 'x-cos-security-token': securityToken } : {}),
      ...extraHeaders,
      ...(payload === null ? {} : { 'content-length': String(payload.length) })
    };
    headers.authorization = signCosRequest({ secretId, secretKey, method, pathname, headers, query, now: clock() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const queryString = canonicalQuery(query).value;
      return await fetchImpl(`https://${host}${pathname}${queryString ? `?${queryString}` : ''}`, { method, headers, body: payload, signal: controller.signal });
    } catch (error) {
      throw cosFailure('COS request unavailable', error?.name === 'AbortError' ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', 503, error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function upload(path, body, { contentType = 'application/octet-stream', forbidOverwrite = true, acl = 'private' } = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const response = await request(path, 'PUT', payload, {
      'content-md5': crypto.createHash('md5').update(payload).digest('base64'),
      'content-type': contentType,
      ...(forbidOverwrite ? { 'x-cos-forbid-overwrite': 'true' } : {}),
      ...(acl ? { 'x-cos-acl': acl } : {})
    });
    if (!response.ok) {
      const code = response.status === 409 || response.status === 412 ? 'OBJECT_EXISTS' : 'UPLOAD_FAILED';
      throw cosFailure('COS upload failed', code, response.status);
    }
    return { path, objectId: objectId(path), etag: response.headers?.get?.('etag') || null };
  }

  async function download(path) {
    const response = await request(path, 'GET', null, { accept: 'application/octet-stream' });
    if (!response.ok) throw cosFailure('COS download failed', response.status === 404 ? 'OBJECT_NOT_FOUND' : 'DOWNLOAD_FAILED', response.status);
    return Buffer.from(await response.arrayBuffer());
  }

  async function head(path) {
    const response = await request(path, 'HEAD');
    if (response.status === 404) return null;
    if (!response.ok) throw cosFailure('COS head failed', 'HEAD_FAILED', response.status);
    return { path, size: Number(response.headers?.get?.('content-length') || 0), etag: response.headers?.get?.('etag') || null };
  }

  function xmlText(value) {
    return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  }

  async function listEntries(prefix) {
    if (!validPath(prefix)) throw new Error('Invalid COS list prefix');
    const entries = [];
    let marker;
    let previousMarker = null;
    for (let page = 0; page < 100; page += 1) {
      const response = await request('', 'GET', null, { accept: 'application/xml' }, { prefix, 'max-keys': 1000, ...(marker ? { marker } : {}) });
      if (!response.ok) throw cosFailure('COS list failed', 'LIST_FAILED', response.status);
      const xml = await response.text();
      const pageEntries = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(match => {
        const block = match[1];
        return {
          path: xmlText(block.match(/<Key>([\s\S]*?)<\/Key>/)?.[1]),
          etag: xmlText(block.match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1]).replace(/^"|"$/g, ''),
          size: Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0)
        };
      }).filter(entry => entry.path);
      entries.push(...pageEntries);
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) return entries;
      marker = xmlText(xml.match(/<NextMarker>([\s\S]*?)<\/NextMarker>/)?.[1] || pageEntries.at(-1)?.path);
      if (!marker || marker === previousMarker) throw cosFailure('COS list pagination was incomplete', 'LIST_INVALID');
      previousMarker = marker;
    }
    throw cosFailure('COS list exceeded the bounded page limit', 'LIST_LIMIT_EXCEEDED');
  }

  async function remove(path) {
    const response = await request(path, 'DELETE');
    if (!response.ok && response.status !== 404) throw cosFailure('COS delete failed', 'DELETE_FAILED', response.status);
  }

  async function list(prefix) { return (await listEntries(prefix)).map(entry => entry.path); }

  return { upload, download, head, list, listEntries, remove, objectId };
}

module.exports = { canonicalHeaders, canonicalQuery, createCloudBaseCosHttpClient, cosFailure, signCosRequest };
