import { ADMIN_LOGIN_ID, CONTENT_TYPES, normalizeText, parseDocument, slugify, validLoginId, validStudentId } from '../shared/content.js';

const COOKIE = 'campus_session';
const encoder = new TextEncoder();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function b64url(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromB64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

async function makeSession(studentId, secret) {
  const payload = b64url(JSON.stringify({ studentId, exp: Date.now() + 7 * 86400_000 }));
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

async function readSession(request, env) {
  const rawCookie = request.headers.get('cookie') || '';
  const value = rawCookie.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value || !env.SESSION_SECRET) return null;
  const [payload, signature] = value.split('.');
  if (!payload || !signature) return null;
  const expected = await hmac(env.SESSION_SECRET, payload);
  const received = fromB64url(signature);
  if (expected.length !== received.length) return null;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ received[index];
  if (difference !== 0) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (!validLoginId(data.studentId) || data.exp < Date.now()) return null;
    const user = await env.DB.prepare('SELECT student_id, role, role_locked FROM users WHERE student_id = ?').bind(data.studentId).first();
    return user || null;
  } catch {
    return null;
  }
}

function cookie(value, maxAge = 604800) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function checkMutationOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function body(request) {
  try { return await request.json(); } catch { return null; }
}

function publicUser(user) {
  return user ? { studentId: user.student_id, maskedId: user.role === 'admin' ? '站点管理员' : '校内成员', role: user.role } : null;
}

function mapArticle(row) {
  return { ...row, body: parseDocument(row.body_json), body_json: undefined };
}

async function requireUser(request, env, roles = []) {
  const user = await readSession(request, env);
  if (!user) return { response: error('请先登入', 401) };
  if (roles.length && !roles.includes(user.role)) return { response: error('没有所需权限', 403) };
  return { user };
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method) && !checkMutationOrigin(request)) return error('请求来源无效', 403);

  if (request.method === 'GET' && path === '/api/bootstrap') {
    const [sections, articles] = await Promise.all([
      env.DB.prepare('SELECT slug, title, description, icon FROM sections ORDER BY sort_order').all(),
      env.DB.prepare('SELECT slug, section_slug, title, summary, content_type, subject, author_label, published_at, updated_at FROM articles ORDER BY published_at DESC').all()
    ]);
    return json({ sections: sections.results, articles: articles.results });
  }

  if (request.method === 'GET' && path.startsWith('/api/articles/')) {
    const slug = decodeURIComponent(path.slice('/api/articles/'.length));
    const row = await env.DB.prepare('SELECT * FROM articles WHERE slug = ?').bind(slug).first();
    return row ? json({ article: mapArticle(row) }) : error('没有找到这篇内容', 404);
  }

  if (request.method === 'GET' && path === '/api/session') {
    return json({ user: publicUser(await readSession(request, env)) });
  }

  if (request.method === 'POST' && path === '/api/auth/login') {
    const data = await body(request);
    const studentId = normalizeText(data?.studentId, 32);
    if (!validLoginId(studentId)) return error('抱歉，仅限本校学生编辑', 403);
    if (studentId === ADMIN_LOGIN_ID) {
      await env.DB.prepare(`INSERT INTO users (student_id, role, role_locked) VALUES (?, 'admin', 0) ON CONFLICT(student_id) DO UPDATE SET role='admin', role_locked=0, last_login_at=CURRENT_TIMESTAMP`).bind(studentId).run();
    } else {
      await env.DB.prepare(`INSERT INTO users (student_id) VALUES (?) ON CONFLICT(student_id) DO UPDATE SET last_login_at = CURRENT_TIMESTAMP`).bind(studentId).run();
    }
    const session = await makeSession(studentId, env.SESSION_SECRET);
    const user = await env.DB.prepare('SELECT student_id, role, role_locked FROM users WHERE student_id = ?').bind(studentId).first();
    return json({ user: publicUser(user) }, 200, { 'set-cookie': cookie(session) });
  }

  if (request.method === 'POST' && path === '/api/auth/logout') {
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }

  if (request.method === 'POST' && path === '/api/auth/access') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const data = await body(request);
    const code = normalizeText(data?.code, 200);
    if (!code) return error('请输入权限口令');
    if (auth.user.role_locked) return error('该账号的自助提权已停用，请联系管理员', 403);
    let role = null;
    if (env.ADMIN_BOOTSTRAP_CODE && code === env.ADMIN_BOOTSTRAP_CODE) role = 'admin';
    else if (env.REVIEWER_ACCESS_CODE && code === env.REVIEWER_ACCESS_CODE) role = 'reviewer';
    if (!role) return error('权限口令不正确', 403);
    await env.DB.prepare('UPDATE users SET role = ? WHERE student_id = ?').bind(role, auth.user.student_id).run();
    return json({ user: publicUser({ ...auth.user, role }) });
  }

  if (request.method === 'GET' && path === '/api/submissions/mine') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const rows = await env.DB.prepare(`SELECT id, section_slug, title, summary, body_json, content_type, subject, author_label, status, review_note, created_at, updated_at FROM submissions WHERE student_id = ? ORDER BY created_at DESC`).bind(auth.user.student_id).all();
    return json({ submissions: rows.results.map(row => ({ ...row, body: parseDocument(row.body_json), body_json: undefined })) });
  }

  if (request.method === 'POST' && path === '/api/submissions') {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const data = await body(request);
    const prepared = await validateSubmission(data, env);
    if (prepared.error) return error(prepared.error);
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS count FROM submissions WHERE student_id = ? AND created_at > datetime('now', '-1 day')`).bind(auth.user.student_id).first();
    if (recent.count >= 10) return error('每天最多提交 10 次，请稍后再试', 429);
    const result = await env.DB.prepare(`INSERT INTO submissions (student_id, section_slug, title, summary, body_json, content_type, subject, author_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(auth.user.student_id, ...prepared.values).run();
    return json({ id: result.meta.last_row_id, status: 'pending' }, 201);
  }

  const editMatch = path.match(/^\/api\/submissions\/(\d+)$/);
  if (request.method === 'PUT' && editMatch) {
    const auth = await requireUser(request, env);
    if (auth.response) return auth.response;
    const existing = await env.DB.prepare('SELECT student_id, status FROM submissions WHERE id = ?').bind(editMatch[1]).first();
    if (!existing || existing.student_id !== auth.user.student_id) return error('没有找到这份投稿', 404);
    if (!['pending', 'changes_requested'].includes(existing.status)) return error('当前状态不能修改', 409);
    const prepared = await validateSubmission(await body(request), env);
    if (prepared.error) return error(prepared.error);
    await env.DB.prepare(`UPDATE submissions SET section_slug=?, title=?, summary=?, body_json=?, content_type=?, subject=?, author_label=?, status='pending', review_note='', updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(...prepared.values, editMatch[1]).run();
    return json({ ok: true, status: 'pending' });
  }

  if (request.method === 'GET' && path === '/api/review') {
    const auth = await requireUser(request, env, ['reviewer', 'admin']);
    if (auth.response) return auth.response;
    const status = ['pending', 'changes_requested', 'approved', 'rejected'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
    const rows = await env.DB.prepare(`SELECT s.*, sec.title AS section_title FROM submissions s JOIN sections sec ON sec.slug=s.section_slug WHERE s.status=? ORDER BY s.created_at ASC LIMIT 100`).bind(status).all();
    return json({ submissions: rows.results.map(row => ({ ...row, student_id: '匿名校内成员', body: parseDocument(row.body_json), body_json: undefined })) });
  }

  const reviewMatch = path.match(/^\/api\/review\/(\d+)$/);
  if (request.method === 'POST' && reviewMatch) {
    const auth = await requireUser(request, env, ['reviewer', 'admin']);
    if (auth.response) return auth.response;
    const data = await body(request);
    const action = data?.action;
    const note = normalizeText(data?.note, 1000);
    const statuses = { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected' };
    if (!statuses[action]) return error('未知审核操作');
    if (action !== 'approve' && !note) return error('退回修改或拒绝时请填写原因');
    const submission = await env.DB.prepare('SELECT * FROM submissions WHERE id=?').bind(reviewMatch[1]).first();
    if (!submission || !['pending', 'changes_requested'].includes(submission.status)) return error('投稿不存在或已经处理', 409);
    const statements = [
      env.DB.prepare(`UPDATE submissions SET status=?, review_note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(statuses[action], note, submission.id),
      env.DB.prepare(`INSERT INTO review_events (submission_id, reviewer_id, action, note) VALUES (?, ?, ?, ?)`).bind(submission.id, auth.user.student_id, action, note)
    ];
    let slug = null;
    if (action === 'approve') {
      slug = slugify(submission.title);
      statements.push(env.DB.prepare(`INSERT INTO articles (slug, section_slug, title, summary, body_json, content_type, subject, author_label, source_submission_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(slug, submission.section_slug, submission.title, submission.summary, submission.body_json, submission.content_type, submission.subject, submission.author_label, submission.id));
    }
    await env.DB.batch(statements);
    return json({ ok: true, status: statuses[action], slug });
  }

  if (request.method === 'GET' && path === '/api/admin/users') {
    const auth = await requireUser(request, env, ['admin']);
    if (auth.response) return auth.response;
    const rows = await env.DB.prepare(`SELECT student_id, role, role_locked, created_at, last_login_at FROM users WHERE role != 'student' OR role_locked = 1 ORDER BY role, created_at`).all();
    return json({ users: rows.results });
  }

  if (request.method === 'POST' && path === '/api/admin/roles') {
    const auth = await requireUser(request, env, ['admin']);
    if (auth.response) return auth.response;
    const data = await body(request);
    const studentId = normalizeText(data?.studentId, 9);
    const role = data?.role;
    if (!validStudentId(studentId) || !['student', 'reviewer', 'admin'].includes(role)) return error('账号或角色无效');
    if (studentId === auth.user.student_id && role !== 'admin') return error('不能撤销自己的管理员权限');
    const locked = role === 'student' ? 1 : 0;
    await env.DB.prepare(`INSERT INTO users (student_id, role, role_locked) VALUES (?, ?, ?) ON CONFLICT(student_id) DO UPDATE SET role=excluded.role, role_locked=excluded.role_locked`).bind(studentId, role, locked).run();
    return json({ ok: true });
  }

  return error('API 路径不存在', 404);
}

async function validateSubmission(data, env) {
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
  if (!await env.DB.prepare('SELECT 1 FROM sections WHERE slug=?').bind(section).first()) return { error: '分区不存在' };
  return { values: [section, title, summary, JSON.stringify(blocks), contentType, subject, authorLabel] };
}

export default {
  async fetch(request, env) {
    try {
      if (new URL(request.url).pathname.startsWith('/api/')) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return error('服务器暂时无法处理请求', 500);
    }
  }
};
