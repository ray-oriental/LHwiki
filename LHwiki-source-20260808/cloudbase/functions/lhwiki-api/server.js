'use strict';

const http = require('node:http');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createPgStore } = require('./pg-store.cjs');
const {
  ADMIN_LOGIN_ID,
  CONTENT_TYPES,
  KNOWN_TEACHER_NAMES,
  normalizeText,
  parseDocument,
  parseDraftDocument,
  slugify,
  validLoginId,
  validStudentId
} = require('./content.cjs');

const COOKIE = 'campus_session';
const VISIT_TRACKING_START = Date.parse('2026-08-10T00:00:00+08:00');
const PUBLIC_CACHE_TTL = 2 * 60_000;
const encoder = new TextEncoder();
const migrationPath = join(__dirname, 'migration-data.private.json');
const seed = JSON.parse(readFileSync(existsSync(migrationPath) ? migrationPath : join(__dirname, 'seed-data.json'), 'utf8'));
if (!process.env.TCB_ENV || !process.env.CLOUDBASE_APIKEY) {
  throw new Error('Missing TCB_ENV or CLOUDBASE_APIKEY');
}
const {
  createDocument,
  deleteDocument,
  deleteDocuments,
  getDocument,
  queryDocuments,
  setDocument,
  updateDocuments
} = createPgStore({
  envId: process.env.TCB_ENV,
  apiKey: process.env.CLOUDBASE_APIKEY
});
let seedPromise;
let publicCache = null;
const mutationWindows = new Map();

function now() {
  return new Date().toISOString();
}

function withoutId(document) {
  if (!document) return null;
  const { _id, ...clean } = document;
  return clean;
}

function invalidatePublicCache() {
  publicCache = null;
}

async function readPublicBootstrap() {
  if (publicCache && Date.now() - publicCache.savedAt < PUBLIC_CACHE_TTL) return publicCache.value;
  const [sections, articles, contributors, teacherAdditions] = await Promise.all([
    queryDocuments('sections'),
    queryDocuments('articles'),
    queryDocuments('contributors'),
    queryDocuments('teacher_additions')
  ]);
  sections.sort((a, b) => a.sort_order - b.sort_order);
  sortByDate(articles, 'published_at');
  const publicContributors = contributors
    .filter(item => item.approved_at)
    .sort((a, b) => String(a.approved_at).localeCompare(String(b.approved_at)))
    .map(item => ({ displayName: item.display_name, since: item.approved_at }));
  const value = {
    sections: sections.map(withoutId),
    articles: articles.map(mapArticleSummary),
    contributors: publicContributors,
    teacherAdditions: teacherAdditions.map(mapTeacherAddition)
  };
  publicCache = { savedAt: Date.now(), value };
  return value;
}

async function ensureSeed() {
  if (!seedPromise) {
    seedPromise = (async () => {
      const existing = await queryDocuments('sections', null, 1);
      if (existing.length) return;
      for (const section of seed.sections) await setDocument('sections', section.slug, section);
      for (const article of seed.articles) await setDocument('articles', article.slug, article);
      for (const user of seed.users || []) await setDocument('users', user.student_id, user);
      for (const submission of seed.submissions || []) await setDocument('submissions', String(submission.id), { ...submission, id: String(submission.id) });
      for (const event of seed.review_events || []) await setDocument('review_events', String(event.id), { ...event, id: String(event.id), submission_id: String(event.submission_id) });
    })().catch(error => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

function result(data, status = 200, headers = {}) {
  return { status, headers, data };
}

function error(message, status = 400) {
  return result({ error: message }, status);
}

function safeDiagnostic(err) {
  const values = [err?.name, err?.code, err?.cause?.name, err?.cause?.code]
    .filter(Boolean)
    .map(value => String(value).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 48));
  return values.join(':').slice(0, 120) || 'UNKNOWN';
}

function b64url(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  return Buffer.from(bytes).toString('base64url');
}

function fromB64url(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function makeSession(studentId, secret) {
  const payload = b64url(JSON.stringify({ studentId, exp: Date.now() + 7 * 86400_000 }));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return index < 0 ? [item, ''] : [item.slice(0, index), item.slice(index + 1)];
  }));
}

async function readSession(request) {
  const value = parseCookies(request)[COOKIE];
  const secret = process.env.SESSION_SECRET;
  if (!value || !secret) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(secret, payload);
  const received = fromB64url(signature);
  if (expected.length !== received.length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ received[index];
  if (difference !== 0) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!validLoginId(data.studentId) || data.exp < Date.now()) return null;
    const stored = withoutId(await getDocument('users', data.studentId));
    if (data.studentId !== ADMIN_LOGIN_ID) {
      return stored || {
        student_id: data.studentId,
        role: 'student',
        role_locked: 0,
        created_at: now(),
        last_login_at: now()
      };
    }
    const timestamp = now();
    const protectedAdmin = {
      ...stored,
      student_id: ADMIN_LOGIN_ID,
      role: 'admin',
      role_locked: 0,
      created_at: stored?.created_at || timestamp,
      last_login_at: stored?.last_login_at || timestamp
    };
    if (!stored || stored.role !== 'admin' || stored.role_locked !== 0) {
      await setDocument('users', ADMIN_LOGIN_ID, protectedAdmin);
    }
    return protectedAdmin;
  } catch {
    return null;
  }
}

function sessionCookie(value, maxAge = 604800) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function checkMutationOrigin(request) {
  const origin = request.headers.origin;
  // Browser mutations always carry Origin. Reject origin-less scripts before
  // they reach authentication or PostgreSQL, so direct scanners cannot turn
  // login enumeration into database reads/writes.
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const forwardedHost = (request.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const host = forwardedHost || request.headers.host;
    return originUrl.host === host;
  } catch {
    return false;
  }
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 256 * 1024) throw new Error('请求内容过大');
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function publicUser(user) {
  return user ? {
    studentId: user.student_id,
    maskedId: user.role === 'admin' ? '站点管理员' : '校内成员',
    role: user.role
  } : null;
}

async function ensurePersistentUser(user) {
  const existing = withoutId(await getDocument('users', user.student_id));
  if (existing) return existing;
  const timestamp = now();
  const persistent = {
    ...user,
    created_at: user.created_at || timestamp,
    last_login_at: user.last_login_at || timestamp
  };
  await setDocument('users', user.student_id, persistent);
  return persistent;
}

function mapArticle(row) {
  const clean = withoutId(row);
  return { ...clean, body: parseDocument(clean.body_json), body_json: undefined };
}

function mapArticleSummary(row) {
  const clean = withoutId(row);
  const { body_json, ...summary } = clean;
  return summary;
}

function mapTeacherSubmission(row) {
  const clean = withoutId(row);
  return {
    id: clean.id,
    name: clean.name,
    subject: clean.subject,
    motto: clean.motto,
    status: clean.status,
    reviewNote: clean.review_note,
    createdAt: clean.created_at,
    updatedAt: clean.updated_at
  };
}

function mapTeacherAddition(row) {
  const clean = withoutId(row);
  return {
    id: clean.id,
    name: clean.name,
    subject: clean.subject,
    motto: clean.motto,
    profile: '',
    sourceUrl: '',
    sourceLabel: '经校内补充审核',
    publishedAt: clean.approved_at
  };
}

function mapDraft(row) {
  const clean = withoutId(row);
  if (!clean) return null;
  return {
    id: clean.id,
    draftKey: clean.draft_key,
    targetType: clean.target_type,
    targetId: clean.target_id,
    sectionSlug: clean.section_slug,
    title: clean.title,
    summary: clean.summary,
    body: parseDraftDocument(clean.body_json) || [],
    contentType: clean.content_type,
    subject: clean.subject,
    authorLabel: clean.author_label,
    anonymous: clean.anonymous === 1,
    revision: Number(clean.revision),
    createdAt: clean.created_at,
    updatedAt: clean.updated_at
  };
}

function normalizeDraftSnapshot(snapshot) {
  const body = parseDraftDocument(snapshot?.body ?? []);
  if (!body) return { error: '草稿正文格式无效' };
  const bodyJson = JSON.stringify(body);
  if (Buffer.byteLength(bodyJson, 'utf8') > 220 * 1024) return { error: '草稿正文过长' };
  return {
    values: {
      section_slug: normalizeText(snapshot?.sectionSlug, 60),
      title: normalizeText(snapshot?.title, 100),
      summary: normalizeText(snapshot?.summary, 240),
      body_json: bodyJson,
      content_type: CONTENT_TYPES.has(snapshot?.contentType) ? snapshot.contentType : '',
      subject: normalizeText(snapshot?.subject, 80),
      author_label: normalizeText(snapshot?.authorLabel, 40),
      anonymous: snapshot?.anonymous ? 1 : 0
    }
  };
}

function draftSubmissionInput(draft) {
  return {
    sectionSlug: draft.section_slug,
    title: draft.title,
    summary: draft.summary,
    body: parseDraftDocument(draft.body_json) || [],
    contentType: draft.content_type,
    subject: draft.subject,
    authorLabel: draft.author_label,
    anonymous: draft.anonymous === 1
  };
}

function canEditSubmission(user, submission) {
  return Boolean(submission && (submission.student_id === user.student_id || user.role === 'admin'));
}

async function recordAdminSubmissionEdit(user, submission) {
  if (user.role !== 'admin' || submission.student_id === user.student_id) return;
  const eventId = crypto.randomUUID();
  await setDocument('review_events', eventId, { id: eventId, submission_id: submission.id, reviewer_id: user.student_id, action: 'admin_edit', note: '管理员编辑待审核稿件', created_at: now() });
}

async function validateDraftTarget(user, targetType, targetId, requestedDraftKey = '') {
  if (targetType === 'new') {
    if (targetId) return { error: '新投稿草稿不能指定目标' };
    const draftKey = /^new:[A-Za-z0-9_-]{8,80}$/.test(requestedDraftKey)
      ? requestedDraftKey
      : `new:${crypto.randomUUID()}`;
    return { draftKey, targetId: null };
  }
  if (targetType === 'submission') {
    const submission = withoutId(await getDocument('submissions', targetId));
    if (!canEditSubmission(user, submission)) return { error: '没有找到这份投稿', status: 404 };
    if (!['pending', 'changes_requested'].includes(submission.status)) return { error: '当前投稿状态不能修改', status: 409 };
    return { draftKey: `submission:${targetId}`, targetId };
  }
  if (targetType === 'article') {
    if (user.role !== 'admin') return { error: '需要管理员权限', status: 403 };
    if (!withoutId(await getDocument('articles', targetId))) return { error: '没有找到这篇已发布内容', status: 404 };
    return { draftKey: `article:${targetId}`, targetId };
  }
  return { error: '草稿目标无效' };
}

async function requireUser(request, roles = []) {
  const user = await readSession(request);
  if (!user) return { response: error('请先登入', 401) };
  if (roles.length && !roles.includes(user.role)) return { response: error('没有所需权限', 403) };
  return { user };
}

function sortByDate(rows, field, direction = 'desc') {
  const factor = direction === 'asc' ? 1 : -1;
  return rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * factor);
}

function clientAddress(request) {
  return String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim().slice(0, 80);
}

function enforceMutationRate(request, scope, limit, windowMs = 60_000) {
  const timestamp = Date.now();
  const key = `${scope}:${clientAddress(request)}`;
  const recent = (mutationWindows.get(key) || []).filter(value => timestamp - value < windowMs);
  if (recent.length >= limit) return error('操作过于频繁，请稍后再试', 429);
  recent.push(timestamp);
  mutationWindows.set(key, recent);
  if (mutationWindows.size > 2000) {
    for (const [bucket, values] of mutationWindows) {
      if (!values.some(value => timestamp - value < windowMs)) mutationWindows.delete(bucket);
    }
    while (mutationWindows.size > 2500) {
      mutationWindows.delete(mutationWindows.keys().next().value);
    }
  }
  return null;
}

async function readVisitCount() {
  const stats = withoutId(await getDocument('site_stats', 'all'));
  const total = Number(stats?.total);
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

async function rememberNamedContributor(studentId, displayName, timestamp = now()) {
  if (!displayName || displayName === '匿名同学') return null;
  const existing = withoutId(await getDocument('contributors', studentId));
  if (existing) return existing;
  const contributor = { student_id: studentId, display_name: displayName, first_named_at: timestamp, approved_at: null };
  await setDocument('contributors', studentId, contributor);
  return contributor;
}

function normalizePath(rawUrl) {
  const pathname = new URL(rawUrl, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
  return pathname.startsWith('/api') ? pathname : `/api${pathname === '/' ? '' : pathname}`;
}

async function route(request) {
  const method = request.method.toUpperCase();
  const path = normalizePath(request.url);
  if (!['GET', 'HEAD'].includes(method) && !checkMutationOrigin(request)) return error('请求来源无效', 403);

  if (method === 'GET' && path === '/api/health') {
    await queryDocuments('sections', null, 1);
    return result({
      ok: true,
      database: 'ready',
      platform: 'cloudbase',
      region: process.env.TENCENTCLOUD_REGION || 'ap-shanghai'
    });
  }

  await ensureSeed();

  if (method === 'GET' && path === '/api/visits') {
    return result({ total: await readVisitCount(), trackingStartedAt: '2026-08-10' });
  }

  if (method === 'POST' && path === '/api/visits') {
    const limited = enforceMutationRate(request, 'visit', 120)
      || enforceMutationRate(request, 'visit-sustained', 600, 15 * 60_000);
    if (limited) return limited;
    if (Date.now() < VISIT_TRACKING_START) {
      return result({ total: await readVisitCount(), trackingStartedAt: '2026-08-10', counted: false });
    }
    const data = await readJson(request);
    const visitId = normalizeText(data?.visitId, 96);
    const visitCount = Number(data?.count ?? 1);
    if (!/^[A-Za-z0-9_-]{16,96}$/.test(visitId)) return error('访问标识无效');
    if (!Number.isSafeInteger(visitCount) || visitCount < 1 || visitCount > 20) return error('访问次数无效');
    await setDocument('site_visit_events', visitId, { visit_id: visitId, visit_count: visitCount, created_at: now() });
    return result({ trackingStartedAt: '2026-08-10', counted: true });
  }

  if (method === 'GET' && path === '/api/bootstrap') {
    return result(
      await readPublicBootstrap(),
      200,
      { 'cache-control': 'public, max-age=300, stale-while-revalidate=3600' }
    );
  }

  if (method === 'GET' && path.startsWith('/api/articles/')) {
    const slug = decodeURIComponent(path.slice('/api/articles/'.length));
    const article = await getDocument('articles', slug);
    return article
      ? result({ article: mapArticle(article) })
      : error('没有找到这篇内容', 404);
  }

  if (method === 'GET' && path === '/api/session') {
    return result({ user: publicUser(await readSession(request)) });
  }

  if (method === 'POST' && path === '/api/auth/login') {
    const limited = enforceMutationRate(request, 'login', 20);
    if (limited) return limited;
    const sustainedLimit = enforceMutationRate(request, 'login-sustained', 60, 15 * 60_000);
    if (sustainedLimit) return sustainedLimit;
    const data = await readJson(request);
    const studentId = normalizeText(data?.studentId, 32);
    if (!validLoginId(studentId)) return error('抱歉，仅限本校学生编辑', 403);
    const existing = withoutId(await getDocument('users', studentId));
    const timestamp = now();
    const user = studentId === ADMIN_LOGIN_ID
      ? { ...existing, student_id: studentId, role: 'admin', role_locked: 0, created_at: existing?.created_at || timestamp, last_login_at: timestamp }
      : { student_id: studentId, role: existing?.role || 'student', role_locked: existing?.role_locked || 0, created_at: existing?.created_at || timestamp, last_login_at: timestamp };
    // Ordinary student sessions are stateless: a guessed-but-valid student ID must not
    // amplify a login scan into a persistent database write. Privileged roles remain
    // discoverable through their existing user row, while the protected administrator
    // is still repaired and persisted on every login.
    if (studentId === ADMIN_LOGIN_ID) await setDocument('users', studentId, user);
    const session = await makeSession(studentId, process.env.SESSION_SECRET);
    return result({ user: publicUser(user) }, 200, { 'set-cookie': sessionCookie(session) });
  }

  if (method === 'POST' && path === '/api/auth/logout') {
    return result({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }

  if (method === 'POST' && path === '/api/auth/access') {
    const limited = enforceMutationRate(request, 'access', 10);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    if (auth.user.student_id === ADMIN_LOGIN_ID) return result({ user: publicUser(auth.user) });
    const code = normalizeText((await readJson(request))?.code, 200);
    if (!code) return error('请输入权限口令');
    if (auth.user.role_locked) return error('该账号的自助提权已停用，请联系管理员', 403);
    let role = null;
    if (process.env.ADMIN_BOOTSTRAP_CODE && code === process.env.ADMIN_BOOTSTRAP_CODE) role = 'admin';
    else if (process.env.REVIEWER_ACCESS_CODE && code === process.env.REVIEWER_ACCESS_CODE) role = 'reviewer';
    if (!role) return error('权限口令不正确', 403);
    const timestamp = now();
    const updated = {
      ...auth.user,
      role,
      created_at: auth.user.created_at || timestamp,
      last_login_at: timestamp
    };
    await setDocument('users', auth.user.student_id, updated);
    return result({ user: publicUser(updated) });
  }

  if (method === 'GET' && path === '/api/drafts/mine') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const drafts = sortByDate(
      await queryDocuments('drafts', { student_id: auth.user.student_id }, 100),
      'updated_at'
    ).map(mapDraft);
    return result({ drafts }, 200, { 'cache-control': 'private, no-store' });
  }

  if (method === 'POST' && path === '/api/drafts') {
    const limited = enforceMutationRate(request, 'draft-create', 30);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const data = await readJson(request);
    const targetType = normalizeText(data?.targetType, 20);
    const targetId = normalizeText(data?.targetId, 140) || null;
    const target = await validateDraftTarget(auth.user, targetType, targetId, normalizeText(data?.draftKey, 100));
    if (target.error) return error(target.error, target.status || 400);
    const existing = (await queryDocuments('drafts', {
      student_id: auth.user.student_id,
      draft_key: target.draftKey
    }, 1))[0];
    if (existing) return result({ draft: mapDraft(existing) });
    const prepared = normalizeDraftSnapshot(data?.snapshot || {});
    if (prepared.error) return error(prepared.error);
    auth.user = await ensurePersistentUser(auth.user);
    const id = crypto.randomUUID();
    const timestamp = now();
    let created;
    try {
      created = await createDocument('drafts', {
        id,
        student_id: auth.user.student_id,
        draft_key: target.draftKey,
        target_type: targetType,
        target_id: target.targetId,
        ...prepared.values,
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp
      });
    } catch (failure) {
      const raced = (await queryDocuments('drafts', { student_id: auth.user.student_id, draft_key: target.draftKey }, 1))[0];
      if (!raced) throw failure;
      created = raced;
    }
    return result({ draft: mapDraft(created) }, 201);
  }

  const draftMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]+)$/);
  if (draftMatch && ['PUT', 'DELETE'].includes(method)) {
    const limited = enforceMutationRate(request, method === 'PUT' ? 'draft-save' : 'draft-delete', method === 'PUT' ? 90 : 30);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const existing = withoutId(await getDocument('drafts', draftMatch[1]));
    if (!existing || existing.student_id !== auth.user.student_id) return error('没有找到这份草稿', 404);
    if (method === 'DELETE') {
      await deleteDocuments('drafts', { id: existing.id, student_id: auth.user.student_id });
      return result({ ok: true });
    }
    const data = await readJson(request);
    const expectedRevision = Number(data?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) return error('草稿版本无效');
    const prepared = normalizeDraftSnapshot(data?.snapshot);
    if (prepared.error) return error(prepared.error);
    const timestamp = now();
    const updated = await updateDocuments('drafts', {
      id: existing.id,
      student_id: auth.user.student_id,
      revision: expectedRevision
    }, {
      ...prepared.values,
      revision: expectedRevision + 1,
      updated_at: timestamp
    });
    if (!updated.length) {
      const latest = withoutId(await getDocument('drafts', existing.id));
      return result({ error: '草稿已在其他页面更新', conflict: mapDraft(latest) }, 409);
    }
    return result({ draft: mapDraft(updated[0]) });
  }

  const draftSubmitMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]+)\/submit$/);
  if (method === 'POST' && draftSubmitMatch) {
    const limited = enforceMutationRate(request, 'draft-submit', 20);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const draft = withoutId(await getDocument('drafts', draftSubmitMatch[1]));
    if (!draft || draft.student_id !== auth.user.student_id) return error('没有找到这份草稿', 404);
    const expectedRevision = Number((await readJson(request))?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(draft.revision)) {
      return result({ error: '提交前草稿已经更新', conflict: mapDraft(draft) }, 409);
    }
    const prepared = await validateSubmission(draftSubmissionInput(draft));
    if (prepared.error) return error(prepared.error);
    const [section_slug, title, summary, body_json, content_type, subject, author_label] = prepared.values;
    const timestamp = now();
    let id = draft.target_id;
    let slug = null;
    if (draft.target_type === 'new') {
      id = draft.id;
      const recent = await queryDocuments('submissions', { student_id: auth.user.student_id });
      const alreadyCreated = withoutId(await getDocument('submissions', id));
      if (!alreadyCreated && recent.filter(item => Date.now() - Date.parse(item.created_at) < 86400_000).length >= 10) {
        return error('每天最多提交 10 次，请稍后再试', 429);
      }
      if (!alreadyCreated) {
        await rememberNamedContributor(auth.user.student_id, author_label, timestamp);
        await setDocument('submissions', id, { id, student_id: auth.user.student_id, section_slug, title, summary, body_json, content_type, subject, author_label, status: 'pending', review_note: '', created_at: timestamp, updated_at: timestamp });
      }
    } else if (draft.target_type === 'submission') {
      const submission = withoutId(await getDocument('submissions', draft.target_id));
      if (!canEditSubmission(auth.user, submission)) return error('没有找到这份投稿', 404);
      if (!['pending', 'changes_requested'].includes(submission.status)) return error('当前投稿状态不能修改', 409);
      await rememberNamedContributor(submission.student_id, author_label);
      await setDocument('submissions', submission.id, { ...submission, section_slug, title, summary, body_json, content_type, subject, author_label, status: 'pending', review_note: '', updated_at: timestamp });
      await recordAdminSubmissionEdit(auth.user, submission);
    } else if (draft.target_type === 'article') {
      if (auth.user.role !== 'admin') return error('需要管理员权限', 403);
      const article = withoutId(await getDocument('articles', draft.target_id));
      if (!article) return error('没有找到这篇已发布内容', 404);
      slug = article.slug;
      await setDocument('articles', article.slug, { ...article, section_slug, title, summary, body_json, content_type, subject, author_label, updated_at: timestamp });
      invalidatePublicCache();
    } else {
      return error('草稿目标无效');
    }
    await deleteDocuments('drafts', { id: draft.id, student_id: auth.user.student_id });
    return result({ ok: true, id, slug, status: draft.target_type === 'article' ? 'published' : 'pending' });
  }

  if (method === 'GET' && path === '/api/submissions/mine') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const rows = sortByDate(await queryDocuments('submissions', { student_id: auth.user.student_id }), 'created_at');
    return result({ submissions: rows.map(row => {
      const clean = withoutId(row);
      return { ...clean, body: parseDocument(clean.body_json), body_json: undefined };
    }) });
  }

  if (method === 'GET' && path === '/api/teacher-submissions/mine') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const rows = sortByDate(await queryDocuments('teacher_submissions', { student_id: auth.user.student_id }), 'created_at');
    return result({ teacherSubmissions: rows.map(mapTeacherSubmission) });
  }

  if (method === 'POST' && path === '/api/teacher-submissions') {
    const limited = enforceMutationRate(request, 'teacher-submission', 15);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const data = await readJson(request);
    const name = normalizeText(data?.name, 30);
    const subject = normalizeText(data?.subject, 30);
    const motto = normalizeText(data?.motto, 240);
    if (name.length < 2) return error('请填写教师姓名');
    if (!subject) return error('请填写任教学科');
    if (KNOWN_TEACHER_NAMES.has(name)) return error('教师索引中已经有这位老师', 409);
    if ((await queryDocuments('teacher_additions', { name }, 1)).length) return error('教师索引中已经有这位老师', 409);
    if ((await queryDocuments('teacher_submissions', { name, status: 'pending' }, 1)).length) return error('这位老师的补充资料正在审核中', 409);
    const recent = await queryDocuments('teacher_submissions', { student_id: auth.user.student_id }, 100);
    auth.user = await ensurePersistentUser(auth.user);
    if (recent.filter(item => Date.now() - Date.parse(item.created_at) < 86400_000).length >= 5) return error('每天最多提交 5 位教师，请稍后再试', 429);
    const id = crypto.randomUUID();
    const timestamp = now();
    const created = {
      id,
      student_id: auth.user.student_id,
      name,
      subject,
      motto,
      status: 'pending',
      review_note: '',
      reviewer_id: null,
      created_at: timestamp,
      updated_at: timestamp,
      reviewed_at: null
    };
    await setDocument('teacher_submissions', id, created);
    return result({ teacherSubmission: mapTeacherSubmission(created) }, 201);
  }

  if (method === 'POST' && path === '/api/submissions') {
    const limited = enforceMutationRate(request, 'submission', 20);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const prepared = await validateSubmission(await readJson(request));
    if (prepared.error) return error(prepared.error);
    const recent = await queryDocuments('submissions', { student_id: auth.user.student_id });
    auth.user = await ensurePersistentUser(auth.user);
    if (recent.filter(item => Date.now() - Date.parse(item.created_at) < 86400_000).length >= 10) return error('每天最多提交 10 次，请稍后再试', 429);
    const id = crypto.randomUUID();
    const timestamp = now();
    const [section_slug, title, summary, body_json, content_type, subject, author_label] = prepared.values;
    await rememberNamedContributor(auth.user.student_id, author_label, timestamp);
    await setDocument('submissions', id, { id, student_id: auth.user.student_id, section_slug, title, summary, body_json, content_type, subject, author_label, status: 'pending', review_note: '', created_at: timestamp, updated_at: timestamp });
    return result({ id, status: 'pending' }, 201);
  }

  const editMatch = path.match(/^\/api\/submissions\/([a-zA-Z0-9_-]+)$/);
  if (method === 'PUT' && editMatch) {
    const limited = enforceMutationRate(request, 'submission-edit', 30);
    if (limited) return limited;
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const existing = withoutId(await getDocument('submissions', editMatch[1]));
    if (!canEditSubmission(auth.user, existing)) return error('没有找到这份投稿', 404);
    if (!['pending', 'changes_requested'].includes(existing.status)) return error('当前状态不能修改', 409);
    const prepared = await validateSubmission(await readJson(request));
    if (prepared.error) return error(prepared.error);
    const [section_slug, title, summary, body_json, content_type, subject, author_label] = prepared.values;
    await rememberNamedContributor(existing.student_id, author_label);
    await setDocument('submissions', editMatch[1], { ...existing, section_slug, title, summary, body_json, content_type, subject, author_label, status: 'pending', review_note: '', updated_at: now() });
    await recordAdminSubmissionEdit(auth.user, existing);
    return result({ ok: true, status: 'pending' });
  }

  if (method === 'GET' && path === '/api/review') {
    const auth = await requireUser(request, ['reviewer', 'admin']);
    if (auth.response) return auth.response;
    const url = new URL(request.url, 'http://localhost');
    const requestedStatus = url.searchParams.get('status');
    const status = ['pending', 'changes_requested', 'approved', 'rejected'].includes(requestedStatus) ? requestedStatus : 'pending';
    const [rows, sections, teacherRows] = await Promise.all([
      queryDocuments('submissions', { status }),
      queryDocuments('sections'),
      queryDocuments('teacher_submissions', { status: status === 'changes_requested' ? 'pending' : status })
    ]);
    const sectionTitles = Object.fromEntries(sections.map(item => [item.slug, item.title]));
    sortByDate(rows, 'created_at', 'asc');
    return result({ submissions: rows.map(row => {
      const clean = withoutId(row);
      return { ...clean, student_id: '匿名校内成员', section_title: sectionTitles[clean.section_slug] || clean.section_slug, body: parseDocument(clean.body_json), body_json: undefined };
    }), teacherSubmissions: teacherRows.map(row => ({ ...mapTeacherSubmission(row), studentId: '匿名校内成员' })) });
  }

  const teacherReviewMatch = path.match(/^\/api\/review\/teachers\/([a-zA-Z0-9_-]+)$/);
  if (method === 'POST' && teacherReviewMatch) {
    const limited = enforceMutationRate(request, 'teacher-review', 120);
    if (limited) return limited;
    const auth = await requireUser(request, ['reviewer', 'admin']);
    if (auth.response) return auth.response;
    const data = await readJson(request);
    const action = data?.action;
    const note = normalizeText(data?.note, 1000);
    if (!['approve', 'reject'].includes(action)) return error('未知审核操作');
    if (action === 'reject' && !note) return error('不采用时请填写原因');
    const submission = withoutId(await getDocument('teacher_submissions', teacherReviewMatch[1]));
    if (!submission || submission.status !== 'pending') return error('教师补充请求不存在或已经处理', 409);
    const timestamp = now();
    if (action === 'approve') {
      const existingAddition = (await queryDocuments('teacher_additions', { name: submission.name }, 1))[0];
      if (KNOWN_TEACHER_NAMES.has(submission.name) || (existingAddition && existingAddition.source_submission_id !== submission.id)) {
        return error('教师索引中已经有这位老师', 409);
      }
      if (!existingAddition) {
        const additionId = `community-${submission.id}`;
        await setDocument('teacher_additions', additionId, {
          id: additionId,
          name: submission.name,
          subject: submission.subject,
          motto: submission.motto,
          submitted_by: submission.student_id,
          source_submission_id: submission.id,
          approved_by: auth.user.student_id,
          approved_at: timestamp
        });
      }
      invalidatePublicCache();
    }
    const status = action === 'approve' ? 'approved' : 'rejected';
    await setDocument('teacher_submissions', submission.id, {
      ...submission,
      status,
      review_note: note,
      reviewer_id: auth.user.student_id,
      updated_at: timestamp,
      reviewed_at: timestamp
    });
    return result({ ok: true, status });
  }

  const reviewMatch = path.match(/^\/api\/review\/([a-zA-Z0-9_-]+)$/);
  if (method === 'POST' && reviewMatch) {
    const limited = enforceMutationRate(request, 'review', 120);
    if (limited) return limited;
    const auth = await requireUser(request, ['reviewer', 'admin']);
    if (auth.response) return auth.response;
    const data = await readJson(request);
    const action = data?.action;
    const note = normalizeText(data?.note, 1000);
    const statuses = { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected' };
    if (!statuses[action]) return error('未知审核操作');
    if (action !== 'approve' && !note) return error('退回修改或拒绝时请填写原因');
    const submission = withoutId(await getDocument('submissions', reviewMatch[1]));
    if (!submission || !['pending', 'changes_requested'].includes(submission.status)) return error('投稿不存在或已经处理', 409);
    let slug = null;
    if (action === 'approve') {
      slug = slugify(submission.title);
      await setDocument('articles', slug, { slug, section_slug: submission.section_slug, title: submission.title, summary: submission.summary, body_json: submission.body_json, content_type: submission.content_type, subject: submission.subject, author_label: submission.author_label, source_submission_id: submission.id, published_at: now(), updated_at: now() });
      if (submission.author_label !== '匿名同学') {
        const contributor = await rememberNamedContributor(submission.student_id, submission.author_label);
        if (contributor && !contributor.approved_at) {
          await setDocument('contributors', submission.student_id, { ...contributor, approved_at: now() });
        }
      }
    }
    const eventId = crypto.randomUUID();
    await setDocument('review_events', eventId, { id: eventId, submission_id: submission.id, reviewer_id: auth.user.student_id, action, note, created_at: now() });
    await setDocument('submissions', submission.id, { ...submission, status: statuses[action], review_note: note, updated_at: now() });
    if (action === 'approve') invalidatePublicCache();
    return result({ ok: true, status: statuses[action], slug });
  }

  const adminArticleMatch = path.match(/^\/api\/admin\/articles\/(.+)$/);
  if (adminArticleMatch && ['PUT', 'DELETE'].includes(method)) {
    const limited = enforceMutationRate(request, 'admin-article', 120);
    if (limited) return limited;
    const auth = await requireUser(request, ['admin']);
    if (auth.response) return auth.response;
    const slug = decodeURIComponent(adminArticleMatch[1]);
    const existing = withoutId(await getDocument('articles', slug));
    if (!existing) return error('没有找到这篇已发布内容', 404);
    if (method === 'DELETE') {
      await deleteDocument('articles', slug);
      invalidatePublicCache();
      return result({ ok: true, slug });
    }
    const prepared = await validateSubmission(await readJson(request));
    if (prepared.error) return error(prepared.error);
    const [section_slug, title, summary, body_json, content_type, subject, author_label] = prepared.values;
    const updated = { ...existing, slug, section_slug, title, summary, body_json, content_type, subject, author_label, updated_at: now() };
    await setDocument('articles', slug, updated);
    invalidatePublicCache();
    return result({ ok: true, article: mapArticle(updated) });
  }

  if (method === 'GET' && path === '/api/admin/users') {
    const auth = await requireUser(request, ['admin']);
    if (auth.response) return auth.response;
    const users = (await queryDocuments('users')).filter(user => user.role !== 'student' || user.role_locked === 1).map(withoutId);
    users.sort((a, b) => `${a.role}:${a.created_at}`.localeCompare(`${b.role}:${b.created_at}`));
    return result({ users });
  }

  if (method === 'POST' && path === '/api/admin/roles') {
    const limited = enforceMutationRate(request, 'admin', 120);
    if (limited) return limited;
    const auth = await requireUser(request, ['admin']);
    if (auth.response) return auth.response;
    const data = await readJson(request);
    const studentId = normalizeText(data?.studentId, 32);
    const role = data?.role;
    if (studentId === ADMIN_LOGIN_ID) return error('受保护的站点管理员不能被降权或覆盖', 409);
    if (!validStudentId(studentId) || !['student', 'reviewer', 'admin'].includes(role)) return error('账号或角色无效');
    const existing = withoutId(await getDocument('users', studentId));
    const timestamp = now();
    await setDocument('users', studentId, { student_id: studentId, role, role_locked: role === 'student' ? 1 : 0, created_at: existing?.created_at || timestamp, last_login_at: existing?.last_login_at || timestamp });
    return result({ ok: true });
  }

  return error('API 路径不存在', 404);
}

async function validateSubmission(data) {
  const section = normalizeText(data?.sectionSlug, 60);
  const title = normalizeText(data?.title, 100);
  const summary = normalizeText(data?.summary, 240);
  const blocks = parseDocument(data?.body);
  const contentType = CONTENT_TYPES.has(data?.contentType) ? data.contentType : '';
  const subject = normalizeText(data?.subject, 80);
  const authorLabel = data?.anonymous ? '匿名同学' : normalizeText(data?.authorLabel, 40);
  if (!title || title.length < 4) return { error: '标题至少需要 4 个字' };
  if (!summary || summary.length < 10) return { error: '摘要至少需要 10 个字' };
  if (!blocks || blocks.reduce((sum, block) => sum + block.text.length, 0) < 50) return { error: '正文至少需要 50 个字' };
  if (!contentType) return { error: '请选择内容类型' };
  if (!authorLabel) return { error: '请填写署名或选择匿名' };
  if (!await getDocument('sections', section)) return { error: '分区不存在' };
  return { values: [section, title, summary, JSON.stringify(blocks), contentType, subject, authorLabel] };
}

function send(response, payload) {
  const body = JSON.stringify(payload.data);
  response.writeHead(payload.status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...payload.headers
  });
  response.end(body);
}

const server = http.createServer(async (request, response) => {
  try {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
      return send(response, error('服务端尚未配置 SESSION_SECRET', 503));
    }
    send(response, await route(request));
  } catch (err) {
    console.error(err);
    send(response, result({ error: '服务器暂时无法处理请求', diagnostic: safeDiagnostic(err) }, 500));
  }
});

server.listen(Number(process.env.PORT || 9000), '0.0.0.0', () => {
  console.log(`LHwiki API listening on ${process.env.PORT || 9000}`);
});

module.exports = { normalizePath };
