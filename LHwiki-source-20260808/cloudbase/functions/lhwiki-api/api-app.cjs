'use strict';

const {
  ADMIN_LOGIN_ID,
  CONTENT_TYPES,
  DOCUMENT_SCHEMA_VERSION,
  KNOWN_TEACHER_NAMES,
  containsAdvancedBlocks,
  documentStats,
  normalizeText,
  parseDocument,
  parseDraftDocument,
  slugify,
  validLoginId,
  validStudentId
} = require('./content.cjs');

const COOKIE = 'campus_session';
const PUBLIC_CACHE_TTL = 6 * 60 * 60_000;
const ARTICLE_CACHE_TTL = 6 * 60 * 60_000;
// Function instances do not share memory. A long per-instance cache can keep
// serving a pre-submit empty board after another instance accepts a score.
const GAME_LEADERBOARD_CACHE_TTL = 15_000;
const GAME_LEADERBOARD_LIMIT = 10;
const GAME_SCORE_ROWS_MAX = 100;
const GAME_SCORE_MAX = 1_000_000_000;
const GAME_LUHE_MAX = 1_000;
const GAME_SCORE_BODY_MAX = 2 * 1024;
const GAME_SCORE_GLOBAL_DAILY_LIMIT = 120;
const GAME_SCORE_IP_DAILY_LIMIT = 8;
const GAME_SCORE_PLAYER_DAILY_LIMIT = 3;
const SESSION_ROLES = new Set(['student', 'reviewer', 'admin']);
const encoder = new TextEncoder();

function createApp({
  store,
  seed = { sections: [], articles: [] },
  publicSnapshot = { sections: [], articles: [], contributors: [], teacherAdditions: [] },
  publicSnapshotStore = null,
  buildPublicSnapshot = null,
  sessionSecret = '',
  adminBootstrapCode = '',
  reviewerAccessCode = '',
  region = 'ap-shanghai',
  draftClientVersion = 4,
  emergencyMaintenance = true,
  maintenanceReviewDate = '2026-09-07',
  clock = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
  logger = console
} = {}) {
  if (!store) throw new Error('API store is required');
  const {
    createDocument,
    deleteDocument,
    deleteDocuments,
    getDocument,
    queryDocuments,
    setDocument,
    updateDocuments
  } = store;
  let seedPromise;
  let publicCache = null;
  let publicCachePromise = null;
  let publicSnapshotLoadedAt = null;
  let publicSnapshotPromise = null;
  const articleCache = new Map();
  const mutationWindows = new Map();
  let gameLeaderboardCache = null;

function now() {
  return new Date(clock()).toISOString();
}

function withoutId(document) {
  if (!document) return null;
  const { _id, ...clean } = document;
  return clean;
}

function invalidatePublicCache() {
  publicCache = null;
  publicCachePromise = null;
  articleCache.clear();
}

function invalidateGameLeaderboardCache() {
  gameLeaderboardCache = null;
}

function snapshotBootstrap(snapshot = publicSnapshot) {
  const sections = snapshot.sections.slice();
  const articles = snapshot.articles.map(article => ({ ...article, body_json: JSON.stringify(article.body) }));
  const contributors = snapshot.contributors.slice();
  const teacherAdditions = snapshot.teacherAdditions.slice();
  sections.sort((a, b) => a.sort_order - b.sort_order);
  sortByDate(articles, 'published_at');
  return {
    sections: sections.map(withoutId),
    articles: articles.map(mapArticleSummary),
    contributors: contributors.sort((a, b) => String(a.since).localeCompare(String(b.since))),
    teacherAdditions
  };
}

async function readStoredPublicSnapshot(force = false) {
  if (!publicSnapshotStore?.load) return null;
  if (!force && publicSnapshotLoadedAt !== null && clock() - publicSnapshotLoadedAt < PUBLIC_CACHE_TTL) return publicSnapshot;
  if (!publicSnapshotPromise) publicSnapshotPromise = (async () => {
    try {
      publicSnapshot = await publicSnapshotStore.load();
    } catch (err) {
      logger.error?.(`public-snapshot-download-fallback:${safeDiagnostic(err)}`);
    }
    publicSnapshotLoadedAt = clock();
    return publicSnapshot;
  })().finally(() => { publicSnapshotPromise = null; });
  return publicSnapshotPromise;
}

async function readPublicBootstrap(force = false) {
  if (!force && publicCache && clock() - publicCache.savedAt < PUBLIC_CACHE_TTL) return publicCache.value;
  if (!publicCachePromise) publicCachePromise = (async () => {
    let value;
    if (publicSnapshotStore?.load) {
      value = snapshotBootstrap(await readStoredPublicSnapshot(force));
      publicCache = { savedAt: clock(), value };
      return value;
    }
    try {
      const [sections, articles, contributors, teacherAdditions] = await Promise.all([
        queryDocuments('sections', null, 100, 'slug,title,description,icon,sort_order'),
        queryDocuments('articles', null, 2000, 'slug,section_slug,title,summary,content_type,subject,author_label,published_at,updated_at'),
        queryDocuments('contributors', null, 2000, 'display_name,approved_at'),
        queryDocuments('teacher_additions', null, 500, 'id,name,subject,motto,approved_at')
      ]);
      sections.sort((a, b) => a.sort_order - b.sort_order);
      sortByDate(articles, 'published_at');
      value = {
        sections: sections.map(withoutId),
        articles: articles.map(mapArticleSummary),
        contributors: contributors.filter(row => row.approved_at).map(row => ({ displayName: row.display_name, since: row.approved_at })).sort((a, b) => String(a.since).localeCompare(String(b.since))),
        teacherAdditions: teacherAdditions.filter(row => row.approved_at).map(mapTeacherAddition)
      };
    } catch (err) {
      logger.error?.(`public-bootstrap-fallback:${safeDiagnostic(err)}`);
      value = snapshotBootstrap();
    }
    publicCache = { savedAt: clock(), value };
    return value;
  })().finally(() => { publicCachePromise = null; });
  return publicCachePromise;
}

async function readPublicArticle(slug, force = false) {
  const cached = articleCache.get(slug);
  if (!force && cached && clock() - cached.savedAt < ARTICLE_CACHE_TTL) return cached.value;
  let value;
  if (publicSnapshotStore?.load) {
    const snapshot = await readStoredPublicSnapshot(force);
    const article = snapshot.articles.find(item => item.slug === slug);
    value = article ? { ...article, body_json: JSON.stringify(article.body) } : null;
    articleCache.set(slug, { savedAt: clock(), value });
    if (articleCache.size > 100) articleCache.delete(articleCache.keys().next().value);
    return value;
  }
  try {
    value = withoutId(await getDocument('articles', slug));
  } catch (err) {
    logger.error?.(`public-article-fallback:${safeDiagnostic(err)}`);
    const article = publicSnapshot.articles.find(item => item.slug === slug);
    value = article ? { ...article, body_json: JSON.stringify(article.body) } : null;
  }
  articleCache.set(slug, { savedAt: clock(), value });
  if (articleCache.size > 100) articleCache.delete(articleCache.keys().next().value);
  return value;
}

async function syncPublicSnapshot(reason) {
  if (!publicSnapshotStore?.save || typeof buildPublicSnapshot !== 'function') {
    invalidatePublicCache();
    return null;
  }
  try {
    const publish = async () => {
      const [sections, articles, contributors, teacherAdditions] = await Promise.all([
        queryDocuments('sections', null, 100),
        queryDocuments('articles', null, 2000),
        queryDocuments('contributors', null, 2000),
        queryDocuments('teacher_additions', null, 500)
      ]);
      const nextSnapshot = buildPublicSnapshot({ sections, articles, contributors, teacher_additions: teacherAdditions });
      await publicSnapshotStore.save(nextSnapshot, { revision: store.getRevision?.() });
      publicSnapshot = nextSnapshot;
      publicSnapshotLoadedAt = clock();
      publicCache = { savedAt: clock(), value: snapshotBootstrap(nextSnapshot) };
      publicCachePromise = null;
      articleCache.clear();
      store.clearInternalMetaInMemory?.('pendingPublicSnapshot');
    };
    if (typeof store.setInternalMeta === 'function' && typeof store.afterCommit === 'function') {
      store.setInternalMeta('pendingPublicSnapshot', { reason, requestedAt: new Date(clock()).toISOString() });
      store.afterCommit(publish);
    } else {
      await publish();
    }
    return true;
  } catch (err) {
    invalidatePublicCache();
    logger.error?.(`public-snapshot-sync-failed:${reason}:${safeDiagnostic(err)}`);
    return false;
  }
}

async function reconcilePendingPublicSnapshot() {
  if (!publicSnapshotStore?.save || typeof store.getInternalMeta !== 'function') return;
  const pending = store.getInternalMeta('pendingPublicSnapshot');
  if (!pending) return;
  const [sections, articles, contributors, teacherAdditions] = await Promise.all([
    queryDocuments('sections', null, 100), queryDocuments('articles', null, 2000),
    queryDocuments('contributors', null, 2000), queryDocuments('teacher_additions', null, 500)
  ]);
  const snapshot = buildPublicSnapshot({ sections, articles, contributors, teacher_additions: teacherAdditions });
  await publicSnapshotStore.save(snapshot, { revision: store.getRevision?.() });
  publicSnapshot = snapshot;
  publicSnapshotLoadedAt = clock();
  store.setInternalMeta?.('pendingPublicSnapshot', undefined);
  invalidatePublicCache();
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

async function makeSession(studentId, role, secret) {
  const payload = b64url(JSON.stringify({ version: 3, studentId, role, exp: clock() + 7 * 86400_000 }));
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
  const secret = sessionSecret;
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
    if (![2, 3].includes(Number(data.version)) || !validLoginId(data.studentId) || data.exp < clock() || !SESSION_ROLES.has(data.role)) return null;
    const timestamp = now();
    return {
      student_id: data.studentId,
      role: data.studentId === ADMIN_LOGIN_ID ? 'admin' : data.role,
      role_locked: 0,
      created_at: timestamp,
      last_login_at: timestamp
    };
  } catch {
    return null;
  }
}

async function verifyPrivilegedSession(user) {
  if (!user || user.role === 'student' || user.student_id === ADMIN_LOGIN_ID) return user;
  const stored = withoutId(await getDocument('users', user.student_id));
  if (!stored || stored.role_locked || !['reviewer', 'admin'].includes(stored.role)) {
    return { ...user, role: 'student', role_locked: stored?.role_locked ? 1 : 0 };
  }
  return { ...stored, __persistent: true };
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

const requestBodies = new WeakMap();

async function readJson(request, maxBytes = 256 * 1024) {
  if (requestBodies.has(request)) return requestBodies.get(request);
  const pending = readJsonOnce(request, maxBytes);
  requestBodies.set(request, pending);
  return pending;
}

async function readJsonOnce(request, maxBytes) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) {
      const tooLarge = new Error('请求内容过大');
      tooLarge.code = 'PAYLOAD_TOO_LARGE';
      tooLarge.status = 413;
      throw tooLarge;
    }
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
  if (user?.__persistent) return user;
  const existing = withoutId(await getDocument('users', user.student_id));
  if (existing) return { ...existing, __persistent: true };
  const timestamp = now();
  const persistent = {
    ...user,
    created_at: user.created_at || timestamp,
    last_login_at: user.last_login_at || timestamp
  };
  await setDocument('users', user.student_id, persistent);
  return { ...persistent, __persistent: true };
}

function mapArticle(row) {
  const clean = withoutId(row);
  return { ...clean, body: parseDocument(clean.body_json), body_json: undefined };
}

function mapArticleSummary(row) {
  const clean = withoutId(row);
  const { body_json, body, ...summary } = clean;
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
  const body = parseDraftDocument(clean.body_json) || [];
  return {
    id: clean.id,
    draftKey: clean.draft_key,
    targetType: clean.target_type,
    targetId: clean.target_id,
    sectionSlug: clean.section_slug,
    title: clean.title,
    summary: clean.summary,
    schemaVersion: containsAdvancedBlocks(body) ? DOCUMENT_SCHEMA_VERSION : 1,
    body,
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
  const eventId = randomUUID();
  await setDocument('review_events', eventId, { id: eventId, submission_id: submission.id, reviewer_id: user.student_id, action: 'admin_edit', note: '管理员编辑待审核稿件', created_at: now() });
}

async function validateDraftTarget(user, targetType, targetId, requestedDraftKey = '') {
  if (targetType === 'new') {
    if (targetId) return { error: '新投稿草稿不能指定目标' };
    const draftKey = /^new:[A-Za-z0-9_-]{8,80}$/.test(requestedDraftKey)
      ? requestedDraftKey
      : `new:${randomUUID()}`;
    return { draftKey, targetId: null };
  }
  if (targetType === 'submission') {
    const submission = withoutId(await getDocument('submissions', targetId));
    if (!canEditSubmission(user, submission)) return { error: '没有找到这份投稿', status: 404 };
    if (!['pending', 'changes_requested'].includes(submission.status)) return { error: '当前投稿状态不能修改', status: 409 };
    return { draftKey: `submission:${targetId}`, targetId, sourceBody: parseDraftDocument(submission.body_json) || [] };
  }
  if (targetType === 'article') {
    if (user.role !== 'admin') return { error: '需要管理员权限', status: 403 };
    const article = withoutId(await getDocument('articles', targetId));
    if (!article) return { error: '没有找到这篇已发布内容', status: 404 };
    return { draftKey: `article:${targetId}`, targetId, sourceBody: parseDraftDocument(article.body_json) || [] };
  }
  return { error: '草稿目标无效' };
}

async function requireUser(request, roles = []) {
  let user = await readSession(request);
  if (!user) return { response: error('请先登入', 401) };
  // Signed student sessions stay database-free. Privileged claims are checked
  // only when an explicit private operation reaches this guard, so revocation
  // remains immediate without turning public page loads into PostgreSQL reads.
  if (user.role !== 'student') user = await verifyPrivilegedSession(user);
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

function enforceMutationRate(request, scope, limit, windowMs = 60_000, identity = '') {
  const timestamp = clock();
  const key = `${scope}:${identity || clientAddress(request)}`;
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

function mapGameScore(row) {
  return {
    name: row.display_name,
    score: Number(row.score),
    luheCount: Number(row.luhe_count),
    achievedAt: row.achieved_at
  };
}

async function readGameLeaderboard() {
  if (gameLeaderboardCache && clock() - gameLeaderboardCache.savedAt < GAME_LEADERBOARD_CACHE_TTL) {
    return gameLeaderboardCache.value;
  }
  const rows = (await queryDocuments('game_scores', null, GAME_SCORE_ROWS_MAX + 1))
    .filter(row => Number.isSafeInteger(Number(row.score))
      && Number(row.score) > 0
      && Number.isSafeInteger(Number(row.luhe_count))
      && Number(row.luhe_count) >= 1
      && typeof row.display_name === 'string');
  rows.sort((a, b) => Number(b.score) - Number(a.score)
    || String(a.achieved_at).localeCompare(String(b.achieved_at))
    || String(a.player_id).localeCompare(String(b.player_id)));
  const value = rows.slice(0, GAME_LEADERBOARD_LIMIT).map(mapGameScore);
  gameLeaderboardCache = { savedAt: clock(), value };
  return value;
}

function validateGameScore(data) {
  const playerId = normalizeText(data?.playerId, 80);
  const displayName = normalizeText(data?.displayName, 24).replace(/\s+/g, ' ');
  const score = Number(data?.score);
  const luheCount = Number(data?.luheCount);
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(playerId)) return { error: '设备标识无效' };
  if (!displayName || !/^[\p{L}\p{N} _.·-]{1,24}$/u.test(displayName)) return { error: '显示名称只能包含文字、数字、空格和常用分隔符' };
  if (!Number.isSafeInteger(score) || score < 1 || score > GAME_SCORE_MAX) return { error: '成绩范围无效' };
  if (!Number.isSafeInteger(luheCount) || luheCount < 1 || luheCount > GAME_LUHE_MAX) return { error: '潞河数量无效' };
  return { values: { playerId, displayName, score, luheCount } };
}

async function enforceDurableGameRate(request) {
  const timestamp = clock();
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const expiresAt = new Date(timestamp + 3 * 86400_000).toISOString();
  const addressDigest = b64url(await hmac(sessionSecret, `game-score:${clientAddress(request)}`)).slice(0, 32);
  const globalId = `global:${day}`;
  const ipId = `ip:${day}:${addressDigest}`;
  const [globalBucket, ipBucket, buckets] = await Promise.all([
    getDocument('game_score_limits', globalId),
    getDocument('game_score_limits', ipId),
    queryDocuments('game_score_limits', null, 1000)
  ]);
  if (Number(globalBucket?.count || 0) >= GAME_SCORE_GLOBAL_DAILY_LIMIT
    || Number(ipBucket?.count || 0) >= GAME_SCORE_IP_DAILY_LIMIT) {
    return error('今日榜单上传次数已达上限，请明天再试', 429);
  }
  for (const bucket of buckets.filter(item => String(item.expires_at || '') <= now()).slice(0, 200)) {
    await deleteDocument('game_score_limits', bucket.bucket_id);
  }
  await setDocument('game_score_limits', globalId, {
    bucket_id: globalId,
    count: Number(globalBucket?.count || 0) + 1,
    expires_at: expiresAt
  });
  await setDocument('game_score_limits', ipId, {
    bucket_id: ipId,
    count: Number(ipBucket?.count || 0) + 1,
    expires_at: expiresAt
  });
  return null;
}

async function handleGameLeaderboard(request) {
  const globalLimited = enforceMutationRate(request, 'game-score-hot-global', 20, 60_000, 'global');
  if (globalLimited) return globalLimited;
  const ipLimited = enforceMutationRate(request, 'game-score-ip', 5, 10 * 60_000);
  if (ipLimited) return ipLimited;
  const data = await readJson(request, GAME_SCORE_BODY_MAX);
  const prepared = validateGameScore(data);
  if (prepared.error) return error(prepared.error);
  const { playerId, displayName, score, luheCount } = prepared.values;
  const clientLimited = enforceMutationRate(request, 'game-score-player', 3, 24 * 60 * 60_000, playerId);
  if (clientLimited) return clientLimited;
  const durableLimited = await enforceDurableGameRate(request);
  if (durableLimited) return durableLimited;
  const existing = withoutId(await getDocument('game_scores', playerId));
  if (existing && Number(existing.score) >= score) {
    return result({ scores: await readGameLeaderboard(), accepted: false, reason: 'not_personal_best', entertainmentOnly: true });
  }
  const day = new Date(clock()).toISOString().slice(0, 10);
  if (existing?.submission_day === day && Number(existing.submission_count || 0) >= GAME_SCORE_PLAYER_DAILY_LIMIT) {
    return error('同一设备今日已上传多次新高，请明天再试', 429);
  }
  const rows = await queryDocuments('game_scores', null, GAME_SCORE_ROWS_MAX + 1);
  if (!existing && rows.length >= GAME_SCORE_ROWS_MAX) {
    rows.sort((a, b) => Number(a.score) - Number(b.score)
      || String(b.achieved_at).localeCompare(String(a.achieved_at))
      || String(b.player_id).localeCompare(String(a.player_id)));
    const cutoff = rows[0];
    if (score <= Number(cutoff.score)) {
      return result({ scores: await readGameLeaderboard(), accepted: false, reason: 'below_cutoff', entertainmentOnly: true });
    }
    await deleteDocument('game_scores', cutoff.player_id);
  }
  await setDocument('game_scores', playerId, {
    player_id: playerId,
    display_name: displayName,
    score,
    luhe_count: luheCount,
    achieved_at: now(),
    submission_day: day,
    submission_count: existing?.submission_day === day ? Number(existing.submission_count || 0) + 1 : 1
  });
  invalidateGameLeaderboardCache();
  return result({ scores: await readGameLeaderboard(), accepted: true, entertainmentOnly: true });
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

async function routeInner(request) {
  const method = request.method.toUpperCase();
  const path = normalizePath(request.url);
  if (!['GET', 'HEAD'].includes(method) && !checkMutationOrigin(request)) return error('请求来源无效', 403);

  if (method === 'GET' && path === '/api/health') {
    return result({
      ok: true,
      database: emergencyMaintenance ? 'suspended-by-application' : 'deferred',
      maintenance: emergencyMaintenance,
      reviewDate: emergencyMaintenance ? maintenanceReviewDate : null,
      platform: 'cloudbase',
      region
    });
  }

  if (method === 'GET' && path === '/api/visits') {
    return result({ total: null, trackingStartedAt: '2026-08-10', paused: true, maintenance: emergencyMaintenance });
  }

  if (method === 'POST' && path === '/api/visits') {
    return result({ trackingStartedAt: '2026-08-10', counted: false, paused: true, maintenance: emergencyMaintenance });
  }

  if (method === 'GET' && path === '/api/bootstrap') {
    const force = new URL(request.url, 'http://localhost').searchParams.has('refresh');
    return result(
      await readPublicBootstrap(force),
      200,
      { 'cache-control': 'public, max-age=21600, stale-while-revalidate=604800' }
    );
  }

  // The leaderboard is a small, public, COS-backed read.  It is intentionally
  // kept outside the public content snapshot so score submissions never fan
  // out into the much larger article snapshot publish path.
  if (method === 'GET' && path === '/api/games/great-luhe/leaderboard') {
    return result(
      { scores: await readGameLeaderboard(), entertainmentOnly: true },
      200,
      { 'cache-control': 'public, max-age=1800, stale-while-revalidate=3600' }
    );
  }

  if (method === 'GET' && path.startsWith('/api/articles/')) {
    const slug = decodeURIComponent(path.slice('/api/articles/'.length));
    const force = new URL(request.url, 'http://localhost').searchParams.has('refresh');
    const article = await readPublicArticle(slug, force);
    return article
      ? result({ article: mapArticle(article) }, 200, { 'cache-control': 'public, max-age=21600, stale-while-revalidate=604800' })
      : error('没有找到这篇内容', 404);
  }

  if (emergencyMaintenance) {
    if (method === 'GET' && path === '/api/session') {
      return result({ user: null, maintenance: true, reviewDate: maintenanceReviewDate });
    }
    if (method === 'POST' && path === '/api/auth/logout') {
      return result({ ok: true, maintenance: true }, 200, { 'set-cookie': sessionCookie('', 0) });
    }
    return result({
      error: '网站正在进行资源保护维护，当前仅开放公开浏览；本机内容不会被清除',
      maintenance: true,
      reviewDate: maintenanceReviewDate
    }, 503, { 'retry-after': '86400' });
  }

  if (method === 'POST' && path === '/api/games/great-luhe/leaderboard') return handleGameLeaderboard(request);

  const isDraftWrite = (method === 'POST' && path === '/api/drafts')
    || (method === 'PUT' && /^\/api\/drafts\/[a-zA-Z0-9_-]+$/.test(path))
    || (method === 'POST' && /^\/api\/drafts\/[a-zA-Z0-9_-]+\/submit$/.test(path));
  if (isDraftWrite) {
    const data = await readJson(request);
    if (!Number.isSafeInteger(Number(data?.clientVersion)) || Number(data.clientVersion) < draftClientVersion) {
      return result({
        error: '省流写作模式已经启用；本机内容已保留，请刷新页面后继续',
        upgradeRequired: true
      }, 409);
    }
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
    const existingSession = await readSession(request);
    const retainedRole = existingSession?.student_id === studentId && ['reviewer', 'admin'].includes(existingSession.role)
      ? existingSession.role
      : 'student';
    const timestamp = now();
    const user = studentId === ADMIN_LOGIN_ID
      ? { student_id: studentId, role: 'admin', role_locked: 0, created_at: timestamp, last_login_at: timestamp }
      : { student_id: studentId, role: retainedRole, role_locked: 0, created_at: timestamp, last_login_at: timestamp };
    // Login is intentionally stateless. A scanner or an ordinary student must
    // never wake PostgreSQL merely so the small privileged-account set can be
    // discovered. Reviewers regain a lost/expired role with the existing access
    // code; an unexpired signed session keeps its display role, while every
    // privileged operation still verifies the current database row.
    const session = await makeSession(studentId, user.role, sessionSecret);
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
    const stored = withoutId(await getDocument('users', auth.user.student_id));
    if (stored) auth.user = { ...auth.user, ...stored, __persistent: true };
    const code = normalizeText((await readJson(request))?.code, 200);
    if (!code) return error('请输入权限口令');
    if (auth.user.role_locked) return error('该账号的自助提权已停用，请联系管理员', 403);
    let role = null;
    if (adminBootstrapCode && code === adminBootstrapCode) role = 'admin';
    else if (reviewerAccessCode && code === reviewerAccessCode) role = 'reviewer';
    if (!role) return error('权限口令不正确', 403);
    const timestamp = now();
    const updated = {
      ...auth.user,
      role,
      created_at: auth.user.created_at || timestamp,
      last_login_at: timestamp
    };
    await setDocument('users', auth.user.student_id, updated);
    const session = await makeSession(updated.student_id, updated.role, sessionSecret);
    return result({ user: publicUser(updated) }, 200, { 'set-cookie': sessionCookie(session) });
  }

  if (method === 'GET' && path === '/api/mine') {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const [draftRows, submissionRows, teacherRows] = await Promise.all([
      queryDocuments('drafts', { student_id: auth.user.student_id }, 100),
      queryDocuments('submissions', { student_id: auth.user.student_id }),
      queryDocuments('teacher_submissions', { student_id: auth.user.student_id })
    ]);
    const drafts = sortByDate(draftRows, 'updated_at').map(mapDraft);
    const submissions = sortByDate(submissionRows, 'created_at').map(row => {
      const clean = withoutId(row);
      return { ...clean, body: parseDocument(clean.body_json), body_json: undefined };
    });
    const teacherSubmissions = sortByDate(teacherRows, 'created_at').map(mapTeacherSubmission);
    return result({ drafts, submissions, teacherSubmissions }, 200, { 'cache-control': 'private, no-store' });
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
    const prepared = normalizeDraftSnapshot(data?.snapshot || {});
    if (prepared.error) return error(prepared.error);
    const existing = (await queryDocuments('drafts', {
      student_id: auth.user.student_id,
      draft_key: target.draftKey
    }, 1))[0];
    if (existing) {
      const unchanged = Object.entries(prepared.values).every(([key, value]) => existing[key] === value);
      if (unchanged) return result({ draft: mapDraft(existing) });
      return result({ error: '云端已有同一草稿的其他版本', conflict: mapDraft(existing) }, 409);
    }
    if (containsAdvancedBlocks(target.sourceBody || []) && Number(data?.snapshot?.schemaVersion || 1) < DOCUMENT_SCHEMA_VERSION) {
      return result({ error: '此内容包含新版编辑块，请刷新页面后继续编辑', upgradeRequired: true }, 409);
    }
    auth.user = await ensurePersistentUser(auth.user);
    const id = randomUUID();
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
      return result({ error: '草稿已在其他页面创建', conflict: mapDraft(raced) }, 409);
    }
    return result({ draft: mapDraft(created) }, 201);
  }

  const draftMatch = path.match(/^\/api\/drafts\/([a-zA-Z0-9_-]+)$/);
  if (draftMatch && ['PUT', 'DELETE'].includes(method)) {
    // Cloud revisions are manual-only. Keep a hard ceiling as a final guard
    // against scripted clicking or a modified client; local recovery is unlimited.
    const limited = method === 'PUT'
      ? enforceMutationRate(request, 'draft-save', 6, 60 * 60_000)
      : enforceMutationRate(request, 'draft-delete', 30);
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
    const existingBody = parseDraftDocument(existing.body_json) || [];
    if (containsAdvancedBlocks(existingBody) && Number(data?.snapshot?.schemaVersion || 1) < DOCUMENT_SCHEMA_VERSION) {
      return result({ error: '此草稿包含新版内容，请刷新页面后继续编辑', conflict: mapDraft(existing) }, 409);
    }
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
    let publicSnapshotSynced = null;
    if (draft.target_type === 'new') {
      id = draft.id;
      const recent = await queryDocuments('submissions', { student_id: auth.user.student_id });
      const alreadyCreated = withoutId(await getDocument('submissions', id));
      if (!alreadyCreated && recent.filter(item => clock() - Date.parse(item.created_at) < 86400_000).length >= 10) {
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
    } else {
      return error('草稿目标无效');
    }
    await deleteDocuments('drafts', { id: draft.id, student_id: auth.user.student_id });
    if (draft.target_type === 'article') publicSnapshotSynced = await syncPublicSnapshot('draft-article-publish');
    return result({ ok: true, id, slug, status: draft.target_type === 'article' ? 'published' : 'pending', ...(publicSnapshotSynced === null ? {} : { publicSnapshotSynced }) });
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
    if (recent.filter(item => clock() - Date.parse(item.created_at) < 86400_000).length >= 5) return error('每天最多提交 5 位教师，请稍后再试', 429);
    const id = randomUUID();
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
    if (recent.filter(item => clock() - Date.parse(item.created_at) < 86400_000).length >= 10) return error('每天最多提交 10 次，请稍后再试', 429);
    const id = randomUUID();
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
    const publicSnapshotSynced = action === 'approve' ? await syncPublicSnapshot('teacher-approval') : null;
    return result({ ok: true, status, ...(publicSnapshotSynced === null ? {} : { publicSnapshotSynced }) });
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
    const eventId = randomUUID();
    await setDocument('review_events', eventId, { id: eventId, submission_id: submission.id, reviewer_id: auth.user.student_id, action, note, created_at: now() });
    await setDocument('submissions', submission.id, { ...submission, status: statuses[action], review_note: note, updated_at: now() });
    const publicSnapshotSynced = action === 'approve' ? await syncPublicSnapshot('article-approval') : null;
    return result({ ok: true, status: statuses[action], slug, ...(publicSnapshotSynced === null ? {} : { publicSnapshotSynced }) });
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
      const publicSnapshotSynced = await syncPublicSnapshot('admin-article-delete');
      return result({ ok: true, slug, publicSnapshotSynced });
    }
    const prepared = await validateSubmission(await readJson(request));
    if (prepared.error) return error(prepared.error);
    const [section_slug, title, summary, body_json, content_type, subject, author_label] = prepared.values;
    const updated = { ...existing, slug, section_slug, title, summary, body_json, content_type, subject, author_label, updated_at: now() };
    await setDocument('articles', slug, updated);
    const publicSnapshotSynced = await syncPublicSnapshot('admin-article-update');
    return result({ ok: true, article: mapArticle(updated), publicSnapshotSynced });
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

// Business mutations are committed as one immutable workflow generation. The
// Login/logout and visit endpoints are stateless or paused. Access-code role
// elevation persists data and therefore must use the same atomic path.
async function route(request) {
  const method = String(request.method || 'GET').toUpperCase();
  const path = normalizePath(request.url);
  const exempt = path === '/api/visits' || path === '/api/auth/login' || path === '/api/auth/logout';
  const mutation = !['GET', 'HEAD'].includes(method) && !exempt;
  if (!mutation || typeof store.runInTransaction !== 'function') return routeInner(request);
  if (!checkMutationOrigin(request)) return error('请求来源无效', 403);
  const idempotencyKey = String(request.headers['idempotency-key'] || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 200) {
    return result({ error: '请升级客户端后重试', upgradeRequired: true }, 409);
  }
  const body = await readJson(request, path === '/api/games/great-luhe/leaderboard' ? GAME_SCORE_BODY_MAX : 256 * 1024);
  const session = await readSession(request);
  const actor = session?.student_id || 'anonymous';
  if (typeof store.runIdempotent === 'function') {
    return store.runInTransaction(async () => {
      if (path !== '/api/games/great-luhe/leaderboard') await reconcilePendingPublicSnapshot();
      return store.runIdempotent({ actor, method, path, key: idempotencyKey, body }, () => routeInner(request));
    });
  }
  return store.runInTransaction(async () => {
    if (path !== '/api/games/great-luhe/leaderboard') await reconcilePendingPublicSnapshot();
    return routeInner(request);
  });
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
  if (!blocks || documentStats(blocks).characters < 50) return { error: '正文至少需要 50 个字' };
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

async function handler(request, response) {
  try {
    if (!sessionSecret || sessionSecret.length < 32) {
      return send(response, error('服务端尚未配置 SESSION_SECRET', 503));
    }
    send(response, await route(request));
  } catch (err) {
    logger.error(err);
    const status = err?.code === 'PG_REQUEST_BUDGET_EXCEEDED' || err?.status === 503 ? 503 : [409, 413, 429].includes(err?.status) ? err.status : 500;
    const message = status === 503 ? '存储服务当前繁忙，请稍后重试' : status === 409 ? '内容已在别处更新，请重试' : status === 413 ? '请求内容过大' : '服务器暂时无法处理请求';
    send(response, result({ error: message, ...(status === 409 ? { conflict: true } : {}), diagnostic: safeDiagnostic(err) }, status));
  }
}

  return { handler, normalizePath };
}

module.exports = { createApp };
