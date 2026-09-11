const productionOrigins = new Set([
  'https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com',
  'https://lhwiki-lhwiki-d9g6r8vfzc7be1c0a.webapps.tcloudbase.com'
]);
const origin = (process.env.LHWIKI_ORIGIN || 'http://127.0.0.1:9000').replace(/\/$/, '');
const studentId = process.env.LHWIKI_SMOKE_LOGIN_ID;
const draftClientVersion = 4;
if (!studentId) throw new Error('Set LHWIKI_SMOKE_LOGIN_ID to an authorized test account');
if (productionOrigins.has(origin) && process.env.LHWIKI_ALLOW_PRODUCTION_WRITES !== 'I_UNDERSTAND_THIS_WRITES_PRODUCTION') {
  throw new Error('Production functional smoke is write-capable and disabled by default; use local integration tests instead');
}

let cookie = '';
async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
      ...options.headers
    },
    body: options.body === undefined || typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10000)
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';', 1)[0];
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${data.error || ''}`.trim());
  return data;
}

const draftKey = `new:smoke_${Date.now()}`;
let draftId;
try {
  const login = await request('/api/auth/login', { method: 'POST', body: { studentId } });
  if (!login.user) throw new Error('login did not return a user');
  const session = await request('/api/session');
  if (!session.user) throw new Error('session cookie was not accepted');
  const created = await request('/api/drafts', {
    method: 'POST',
    body: {
      clientVersion: draftClientVersion,
      draftKey,
      targetType: 'new',
      snapshot: { body: [], title: '', summary: '', sectionSlug: '', contentType: '', subject: '', authorLabel: '', anonymous: true }
    }
  });
  draftId = created.draft?.id;
  if (!draftId || created.draft.revision !== 1) throw new Error('draft create contract invalid');
  const updated = await request(`/api/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PUT',
    body: {
      clientVersion: draftClientVersion,
      expectedRevision: 1,
      snapshot: { body: [{ type: 'paragraph', text: '稳定性巡检临时草稿' }], title: '', summary: '', sectionSlug: '', contentType: '', subject: '', authorLabel: '', anonymous: true }
    }
  });
  if (updated.draft?.revision !== 2) throw new Error('draft optimistic revision did not advance');
  await request(`/api/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
  draftId = null;
  console.log(JSON.stringify({ ok: true, origin, checks: ['login', 'session', 'draft-create', 'draft-update', 'draft-delete'] }, null, 2));
} finally {
  if (draftId) await request(`/api/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }).catch(() => {});
  if (cookie) await request('/api/auth/logout', { method: 'POST' }).catch(() => {});
}
