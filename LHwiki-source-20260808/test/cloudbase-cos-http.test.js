import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createCloudBaseCosHttpClient, signCosRequest } = require('../cloudbase/functions/lhwiki-api/cloudbase-cos-http.cjs');
const fixed = Date.parse('2026-09-09T10:00:00.000Z');

function response(status, body = '') {
  return new Response(body, { status, headers: { etag: 'fixture-etag', 'content-length': String(Buffer.byteLength(body)) } });
}

test('COS signature is deterministic, signs the host and never contains the secret key', () => {
  const input = { secretId: 'AKIDfixture', secretKey: 'fixture-secret-never-log', method: 'GET', pathname: '/a/b.bin', headers: { host: 'bucket-1.cos.ap-shanghai.myqcloud.com', date: 'Wed, 09 Sep 2026 10:00:00 GMT' }, now: fixed };
  const first = signCosRequest(input);
  assert.equal(first, signCosRequest(input));
  assert.match(first, /q-header-list=date;host/);
  assert.doesNotMatch(first, /fixture-secret-never-log/);
  assert.notEqual(first, signCosRequest({ ...input, pathname: '/a/c.bin' }));
});

test('direct COS client signs immutable private PUT and maps conflicts', async () => {
  const calls = [];
  const client = createCloudBaseCosHttpClient({
    bucket: 'fixture-bucket-1234567890', region: 'ap-shanghai', secretId: 'AKIDfixture', secretKey: 'fixture-secret-never-log', clock: () => fixed,
    async fetchImpl(url, options) { calls.push({ url, options }); return response(409); }
  });
  await assert.rejects(client.upload('lhwiki-workflow-v1/generations/1.bin', Buffer.from('data')), error => error.code === 'OBJECT_EXISTS' && error.status === 409);
  assert.equal(calls[0].options.method, 'PUT');
  assert.equal(calls[0].options.headers['x-cos-forbid-overwrite'], 'true');
  assert.equal(calls[0].options.headers['x-cos-acl'], 'private');
  assert.match(calls[0].options.headers.authorization, /q-header-list=.*host/);
  assert.doesNotMatch(JSON.stringify(calls[0]), /fixture-secret-never-log/);
});

test('direct COS client downloads and maps missing objects without retrying', async () => {
  let calls = 0;
  const client = createCloudBaseCosHttpClient({
    bucket: 'fixture-bucket-1234567890', secretId: 'AKIDfixture', secretKey: 'secret', clock: () => fixed,
    async fetchImpl() { calls += 1; return response(404); }
  });
  await assert.rejects(client.download('lhwiki-workflow-v1/missing.bin'), error => error.code === 'OBJECT_NOT_FOUND');
  assert.equal(await client.head('lhwiki-workflow-v1/missing.bin'), null);
  assert.equal(calls, 2);
});

test('direct COS client lists every page with signed query parameters', async () => {
  const urls = [];
  const client = createCloudBaseCosHttpClient({
    bucket: 'fixture-bucket-1234567890', secretId: 'AKIDfixture', secretKey: 'secret', clock: () => fixed,
    async fetchImpl(url, options) {
      urls.push(String(url));
      assert.match(options.headers.authorization, /q-url-param-list=/);
      if (urls.length === 1) return response(200, '<ListBucketResult><IsTruncated>true</IsTruncated><NextMarker>p/a.bin</NextMarker><Contents><Key>p/a.bin</Key></Contents></ListBucketResult>');
      return response(200, '<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>p/b.bin</Key></Contents></ListBucketResult>');
    }
  });
  assert.deepEqual(await client.list('p/'), ['p/a.bin', 'p/b.bin']);
  assert.match(urls[1], /marker=p%2Fa.bin/);
});

test('direct COS client rejects a non-advancing pagination marker', async () => {
  let calls = 0;
  const client = createCloudBaseCosHttpClient({
    bucket: 'fixture-bucket-1234567890', secretId: 'AKIDfixture', secretKey: 'secret', clock: () => fixed,
    async fetchImpl() {
      calls += 1;
      return response(200, '<ListBucketResult><IsTruncated>true</IsTruncated><NextMarker>same</NextMarker><Contents><Key>p/a.bin</Key><ETag>"x"</ETag><Size>1</Size></Contents></ListBucketResult>');
    }
  });
  await assert.rejects(client.list('p/'), error => error.code === 'LIST_INVALID');
  assert.equal(calls, 2);
});
