import { formatDate } from './date.js';
import { BlockEditor, EDITOR_SCHEMA_VERSION, normalizeBlocks } from './editor.js?v=20260813-editor-studio';
import { renderMath } from './math-renderer.js?v=20260813-editor-studio';
import { DraftManager, clearLocalDraft, clearUserLocalDrafts, draftKeyFor } from './draft-manager.js?v=20260813-editor-studio';
import { changelogPage } from './changelog.js?v=20260813-changelog';

const state = { sections: [], articles: [], contributors: [], teacherAdditions: [], drafts: [], user: null, visitCount: null, search: '', editing: null, articleEditing: null, reviewEditing: null, articleCacheBust: null, contributionPreset: null, teacherQuery: '', teacherSubject: '全部', activeDraftManager: null, activeEditor: null, forceNewDraft: false };
const app = document.querySelector('#app');
const loginDialog = document.querySelector('#login-dialog');
const statusLabels = { pending: '等待审核', changes_requested: '需修改', approved: '已发布', rejected: '未采用' };
const CACHE_VERSION = '20260811-visit-batching';
const BOOTSTRAP_CACHE_KEY = `lhwiki:bootstrap:${CACHE_VERSION}`;
const SESSION_CACHE_KEY = `lhwiki:session:${CACHE_VERSION}`;
const VISIT_BROWSER_KEY = 'lhwiki:visit:browser';
const VISIT_PENDING_KEY = 'lhwiki:visit:pending';
const VISIT_BATCH_KEY = 'lhwiki:visit:batch';
const VISIT_TOTAL_KEY = 'lhwiki:visit:total';
const BOOTSTRAP_TTL = 15 * 60_000;
const SESSION_TTL = 5 * 60_000;
const VISIT_TOTAL_TTL = 6 * 60 * 60_000;
const VISIT_FLUSH_DELAY = 20_000;
const VISIT_BATCH_MAX = 20;
let visitFlushTimer = null;
let baseTeachers = null;

async function ensureTeachers() {
  if (!baseTeachers) ({ TEACHERS: baseTeachers } = await import('./teachers.js?v=20260810-directory-supplement-2'));
  return baseTeachers;
}

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const maxAttempts = method === 'GET' ? 2 : 1;
  let response;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      response = await fetch(path, {
        ...options,
        method,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', ...options.headers },
        body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
      });
      if (attempt < maxAttempts && [502, 503, 504].includes(response.status)) {
        await response.text().catch(() => '');
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
        continue;
      }
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      await new Promise(resolve => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  if (!response) {
    throw new Error(lastError?.name === 'AbortError' ? '请求超时，请检查网络后重试' : '网络暂时不可用，请稍后重试');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = new Error(data.error || '请求失败');
    failure.status = response.status;
    failure.data = data;
    throw failure;
  }
  return data;
}

function readCache(storage, key, ttl) {
  try {
    const cached = JSON.parse(storage.getItem(key) || 'null');
    return cached?.savedAt && Date.now() - cached.savedAt < ttl ? cached.value : null;
  } catch {
    return null;
  }
}

function writeCache(storage, key, value) {
  try { storage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* private mode can disable storage */ }
}

function clearCache(storage, key) {
  try { storage.removeItem(key); } catch { /* private mode can disable storage */ }
}

function applyBootstrap(bootstrap) {
  state.sections = bootstrap.sections || [];
  state.articles = bootstrap.articles || [];
  state.contributors = bootstrap.contributors || [];
  state.teacherAdditions = bootstrap.teacherAdditions || [];
}

async function loadBootstrap({ force = false } = {}) {
  if (!force) {
    const cached = readCache(localStorage, BOOTSTRAP_CACHE_KEY, BOOTSTRAP_TTL);
    if (cached) return cached;
  }
  const bootstrap = await api(force ? `/api/bootstrap?refresh=${Date.now()}` : '/api/bootstrap', force ? { cache: 'reload' } : {});
  writeCache(localStorage, BOOTSTRAP_CACHE_KEY, bootstrap);
  return bootstrap;
}

async function refreshBootstrap() {
  const bootstrap = await loadBootstrap({ force: true });
  applyBootstrap(bootstrap);
  return bootstrap;
}

async function loadSession() {
  const cached = readCache(sessionStorage, SESSION_CACHE_KEY, SESSION_TTL);
  if (cached) return cached;
  const session = await api('/api/session');
  writeCache(sessionStorage, SESSION_CACHE_KEY, session);
  return session;
}

function cacheSession(user) {
  writeCache(sessionStorage, SESSION_CACHE_KEY, { user });
}

function toast(message) {
  const element = document.querySelector('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2600);
}

function route() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/').filter(Boolean).map(decodeURIComponent);
  return { page: parts[0] || 'home', value: parts[1] };
}

function navLink(href, icon, label, active) {
  return `<a class="nav-link ${active ? 'active' : ''}" href="${href}"><span class="emoji">${icon}</span><span>${esc(label)}</span></a>`;
}

function shell(content) {
  const current = route();
  const roleTools = state.user && ['reviewer', 'admin'].includes(state.user.role)
    ? navLink('#/review', '✓', '审核投稿', ['review', 'admin-review-edit'].includes(current.page)) : '';
  const adminTools = state.user?.role === 'admin' ? navLink('#/admin', '⚙', '权限管理', current.page === 'admin') : '';
  app.innerHTML = `<div class="shell">
    <aside class="sidebar" id="sidebar">
      <a class="brand" href="#/"><span class="brand-mark">LH</span><span><strong>LHwiki</strong><small>潞河学生经验档案</small></span></a>
      <div class="nav-label">浏览</div>
      ${navLink('#/', '⌂', '首页', current.page === 'home')}
      ${navLink('#/teachers', '师', '教师索引', current.page === 'teachers' || current.page === 'teacher')}
      ${state.sections.map(section => navLink(`#/section/${encodeURIComponent(section.slug)}`, section.icon, section.title, current.page === 'section' && current.value === section.slug)).join('')}
      <div class="nav-label">参与</div>
      ${navLink('#/contribute', '✎', '提交内容', current.page === 'contribute')}
      ${navLink('#/thanks', '名', '致谢', current.page === 'thanks')}
      ${state.user ? navLink('#/mine', '◷', '我的投稿', current.page === 'mine') : ''}
      ${roleTools}${adminTools}
      <div class="side-footer"><p>把经验说具体，也给不同的经历留位置。</p><a href="#/about" class="button small">阅读共建说明</a></div>
      <div class="sidebar-changelog">${navLink('#/changelog', '↻', '更新日志', current.page === 'changelog')}</div>
    </aside>
    <main class="main">
      <header class="topbar">
        <button class="icon-button mobile-menu" id="mobile-menu" aria-label="打开目录">☰</button>
        <label class="search"><span>⌕</span><input id="search" value="${esc(state.search)}" placeholder="搜索老师、课程、社团或经验" aria-label="搜索"></label>
        <div class="actions">
          <a class="button primary" href="#/contribute"><span>＋</span><span class="contribute-label">提交内容</span></a>
          ${userControl()}
        </div>
      </header>
      <div class="content">${content}</div>
    </main>
  </div>`;
  bindShell();
}

function userControl() {
  if (!state.user) return `<button class="button" data-login>登入</button>`;
  return `<div class="user-menu"><button class="avatar" id="user-menu-button" aria-label="账号菜单">${state.user.role === 'admin' ? '管' : state.user.role === 'reviewer' ? '审' : '同'}</button>
    <div class="menu" id="user-menu" hidden><div class="menu-info">${esc(state.user.maskedId)} · ${roleName(state.user.role)}</div>
      <a href="#/mine">我的投稿</a>
      <button data-access>输入权限口令</button>
      <button data-logout>退出登入</button>
    </div></div>`;
}

function roleName(role) { return ({ student: '投稿者', reviewer: '审核者', admin: '管理员' })[role] || role; }

function bindShell() {
  document.querySelector('#mobile-menu')?.addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
  document.querySelectorAll('[data-login]').forEach(button => button.addEventListener('click', () => loginDialog.showModal()));
  const menuButton = document.querySelector('#user-menu-button');
  menuButton?.addEventListener('click', () => { const menu = document.querySelector('#user-menu'); menu.hidden = !menu.hidden; });
  document.querySelector('[data-logout]')?.addEventListener('click', logout);
  document.querySelector('[data-access]')?.addEventListener('click', redeemAccess);
  bindTeacherReviewButtons();
  document.querySelector('#search')?.addEventListener('input', event => {
    state.search = event.target.value;
    if (route().page !== 'search') history.replaceState(null, '', '#/search');
    document.querySelector('.content').innerHTML = searchPage();
  });
}

function bindTeacherReviewButtons() {
  document.querySelectorAll('[data-review-teacher]').forEach(button => button.addEventListener('click', () => {
    state.contributionPreset = { sectionSlug: 'courses', contentType: '评价', subject: button.dataset.reviewTeacher, title: `关于${button.dataset.reviewTeacher}老师的一段课堂体验` };
    location.hash = '#/contribute';
  }));
}

function allTeachers() {
  const seen = new Set();
  return [...(baseTeachers || []), ...state.teacherAdditions].filter(teacher => {
    const key = teacher.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function home() {
  return `<section class="hero"><div class="hero-copy"><span class="eyebrow">LUHE · WRITTEN BY STUDENTS</span>
    <h1>在潞园生活，<br>也把潞园写下来</h1>
    <p>这里收集那些“如果早一点知道就好了”的具体经验。不是标准答案，也不是匿名打分榜，而是一个个有背景、有细节、愿意对读者负责的讲述。</p>
    <div class="hero-actions"><a href="#/section/start" class="button primary">从第一篇开始</a><a href="#/contribute" class="button ghost">写下你的版本</a></div></div><div class="hero-year">1867—NOW</div></section>
    <div class="home-intro"><span>LHwiki / 潞河学生经验档案</span><p>官网告诉我们学校是什么样；这里更想回答，在其中度过一天、一学期、三年，究竟是什么感受。</p></div>
    <div class="section-heading"><div><h2>从哪里开始？</h2><p>按场景浏览，也可以直接搜索你关心的人和事。</p></div><a href="#/teachers" class="text-link">浏览教师索引 →</a></div>
    <div class="section-grid">${state.sections.map(sectionCard).join('')}</div>
    <div class="section-heading"><div><h2>最近更新</h2><p>由同学投稿、经审核后公开的内容。</p></div></div>
    ${articleList(state.articles.slice(0, 6))}`;
}

function sectionCard(section) {
  const count = state.articles.filter(article => article.section_slug === section.slug).length;
  return `<a class="section-card" href="#/section/${encodeURIComponent(section.slug)}"><span class="emoji">${section.icon}</span><h3>${esc(section.title)}</h3><p>${esc(section.description)}</p><div class="meta" style="margin-top:12px">${count} 篇内容 →</div></a>`;
}

function articleList(articles) {
  if (!articles.length) return `<div class="empty"><span class="emoji">✦</span>这个分区还在等第一位分享者。</div>`;
  return `<div class="article-list">${articles.map(article => `<a class="article-row" href="#/article/${encodeURIComponent(article.slug)}"><div><h3>${esc(article.title)}</h3><p>${esc(article.summary)}</p></div><div class="article-meta"><span class="tag">${esc(article.content_type)}</span><span>${esc(article.author_label)}</span></div></a>`).join('')}</div>`;
}

function sectionPage(slug) {
  const section = state.sections.find(item => item.slug === slug);
  if (!section) return notFound();
  const articles = state.articles.filter(article => article.section_slug === slug);
  return `<div class="breadcrumbs"><a href="#/">首页</a>　/　${esc(section.title)}</div><header class="page-heading"><span class="eyebrow">${section.icon} Section</span><h1>${esc(section.title)}</h1><p>${esc(section.description)}</p></header>${articleList(articles)}`;
}

function teacherDirectory() {
  const fullIndex = allTeachers();
  const subjects = ['全部', ...new Set(fullIndex.map(item => item.subject).filter(item => item !== '学科待补充'))];
  const teachers = filteredTeachers(fullIndex);
  const officialCount = baseTeachers.filter(teacher => teacher.sourceUrl).length;
  const supplementedCount = fullIndex.length - officialCount;
  setTimeout(bindTeacherFilters, 0);
  return `<header class="page-heading teacher-heading"><span class="eyebrow">PUBLIC FACULTY INDEX</span><div class="teacher-heading-row"><div><h1>教师索引</h1><p>这里汇集官网公开教师资料与经审核的校内补充记录。当前包含 ${officialCount} 篇官网资料和 ${supplementedCount} 位补充教师；由于官网并非实时花名册，索引仍可能遗漏任课教师。</p></div><a class="button primary" href="#/teacher-submit">补充一位老师</a></div></header>
    <div class="source-note"><strong>怎样补充教师</strong><span>只需填写姓名、任教学科和可选格言。资料不会立即公开，而会先进入与文章投稿相同的审核流程；审核通过后才加入正式索引。请勿填写联系方式、班级安排或其他私人信息。</span></div>
    <div class="source-note"><strong>关于匿名评价</strong><span>评价不会即时公开，而是进入审核队列。请写清年级、课程场景和大致时间；只谈亲身体验，不公开联系方式、家庭、成绩等隐私，也不接受人身攻击或未经核实的指控。</span></div>
    <div class="teacher-tools"><label class="teacher-search">搜索教师<input id="teacher-search" value="${esc(state.teacherQuery)}" placeholder="输入姓名、学科或关键词"></label><div class="subject-tabs">${subjects.map(subject => `<button class="subject-tab ${state.teacherSubject === subject ? 'active' : ''}" data-subject="${esc(subject)}">${esc(subject)}</button>`).join('')}</div></div>
    ${teacherResults(teachers)}`;
}

function filteredTeachers(fullIndex = allTeachers()) {
  const query = state.teacherQuery.trim().toLowerCase();
  return fullIndex.filter(teacher => (!query || `${teacher.name}${teacher.subject}${teacher.motto}${teacher.profile}`.toLowerCase().includes(query)) && (state.teacherSubject === '全部' || teacher.subject === state.teacherSubject));
}

function teacherResults(teachers = filteredTeachers()) {
  return `<div class="teacher-count">当前显示 ${teachers.length} 位</div>
    <div class="teacher-grid">${teachers.map(teacherCard).join('')}</div>`;
}

function renderTeacherResults() {
  const content = document.querySelector('.content');
  const count = content?.querySelector('.teacher-count');
  const grid = content?.querySelector('.teacher-grid');
  if (!count || !grid) return;
  const teachers = filteredTeachers();
  count.textContent = `当前显示 ${teachers.length} 位`;
  grid.innerHTML = teachers.map(teacherCard).join('');
  bindTeacherReviewButtons();
}

function teacherCard(teacher) {
  const reviewCount = state.articles.filter(article => article.section_slug === 'courses' && article.subject === teacher.name).length;
  return `<article class="teacher-card"><a href="#/teacher/${encodeURIComponent(teacher.id)}" class="teacher-card-main"><div class="teacher-monogram">${esc(teacher.name.slice(0, 1))}</div><div><div class="teacher-name"><h2>${esc(teacher.name)}</h2><span>${esc(teacher.subject)}</span></div>${teacher.motto ? `<p>${esc(teacher.motto)}</p>` : ''}</div></a><footer><span>${reviewCount ? `${reviewCount} 篇已审核分享` : '等待第一篇课堂记录'}</span><button class="text-button" data-review-teacher="${esc(teacher.name)}">匿名分享经历</button></footer></article>`;
}

function bindTeacherFilters() {
  document.querySelector('#teacher-search')?.addEventListener('input', event => { state.teacherQuery = event.target.value; renderTeacherResults(); });
  document.querySelectorAll('[data-subject]').forEach(button => button.addEventListener('click', () => {
    state.teacherSubject = button.dataset.subject;
    document.querySelectorAll('[data-subject]').forEach(tab => tab.classList.toggle('active', tab.dataset.subject === state.teacherSubject));
    renderTeacherResults();
  }));
  bindTeacherReviewButtons();
}

function teacherPage(id) {
  const teacher = allTeachers().find(item => item.id === id);
  if (!teacher) return notFound();
  const reviews = state.articles.filter(article => article.section_slug === 'courses' && article.subject === teacher.name);
  const philosophy = teacher.motto ? `<p class="teacher-philosophy">${esc(teacher.motto)}</p>` : '';
  const profile = teacher.profile ? `<p class="teacher-public-profile">${esc(teacher.profile)}</p>` : '';
  const sourceLink = teacher.sourceUrl ? `<a class="source-link" href="${esc(teacher.sourceUrl)}" target="_blank" rel="noreferrer">查看官网完整资料 ↗</a>` : '';
  const sourceNote = teacher.sourceUrl
    ? '<div class="source-note"><strong>资料边界</strong><span>本页只展示公开职业信息。下方文章均为投稿者的个人经历，经内容审核后发布，不代表学校、教师或本站的统一结论。</span></div>'
    : '<div class="source-note"><strong>资料状态</strong><span>本条为校内补充的姓名与学科记录，暂未收录公开介绍或来源资料。</span></div>';
  return `<div class="breadcrumbs"><a href="#/">首页</a>　/　<a href="#/teachers">教师索引</a></div><header class="teacher-profile"><div class="teacher-monogram large">${esc(teacher.name.slice(0, 1))}</div><div><span class="eyebrow">${esc(teacher.subject)}</span><h1>${esc(teacher.name)}</h1>${philosophy}${profile}${sourceLink}</div></header>
    ${sourceNote}
    <div class="section-heading"><div><h2>课堂与相处经验</h2><p>具体经历比星级打分更有帮助。</p></div><button class="button primary" data-review-teacher="${esc(teacher.name)}">匿名分享经历</button></div>${articleList(reviews)}`;
}

function teacherSubmissionPage() {
  if (!state.user) {
    return `<header class="page-heading"><span class="eyebrow">补全索引</span><h1>补充一位老师</h1><p>教师资料提交后会先进入审核，不会直接公开。</p></header><div class="notice warn">请先登入校内学号，再提交教师资料。<button class="button" data-login type="button">登入</button></div>`;
  }
  setTimeout(bindTeacherSubmissionForm, 0);
  return `<div class="breadcrumbs"><a href="#/teachers">教师索引</a>　/　补充教师</div><header class="page-heading teacher-submit-heading"><span class="eyebrow">COMMUNITY ADDITION</span><h1>补充一位老师</h1><p>官网资料可能滞后或遗漏。你提供的基础信息会由审核者核对，批准后才进入正式教师索引。</p></header>
    <div class="teacher-submit-layout"><form class="form-card teacher-submit-card" id="teacher-submit-form"><div class="form-grid"><label>教师姓名 <span class="required-mark">必填</span><input name="name" maxlength="30" autocomplete="off" required placeholder="例如：王老师的完整姓名"></label><label>任教学科 <span class="required-mark">必填</span><input name="subject" maxlength="30" list="teacher-subjects" autocomplete="off" required placeholder="例如：语文、数学、化学"></label></div><datalist id="teacher-subjects">${['语文','数学','英语','物理','化学','生物','政治','历史','地理','体育','音乐','美术','信息技术','心理'].map(subject => `<option value="${subject}">`).join('')}</datalist><label>格言 <span class="field-help">选填，最多 240 字</span><textarea name="motto" maxlength="240" placeholder="可以留空；如填写，请尽量保持老师原本的表达"></textarea></label><div class="form-error"></div><div class="form-actions"><a class="button" href="#/teachers">取消</a><button class="button primary" type="submit">提交审核</button></div></form>
    <aside class="teacher-submit-note"><strong>审核边界</strong><p>姓名与学科必须完整；格言可以不填。审核者会检查重复记录和明显错误，不会把提交者学号公开在教师页面。</p><p>若想分享课堂体验，请回到教师页面使用“匿名分享经历”。</p></aside></div>`;
}

function bindTeacherSubmissionForm() {
  const form = document.querySelector('#teacher-submit-form');
  if (!form) return;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const errorElement = form.querySelector('.form-error');
    const button = form.querySelector('button[type="submit"]');
    errorElement.textContent = '';
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      await api('/api/teacher-submissions', { method: 'POST', body: values });
      form.reset();
      toast('教师资料已提交审核');
      form.insertAdjacentHTML('beforebegin', '<div class="notice">提交成功。审核通过后，这位老师会自动加入教师索引。</div>');
    } catch (err) {
      errorElement.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function articlePage(slug) {
  shell(`<div class="empty">正在翻到这一页…</div>`);
  try {
    const cacheBust = state.articleCacheBust === slug ? `?refresh=${Date.now()}` : '';
    state.articleCacheBust = null;
    const { article } = await api(`/api/articles/${encodeURIComponent(slug)}${cacheBust}`, { cache: 'no-store' });
    const section = state.sections.find(item => item.slug === article.section_slug);
    const adminActions = state.user?.role === 'admin' ? `<div class="form-actions"><button class="button" type="button" data-admin-edit-article>编辑已发布稿件</button><button class="button danger" type="button" data-admin-delete-article>删除稿件</button></div>` : '';
    shell(`<div class="article-layout"><article><div class="breadcrumbs"><a href="#/">首页</a>　/　<a href="#/section/${esc(article.section_slug)}">${esc(section?.title || '')}</a></div>
      <header class="page-heading"><div class="article-meta"><span class="tag">${esc(article.content_type)}</span>${article.subject ? `<span>${esc(article.subject)}</span>` : ''}</div><h1>${esc(article.title)}</h1><p>${esc(article.summary)}</p><div class="meta" style="margin-top:18px">撰写：${esc(article.author_label)}　·　更新于 ${date(article.updated_at)}</div></header>
      ${adminActions}<div class="prose" id="article-body"></div></article>
      <aside class="article-aside" id="article-aside"><div class="reading-note"><strong>阅读提示</strong>内容来自个人经历，时间和情境可能不同。涉及重要决定时，请同时参考官方信息和更多观点。</div></aside></div>`);
    const headings = renderBlocks(document.querySelector('#article-body'), article.body, { anchors: true });
    renderArticleToc(document.querySelector('#article-aside'), headings);
    document.querySelector('[data-admin-edit-article]')?.addEventListener('click', () => {
      state.articleEditing = article;
      location.hash = `#/admin-article-edit/${encodeURIComponent(article.slug)}`;
    });
    document.querySelector('[data-admin-delete-article]')?.addEventListener('click', async () => {
      if (!confirm(`确定删除《${article.title}》吗？此操作不会删除原投稿和审核记录。`)) return;
      try {
        await api(`/api/admin/articles/${encodeURIComponent(article.slug)}`, { method: 'DELETE' });
        await refreshBootstrap();
        toast('已删除已发布稿件');
        location.hash = '#/';
      } catch (err) { toast(err.message); }
    });
  } catch (err) { shell(errorView(err.message)); }
}

function aboutPage() {
  return `<header class="page-heading"><span class="eyebrow">关于共建</span><h1>一种经验，不是一个结论</h1><p>LHwiki 关注潞河生活中具体、真实且有参考价值的经历。</p></header>
    <div class="prose" style="max-width:760px"><h2>适合写什么</h2><p>我们欢迎人物访谈、课程与社团体验、高三备考复盘，以及对校园生活的具体观察。评价应说明发生的时间、场景和个人立场，让读者能够理解结论从何而来。</p>
    <h2>不适合写什么</h2><p>请勿披露他人的联系方式、家庭情况、成绩等隐私；请勿提交未经核实的指控、侮辱性内容或单纯情绪宣泄。涉及老师、社团和课程时，优先描述事实和自己的体验。</p>
    <blockquote>学号仅用于筛选校内成员和保存投稿记录，不会出现在公开文章或审核队列中。公开文章只显示作者主动选择的署名。</blockquote>
    <h2>审核原则</h2><p>审核只判断内容是否具体、清晰、尊重隐私并适合公开，不要求观点一致。面对相互矛盾的经历，我们更倾向于并列呈现并注明背景。</p></div>`;
}

function snapshotFromSource(source = {}, preset = null) {
  const anonymous = source.anonymous === true || source.author_label === '匿名同学';
  return {
    sectionSlug: source.sectionSlug || source.section_slug || preset?.sectionSlug || '',
    contentType: source.contentType || source.content_type || preset?.contentType || '经验',
    title: source.title || preset?.title || '',
    summary: source.summary || '',
    subject: source.subject || preset?.subject || '',
    authorLabel: anonymous ? '' : source.authorLabel || source.author_label || '',
    anonymous,
    body: normalizeBlocks(source.body || [])
  };
}

async function resolveWritingContext() {
  const current = route();
  const { drafts } = await api('/api/drafts/mine');
  state.drafts = drafts;
  if (current.page === 'admin-article-edit') {
    if (state.user?.role !== 'admin') throw new Error('需要管理员权限');
    const slug = current.value || state.articleEditing?.slug;
    if (!slug) throw new Error('没有选择要编辑的已发布文章');
    const article = state.articleEditing?.slug === slug ? state.articleEditing : (await api(`/api/articles/${encodeURIComponent(slug)}`, { cache: 'no-store' })).article;
    return { targetType: 'article', targetId: slug, source: article, draft: drafts.find(item => item.draftKey === `article:${slug}`), isArticleEdit: true };
  }
  if (current.page === 'admin-review-edit') {
    if (state.user?.role !== 'admin') throw new Error('需要管理员权限');
    const submissionId = current.value || state.reviewEditing?.id;
    if (!submissionId) throw new Error('没有选择要编辑的待审核稿件');
    const submission = state.reviewEditing?.id === submissionId
      ? state.reviewEditing
      : (await api('/api/review')).submissions.find(item => item.id === submissionId);
    if (!submission) throw new Error('没有找到这份待审核稿件');
    return { targetType: 'submission', targetId: submission.id, source: submission, draft: drafts.find(item => item.draftKey === `submission:${submission.id}`), isArticleEdit: false, isReviewEdit: true };
  }
  const token = current.value || '';
  if (token.startsWith('draft:')) {
    const draft = drafts.find(item => item.id === token.slice(6));
    if (!draft) throw new Error('没有找到这份草稿');
    return { targetType: draft.targetType, targetId: draft.targetId, source: draft, draft, isArticleEdit: draft.targetType === 'article' };
  }
  let submissionId = token.startsWith('submission:') ? token.slice(11) : state.editing?.id;
  if (submissionId) {
    const { submissions } = await api('/api/submissions/mine');
    const submission = submissions.find(item => item.id === submissionId);
    if (!submission) throw new Error('没有找到这份投稿');
    return { targetType: 'submission', targetId: submission.id, source: submission, draft: drafts.find(item => item.draftKey === `submission:${submission.id}`), isArticleEdit: false };
  }
  if (!state.forceNewDraft && !state.contributionPreset) {
    const existingNewDraft = drafts.find(item => item.targetType === 'new');
    if (existingNewDraft) return { targetType: 'new', targetId: null, source: existingNewDraft, draft: existingNewDraft, isArticleEdit: false };
  }
  state.forceNewDraft = false;
  return { targetType: 'new', targetId: null, source: {}, draft: null, isArticleEdit: false };
}

async function contributePage() {
  if (!state.user) {
    shell(`<header class="page-heading"><span class="eyebrow">参与共建</span><h1>分享一段值得留下的经历</h1><p>无需 GitHub，也无需学习 Markdown。</p></header><div class="form-card empty"><p>登入后即可开始撰写；内容会自动保存为仅你可见的草稿。</p><button class="button primary" data-login>用学号登入</button></div>`);
    return;
  }
  shell('<div class="empty">正在打开写作页…</div>');
  try {
    const context = await resolveWritingContext();
    const initial = snapshotFromSource(context.source, context.draft ? null : state.contributionPreset);
    const title = context.isArticleEdit ? `编辑《${esc(initial.title)}》` : context.isReviewEdit ? `校订《${esc(initial.title)}》` : context.targetType === 'submission' ? '继续修改这份投稿' : '把经历写具体';
    shell(`<header class="page-heading writing-heading"><span class="eyebrow">${context.isArticleEdit ? '管理已发布内容' : context.isReviewEdit ? '管理员校订待审核稿件' : context.targetType === 'submission' ? '修改后重新审核' : '自动保存的写作页'}</span><h1>${title}</h1><p>${context.isReviewEdit ? '修改会保存回原待审核稿件，并继续留在审核队列，不会自动发布。' : '直接写下内容即可。按 Enter 新建段落，输入 / 切换格式，系统会自动保存。'}</p></header>
      <form class="writing-layout" id="contribution-form">
        <section class="writing-paper">
          <div class="notice compact">学号只用于校内成员筛选和保存投稿记录，不会出现在公开内容或审核队列中。</div>
          <div class="writing-meta"><div class="form-grid"><label>投稿分区<select name="sectionSlug" required><option value="">请选择</option>${state.sections.map(section => `<option value="${esc(section.slug)}">${section.icon} ${esc(section.title)}</option>`).join('')}</select></label><label>内容类型<select name="contentType" required>${['访谈','评价','经验','指南'].map(type => `<option>${type}</option>`).join('')}</select></label></div>
          <label class="title-field"><span>标题</span><input name="title" maxlength="100" placeholder="给这段经历一个具体的标题" required></label>
          <label><span>一句话摘要</span><textarea name="summary" maxlength="240" placeholder="告诉读者背景、重点和适合谁阅读" required></textarea></label>
          <label><span>评价对象或访谈主题（选填）</span><input name="subject" maxlength="80" placeholder="例如：文学社 / 高三一轮复习"></label></div>
          <div class="editor-chrome"><button type="button" class="editor-insert" data-editor-insert aria-label="插入内容块">＋ <span>插入</span></button><span class="editor-hint">输入 / 搜索命令 · Enter 新段落 · Shift+Enter 换行</span></div>
          <div id="block-editor" class="block-editor" aria-label="文章正文"></div>
          <div class="byline-panel"><div><label>署名<input name="authorLabel" maxlength="40" placeholder="例如：陈同学 / Chenrx"></label><label class="checkbox"><input type="checkbox" name="anonymous"> 公开时显示为“匿名同学”</label></div><aside class="credit-note"><strong>让名字和经验一起留下</strong><p>实名投稿通过审核后，署名会进入「致谢」。每个学号只记录第一次实名署名；匿名投稿不会受到区别审核。</p><a href="#/thanks">查看致谢板块 →</a></aside></div>
          <div class="notice warn">提交前请删除他人的联系方式、成绩、家庭情况等隐私。评价他人时，请描述事实与个人感受。</div>
        </section>
        <aside class="writing-status"><div class="save-state" data-save-state="saved" aria-live="polite"><span class="save-dot"></span><strong data-save-message>准备自动保存</strong><small data-save-revision></small></div><dl class="writing-stats"><div><dt>正文字符</dt><dd data-character-count>0</dd></div><div><dt>内容块</dt><dd data-block-count>1</dd></div></dl><div class="conflict-panel" data-conflict-panel hidden><strong>发现另一个版本</strong><p>为了避免覆盖，自动保存已经暂停。</p><button type="button" class="button small" data-use-cloud>采用云端版本</button><button type="button" class="button small" data-keep-copy>保留为新草稿</button></div><button type="button" class="button" data-save-now>立即保存</button><button type="button" class="button" data-preview>预览文章</button><button class="button primary" type="submit">${context.isArticleEdit ? '保存公开文章' : context.isReviewEdit ? '保存并返回审核' : '提交审核'}</button><div class="draft-danger"><button type="button" class="button danger-quiet" data-delete-current-draft>删除这份草稿</button><small>清除本机与云端尚未提交的内容</small></div><p class="form-error" data-form-error></p></aside>
        <dialog class="preview-dialog" id="preview-dialog"><div class="preview-head"><strong>投稿预览</strong><button type="button" class="icon-button" data-close-preview aria-label="关闭预览">×</button></div><article class="prose" id="preview-prose"></article></dialog>
      </form>`);
    bindEditorExperience(context, initial);
  } catch (err) {
    shell(errorView(err.message));
  }
}

function setFormSnapshot(form, snapshot) {
  for (const name of ['sectionSlug', 'contentType', 'title', 'summary', 'subject', 'authorLabel']) {
    if (form.elements[name]) form.elements[name].value = snapshot[name] || '';
  }
  form.elements.anonymous.checked = Boolean(snapshot.anonymous);
}

function collectSnapshot(form, editor) {
  return {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    sectionSlug: form.elements.sectionSlug.value,
    contentType: form.elements.contentType.value,
    title: form.elements.title.value,
    summary: form.elements.summary.value,
    subject: form.elements.subject.value,
    authorLabel: form.elements.authorLabel.value,
    anonymous: form.elements.anonymous.checked,
    body: editor.getBlocks()
  };
}

function bindEditorExperience(context, initial) {
  const form = document.querySelector('#contribution-form');
  if (!form) return;
  state.activeDraftManager?.destroy();
  let conflict = null;
  let manager;
  const editor = new BlockEditor(document.querySelector('#block-editor'), {
    blocks: initial.body,
    onSave: () => manager?.saveNow(),
    onChange: (_, stats) => {
      document.querySelector('[data-character-count]').textContent = stats.characters;
      document.querySelector('[data-block-count]').textContent = stats.blocks;
      manager?.update(collectSnapshot(form, editor));
    }
  });
  const draftKey = context.draft?.draftKey || draftKeyFor(context.targetType, context.targetId);
  manager = new DraftManager({
    api,
    userId: state.user.studentId,
    draftKey,
    targetType: context.targetType,
    targetId: context.targetId,
    draft: context.draft,
    onState: info => {
      const container = document.querySelector('[data-save-state]');
      if (!container) return;
      container.dataset.saveState = info.state;
      container.querySelector('[data-save-message]').textContent = info.message;
      container.querySelector('[data-save-revision]').textContent = info.revision ? `云端版本 ${info.revision}` : '';
    },
    onConflict: (cloud, local) => {
      conflict = { cloud, local };
      document.querySelector('[data-conflict-panel]').hidden = false;
    }
  });
  state.activeDraftManager = manager;
  state.activeEditor = editor;
  const restored = manager.chooseInitial(initial);
  setFormSnapshot(form, restored);
  editor.setBlocks(restored.body);
  const stats = editor.stats();
  document.querySelector('[data-character-count]').textContent = stats.characters;
  document.querySelector('[data-block-count]').textContent = stats.blocks;
  const syncByline = () => {
    form.elements.authorLabel.disabled = form.elements.anonymous.checked;
    form.elements.authorLabel.required = !form.elements.anonymous.checked;
  };
  syncByline();
  form.addEventListener('input', event => {
    if (event.target.closest('#block-editor')) return;
    syncByline();
    manager.update(collectSnapshot(form, editor));
  });
  form.addEventListener('change', event => {
    if (event.target.closest('#block-editor')) return;
    syncByline();
    manager.update(collectSnapshot(form, editor));
  });
  document.querySelector('[data-editor-insert]').addEventListener('click', () => editor.openCommandPalette(editor.element(editor.activeId)));
  document.querySelector('[data-save-now]').addEventListener('click', () => manager.saveNow());
  document.querySelector('[data-delete-current-draft]').addEventListener('click', async event => {
    if (!confirm('确定删除这份草稿吗？所有尚未提交的内容都会被清除，且无法恢复。')) return;
    const button = event.currentTarget;
    const errorElement = form.querySelector('[data-form-error]');
    button.disabled = true;
    errorElement.textContent = '';
    try {
      await manager.remove();
      manager.destroy();
      state.activeDraftManager = null;
      state.activeEditor = null;
      state.editing = null;
      state.articleEditing = null;
      state.reviewEditing = null;
      state.contributionPreset = null;
      state.forceNewDraft = true;
      toast('草稿已删除');
      location.hash = context.isReviewEdit ? '#/review' : '#/mine';
    } catch (err) {
      button.disabled = false;
      errorElement.textContent = `删除失败：${err.message}`;
    }
  });
  document.querySelector('[data-preview]').addEventListener('click', () => {
    const preview = document.querySelector('#preview-prose');
    preview.replaceChildren();
    renderBlocks(preview, editor.getBlocks());
    document.querySelector('#preview-dialog').showModal();
  });
  document.querySelector('[data-close-preview]').addEventListener('click', () => document.querySelector('#preview-dialog').close());
  document.querySelector('[data-use-cloud]').addEventListener('click', () => {
    if (!conflict) return;
    const snapshot = manager.adoptCloud(conflict.cloud);
    setFormSnapshot(form, snapshot);
    editor.setBlocks(snapshot.body);
    conflict = null;
    document.querySelector('[data-conflict-panel]').hidden = true;
  });
  document.querySelector('[data-keep-copy]').addEventListener('click', async () => {
    if (!conflict) return;
    await manager.keepLocalAsCopy(conflict.local);
    conflict = null;
    document.querySelector('[data-conflict-panel]').hidden = true;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const errorElement = form.querySelector('[data-form-error]');
    errorElement.textContent = '';
    manager.update(collectSnapshot(form, editor));
    try {
      const result = await manager.submit();
      state.editing = null;
      state.articleEditing = null;
      state.reviewEditing = null;
      state.contributionPreset = null;
      state.activeDraftManager = null;
      manager.destroy();
      if (context.isArticleEdit) {
        state.articleCacheBust = result.slug || context.targetId;
        toast('已更新公开文章');
        location.hash = `#/article/${encodeURIComponent(result.slug || context.targetId)}`;
      } else if (context.isReviewEdit) {
        toast('待审核稿件已更新');
        location.hash = '#/review';
      } else {
        toast('投稿已进入审核队列');
        location.hash = '#/mine';
      }
    } catch (err) {
      errorElement.textContent = err.message;
    }
  });
}

function personCard(name, detail) {
  const initial = Array.from(String(name).trim())[0]?.toUpperCase() || 'L';
  return `<article class="credit-person"><span class="credit-avatar" aria-hidden="true">${esc(initial)}</span><div><strong>${esc(name)}</strong><p>${esc(detail)}</p></div></article>`;
}

function visitCounter() {
  const total = Number.isSafeInteger(state.visitCount) ? state.visitCount.toLocaleString('zh-CN') : '—';
  return `<aside class="visit-counter" aria-label="网站累计浏览量"><span>累计浏览</span><strong data-visit-count>${total}</strong><small>次 · 自 8 月 10 日起统计</small></aside>`;
}

function thanksPage() {
  const contributors = state.contributors.length
    ? state.contributors.map(item => personCard(item.displayName, '实名内容贡献者')).join('')
    : `<div class="credit-empty">第一位实名内容贡献者会从这里开始。匿名投稿仍会被同样认真地审核。</div>`;
  queueMicrotask(() => void flushPendingVisits({ drain: true }).then(() => refreshVisitCount({ force: true })));
  return `<header class="page-heading thanks-heading"><span class="eyebrow">ACKNOWLEDGEMENTS</span><h1>谢谢每一个把经验留下的人</h1><p>网站由代码搭起，也由一篇篇具体的讲述真正完成。这里只记录投稿者主动选择公开的署名。</p></header>
    <section class="credit-section developer-credit"><div class="credit-intro"><span>01 / DEVELOPERS</span><h2>开发者</h2><p>负责网站构建、前后端开发、UI 设计与部署维护。</p></div><div class="credit-people">${personCard('Chenrx', '网站构建 · UI 设计 · 全栈开发')}</div></section>
    <section class="credit-section"><div class="credit-intro"><span>02 / WRITERS</span><h2>内容贡献者</h2><p>实名投稿经审核通过后，每个学号在这里留下一个名字，以第一次实名投稿署名为准。</p></div><div class="credit-people">${contributors}</div></section>
    ${visitCounter()}`;
}

function visitBrowserId() {
  try {
    let id = localStorage.getItem(VISIT_BROWSER_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(VISIT_BROWSER_KEY, id);
    }
    return id;
  } catch {
    return `ephemeral_${Math.random().toString(36).slice(2)}`;
  }
}

function makeVisitId() {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `view_${visitBrowserId()}_${nonce}`.replaceAll('.', '_').slice(0, 96);
}

function showVisitCount() {
  const element = document.querySelector('[data-visit-count]');
  if (element && Number.isSafeInteger(state.visitCount)) element.textContent = state.visitCount.toLocaleString('zh-CN');
}

function readPendingVisits() {
  try {
    const value = Number(localStorage.getItem(VISIT_PENDING_KEY));
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function scheduleVisitFlush(delay = VISIT_FLUSH_DELAY) {
  if (visitFlushTimer) clearTimeout(visitFlushTimer);
  visitFlushTimer = setTimeout(() => {
    visitFlushTimer = null;
    void flushPendingVisits();
  }, delay);
}

function readVisitBatch() {
  try {
    const batch = JSON.parse(localStorage.getItem(VISIT_BATCH_KEY) || 'null');
    return batch && /^[A-Za-z0-9_-]{16,96}$/.test(batch.visitId)
      && Number.isSafeInteger(batch.count) && batch.count >= 1 && batch.count <= VISIT_BATCH_MAX
      ? batch : null;
  } catch {
    return null;
  }
}

async function flushPendingVisits({ drain = false } = {}) {
  let batch = readVisitBatch();
  if (!batch) {
    const pending = readPendingVisits();
    if (!pending) return;
    batch = { visitId: makeVisitId(), count: Math.min(pending, VISIT_BATCH_MAX) };
    try {
      localStorage.setItem(VISIT_BATCH_KEY, JSON.stringify(batch));
      localStorage.setItem(VISIT_PENDING_KEY, String(pending - batch.count));
    } catch { /* private mode falls back to one in-memory request */ }
  }
  try {
    await api('/api/visits', { method: 'POST', body: batch });
    try { localStorage.removeItem(VISIT_BATCH_KEY); } catch { /* storage may be unavailable */ }
    if (Number.isSafeInteger(state.visitCount)) {
      state.visitCount += batch.count;
      writeCache(localStorage, VISIT_TOTAL_KEY, state.visitCount);
      showVisitCount();
    }
    if (readPendingVisits() > 0) {
      if (drain) return flushPendingVisits({ drain: true });
      scheduleVisitFlush();
    }
  } catch {
    scheduleVisitFlush(VISIT_FLUSH_DELAY * 3);
  }
}

function recordVisit() {
  const cachedTotal = readCache(localStorage, VISIT_TOTAL_KEY, VISIT_TOTAL_TTL);
  if (Number.isSafeInteger(cachedTotal) && cachedTotal >= 0) state.visitCount = cachedTotal;
  showVisitCount();
  try {
    localStorage.setItem(VISIT_PENDING_KEY, String(readPendingVisits() + 1));
  } catch {
    void api('/api/visits', { method: 'POST', body: { visitId: makeVisitId(), count: 1 } }).catch(() => {});
    return;
  }
  scheduleVisitFlush();
}

async function refreshVisitCount({ force = false } = {}) {
  const cached = readCache(localStorage, VISIT_TOTAL_KEY, VISIT_TOTAL_TTL);
  if (!force && Number.isSafeInteger(cached) && cached >= 0) {
    state.visitCount = cached;
    showVisitCount();
    return;
  }
  try {
    const data = await api('/api/visits');
    const total = Number(data.total);
    if (!Number.isSafeInteger(total) || total < 0) return;
    state.visitCount = total;
    writeCache(localStorage, VISIT_TOTAL_KEY, total);
    showVisitCount();
  } catch { /* the counter is decorative and must never block the page */ }
}

function renderBlocks(container, blocks = [], { anchors = false } = {}) {
  const headings = [];
  const usedIds = new Set();
  let headingIndex = 0;
  const addHeading = (element, block, level) => {
    if (anchors) {
      headingIndex += 1;
      const base = /^[A-Za-z0-9_-]{6,64}$/.test(block.id || '') ? `section-${block.id}` : `section-${headingIndex}`;
      let id = base;
      let suffix = 2;
      while (usedIds.has(id)) id = `${base}-${suffix++}`;
      usedIds.add(id);
      element.id = id;
      element.classList.add('article-heading-anchor');
      headings.push({ id, level, text: block.text });
    }
  };
  const appendSequence = (target, sequence) => {
    let currentList = null;
    for (const block of sequence) {
      if (block.type === 'bullet' || block.type === 'number') {
        const tag = block.type === 'bullet' ? 'UL' : 'OL';
        if (!currentList || currentList.tagName !== tag) { currentList = document.createElement(tag); target.append(currentList); }
        const item = document.createElement('li'); item.textContent = block.text; currentList.append(item); continue;
      }
      currentList = null;
      if (block.type === 'divider') { target.append(document.createElement('hr')); continue; }
      if (block.type === 'formula') { const formula = document.createElement('div'); formula.className = 'published-formula'; renderMath(formula, block.text); target.append(formula); continue; }
      if (block.type === 'table') {
        const region = document.createElement('div'); region.className = 'published-table-scroll'; const table = document.createElement('table'); const body = document.createElement('tbody');
        block.rows.forEach((row, rowIndex) => { const tr = document.createElement('tr'); row.forEach(cell => { const item = document.createElement(block.header !== false && rowIndex === 0 ? 'th' : 'td'); item.textContent = cell; tr.append(item); }); if (block.header !== false && rowIndex === 0) { const head = document.createElement('thead'); head.append(tr); table.append(head); } else body.append(tr); });
        table.append(body); region.append(table); target.append(region); continue;
      }
      if (block.type === 'columns') {
        const grid = document.createElement('div'); grid.className = `published-columns columns-${block.columns.length}`;
        block.columns.forEach(column => { const area = document.createElement('section'); appendSequence(area, column); grid.append(area); }); target.append(grid); continue;
      }
      if (block.type === 'toggle') {
        const details = document.createElement('details'); details.className = 'published-toggle'; details.open = block.open !== false; const summary = document.createElement('summary');
        const title = document.createElement(block.level === 3 ? 'h3' : 'h2'); title.textContent = block.text; addHeading(title, block, block.level === 3 ? 3 : 2); summary.append(title); details.append(summary);
        const children = document.createElement('div'); children.className = 'published-toggle-children'; appendSequence(children, block.children || []); details.append(children); target.append(details); continue;
      }
      const level = block.type === 'heading' ? 2 : block.type === 'subheading' ? 3 : block.type === 'minorheading' ? 4 : null;
      const element = document.createElement(level ? `h${level}` : block.type === 'quote' ? 'blockquote' : 'p'); element.textContent = block.text;
      if (level) addHeading(element, block, level); target.append(element);
    }
  };
  appendSequence(container, blocks);
  return headings;
}

function renderArticleToc(aside, headings) {
  if (!aside || headings.length < 2) return;
  const links = headings.map(item => `<a href="#${esc(item.id)}" data-toc-id="${esc(item.id)}" class="toc-level-${item.level}">${esc(item.text)}</a>`).join('');
  aside.insertAdjacentHTML('afterbegin', `<details class="article-toc" open><summary>本文目录</summary><nav aria-label="本文目录">${links}</nav></details>`);
  const observer = new IntersectionObserver(entries => {
    const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (!visible) return;
    aside.querySelectorAll('[data-toc-id]').forEach(link => link.classList.toggle('active', link.dataset.tocId === visible.target.id));
  }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, 1] });
  headings.forEach(item => {
    const element = document.getElementById(item.id);
    if (element) observer.observe(element);
  });
  aside.querySelectorAll('[data-toc-id]').forEach(link => link.addEventListener('click', event => {
    const target = document.getElementById(link.dataset.tocId);
    if (!target) return;
    event.preventDefault();
    const collapsedSection = target.closest('details');
    if (collapsedSection) collapsedSection.open = true;
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }));
}

async function minePage() {
  if (!state.user) { loginDialog.showModal(); location.hash = '#/'; return; }
  shell(`<div class="empty">正在读取你的投稿…</div>`);
  try {
    const [{ submissions }, { drafts }, { teacherSubmissions = [] }] = await Promise.all([
      api('/api/submissions/mine'),
      api('/api/drafts/mine'),
      api('/api/teacher-submissions/mine')
    ]);
    state.drafts = drafts;
    shell(`<header class="page-heading"><span class="eyebrow">My contributions</span><h1>我的投稿</h1><p>继续草稿，或查看已经进入审核流程的内容。</p><button class="button primary" type="button" data-new-draft>新建一篇</button></header>
      <div class="section-heading compact-heading"><div><h2>草稿</h2><p>只对你可见，写作过程中会自动保存。</p></div></div>
      ${drafts.length ? `<div class="draft-list">${drafts.map(item => `<article class="draft-row"><div><div class="meta"><span>${item.targetType === 'article' ? '公开文章修改' : item.targetType === 'submission' ? '投稿修改' : '新投稿'}</span><span>云端版本 ${item.revision}</span><span>${date(item.updatedAt)}</span></div><h3>${esc(item.title || '未命名草稿')}</h3><p>${esc(item.summary || '还没有填写摘要')}</p></div><div class="draft-actions"><a class="button small" href="#/contribute/${encodeURIComponent(`draft:${item.id}`)}">继续写</a><button class="button small danger" type="button" data-delete-draft="${esc(item.id)}" data-draft-key="${esc(item.draftKey)}">删除</button></div></article>`).join('')}</div>` : '<div class="empty compact-empty">暂时没有草稿。</div>'}
      <div class="section-heading compact-heading"><div><h2>已提交</h2><p>查看审核进度和修改建议。</p></div></div>
      ${submissions.length ? `<div class="article-list">${submissions.map((item, index) => `<div class="article-row"><div><div class="meta"><span class="status ${item.status}">${statusLabels[item.status]}</span><span>#${item.id}</span><span>${date(item.updated_at)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${item.review_note ? `<div class="notice warn"><strong>审核意见：</strong>${esc(item.review_note)}</div>` : ''}</div><div><span class="tag">${esc(item.content_type)}</span>${['pending','changes_requested'].includes(item.status) ? `<button class="button small" style="margin-top:10px" data-edit-index="${index}">继续编辑</button>` : ''}</div></div>`).join('')}</div>` : `<div class="empty"><span class="emoji">✎</span>还没有文章投稿。<br><a href="#/contribute" class="button primary" style="margin-top:14px">写第一篇</a></div>`}
      <div class="section-heading compact-heading"><div><h2>教师补充</h2><p>查看教师资料补充的审核结果；批准后会自动加入正式索引。</p></div><a class="button small" href="#/teacher-submit">补充教师</a></div>
      ${teacherSubmissions.length ? `<div class="article-list">${teacherSubmissions.map(item => `<div class="article-row"><div><div class="meta"><span class="status ${item.status}">${statusLabels[item.status]}</span><span>${date(item.updatedAt)}</span></div><h3>${esc(item.name)}</h3><p>${esc(item.subject)}${item.motto ? ` · ${esc(item.motto)}` : ''}</p>${item.reviewNote ? `<div class="notice warn"><strong>审核意见：</strong>${esc(item.reviewNote)}</div>` : ''}</div><div><span class="tag">教师资料</span></div></div>`).join('')}</div>` : '<div class="empty compact-empty">还没有提交教师补充。</div>'}`);
    document.querySelector('[data-new-draft]')?.addEventListener('click', () => { state.forceNewDraft = true; location.hash = '#/contribute'; });
    document.querySelectorAll('[data-edit-index]').forEach(button => button.addEventListener('click', () => {
      const submission = submissions[Number(button.dataset.editIndex)];
      state.editing = submission; location.hash = `#/contribute/${encodeURIComponent(`submission:${submission.id}`)}`;
    }));
    document.querySelectorAll('[data-delete-draft]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('确定删除这份草稿吗？删除后无法恢复。')) return;
      try {
        await api(`/api/drafts/${encodeURIComponent(button.dataset.deleteDraft)}`, { method: 'DELETE' });
        clearLocalDraft(state.user.studentId, button.dataset.draftKey);
        toast('草稿已删除');
        minePage();
      } catch (err) { toast(err.message); }
    }));
  } catch (err) { shell(errorView(err.message)); }
}

async function reviewPage() {
  if (!state.user || !['reviewer', 'admin'].includes(state.user.role)) return shell(errorView('需要审核权限'));
  shell(`<div class="empty">正在读取审核队列…</div>`);
  try {
    const { submissions, teacherSubmissions = [] } = await api('/api/review');
    const queue = [
      ...teacherSubmissions.map(item => ({ type: 'teacher', item })),
      ...submissions.map(item => ({ type: 'article', item }))
    ];
    shell(`<header class="page-heading"><span class="eyebrow">REVIEW QUEUE</span><h1>共建审核</h1><p>文章投稿与教师资料都在这里处理。教师补充只核对基础资料，文章审核则关注具体性、隐私、事实与尊重。</p><div class="review-summary"><span>文章 ${submissions.length}</span><span>教师补充 ${teacherSubmissions.length}</span></div></header>
      ${queue.length ? `<div class="dashboard-grid"><div class="panel"><div class="panel-head">等待处理 · ${queue.length}</div>${queue.map((entry, index) => `<button class="queue-item ${index === 0 ? 'active' : ''}" data-review-index="${index}"><span class="queue-type">${entry.type === 'teacher' ? '教师资料' : '文章投稿'}</span><strong>${esc(entry.type === 'teacher' ? entry.item.name : entry.item.title)}</strong><small>${esc(entry.type === 'teacher' ? entry.item.subject : entry.item.section_title)} · 匿名校内成员</small></button>`).join('')}</div><div class="panel" id="review-detail"></div></div>` : `<div class="empty"><span class="emoji">✓</span>审核队列已经清空。</div>`}`);
    if (queue.length) {
      const show = index => queue[index].type === 'teacher' ? renderTeacherReviewDetail(queue[index].item) : renderReviewDetail(queue[index].item);
      document.querySelectorAll('[data-review-index]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-review-index]').forEach(item => item.classList.remove('active')); button.classList.add('active'); show(Number(button.dataset.reviewIndex));
      }));
      show(0);
    }
  } catch (err) { shell(errorView(err.message)); }
}

function renderReviewDetail(item) {
  const detail = document.querySelector('#review-detail');
  detail.innerHTML = `<div class="review-body"><div class="meta"><span class="tag">${esc(item.content_type)}</span><span>${esc(item.section_title)}</span><span>${esc(item.student_id)}</span></div><h2 style="font-family:var(--serif)">${esc(item.title)}</h2><p class="muted">${esc(item.summary)}</p><div class="prose" id="review-prose"></div></div>
    <form class="review-actions" id="review-form"><label>给投稿者的说明<textarea name="note" maxlength="1000" placeholder="通过时可选；退回修改或拒绝时必填"></textarea></label><div class="form-error"></div>${state.user?.role === 'admin' ? '<button type="button" class="button review-edit-button" data-edit-pending>编辑待审核稿件</button>' : ''}<div class="form-actions"><button type="button" class="button danger" data-action="reject">不采用</button><button type="button" class="button" data-action="request_changes">退回修改</button><button type="button" class="button primary" data-action="approve">通过并发布</button></div></form>`;
  renderBlocks(document.querySelector('#review-prose'), item.body);
  detail.querySelector('[data-edit-pending]')?.addEventListener('click', () => {
    state.reviewEditing = item;
    location.hash = `#/admin-review-edit/${encodeURIComponent(item.id)}`;
  });
  detail.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    const note = detail.querySelector('textarea').value;
    try {
      await api(`/api/review/${item.id}`, { method: 'POST', body: { action: button.dataset.action, note } });
      toast(button.dataset.action === 'approve' ? '内容已发布' : '审核结果已保存');
      reviewPage();
      await refreshBootstrap();
    } catch (err) { detail.querySelector('.form-error').textContent = err.message; }
  }));
}

function renderTeacherReviewDetail(item) {
  const detail = document.querySelector('#review-detail');
  detail.innerHTML = `<div class="review-body teacher-review-body"><div class="meta"><span class="tag">教师资料</span><span>${esc(item.subject)}</span><span>匿名校内成员</span></div><div class="teacher-review-identity"><div class="teacher-monogram">${esc(item.name.slice(0, 1))}</div><div><h2>${esc(item.name)}</h2><p>${esc(item.subject)}</p></div></div><dl class="teacher-review-fields"><div><dt>教师姓名</dt><dd>${esc(item.name)}</dd></div><div><dt>任教学科</dt><dd>${esc(item.subject)}</dd></div><div><dt>格言</dt><dd>${item.motto ? esc(item.motto) : '未填写'}</dd></div></dl><div class="source-note"><strong>审核提示</strong><span>检查是否为重复教师、姓名是否完整、学科是否合理。不要根据这一条基础资料推断任教班级或其他私人信息。</span></div></div>
    <form class="review-actions"><label>审核说明<textarea maxlength="1000" placeholder="通过时可选；不采用时必填"></textarea></label><div class="form-error"></div><div class="form-actions"><button type="button" class="button danger" data-teacher-action="reject">不采用</button><button type="button" class="button primary" data-teacher-action="approve">批准并加入索引</button></div></form>`;
  detail.querySelectorAll('[data-teacher-action]').forEach(button => button.addEventListener('click', async () => {
    const note = detail.querySelector('textarea').value;
    try {
      await api(`/api/review/teachers/${encodeURIComponent(item.id)}`, { method: 'POST', body: { action: button.dataset.teacherAction, note } });
      toast(button.dataset.teacherAction === 'approve' ? '教师已加入索引' : '审核结果已保存');
      await refreshBootstrap();
      reviewPage();
    } catch (err) { detail.querySelector('.form-error').textContent = err.message; }
  }));
}

async function adminPage() {
  if (state.user?.role !== 'admin') return shell(errorView('需要管理员权限'));
  shell(`<div class="empty">正在读取权限名单…</div>`);
  try {
    const { users } = await api('/api/admin/users');
    shell(`<header class="page-heading"><span class="eyebrow">Access control</span><h1>审核权限</h1><p>授予或收回审核权限。撤权会立即生效，并停用该账号通过共享口令再次提权。</p></header>
      <form class="form-card" id="role-form" style="max-width:none"><div class="form-grid"><label>九位学号<input name="studentId" maxlength="9" pattern="20[0-9]{7}" required></label><label>角色<select name="role"><option value="reviewer">审核者</option><option value="admin">管理员</option><option value="student">收回权限</option></select></label></div><button class="button primary" type="submit">保存权限</button><p class="form-error"></p></form>
      <div class="panel" style="margin-top:22px;overflow-x:auto"><table class="table"><thead><tr><th>学号</th><th>角色</th><th>自助提权</th><th>最后登入</th></tr></thead><tbody>${users.map(user => `<tr><td>${esc(user.student_id)}</td><td>${roleName(user.role)}</td><td>${user.role_locked ? '已停用' : '允许'}</td><td>${date(user.last_login_at)}</td></tr>`).join('')}</tbody></table></div>`);
    document.querySelector('#role-form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form));
      try { await api('/api/admin/roles', { method: 'POST', body: values }); toast('权限已更新'); adminPage(); }
      catch (err) { form.querySelector('.form-error').textContent = err.message; }
    });
  } catch (err) { shell(errorView(err.message)); }
}

function searchPage() {
  const query = state.search.trim().toLowerCase();
  const results = query ? state.articles.filter(article => [article.title, article.summary, article.subject, article.author_label].some(value => value?.toLowerCase().includes(query))) : [];
  const teachers = query ? allTeachers().filter(teacher => `${teacher.name}${teacher.subject}${teacher.motto}${teacher.profile}`.toLowerCase().includes(query)) : [];
  return `<header class="page-heading"><span class="eyebrow">Search</span><h1>搜索${query ? `“${esc(query)}”` : ''}</h1><p>${query ? `找到 ${teachers.length} 位教师和 ${results.length} 篇内容` : '在上方输入关键词'}</p></header>${teachers.length ? `<div class="section-heading"><div><h2>教师</h2></div></div><div class="teacher-grid compact">${teachers.map(teacherCard).join('')}</div>` : ''}<div class="section-heading"><div><h2>文章</h2></div></div>${articleList(results)}`;
}

function errorView(message, retry = false) { return `<div class="empty"><span class="emoji">△</span>${esc(message)}<br>${retry ? '<button class="button" type="button" onclick="location.reload()" style="margin-top:14px">重新加载</button>' : '<a class="button" href="#/" style="margin-top:14px">返回首页</a>'}</div>`; }
function notFound() { return errorView('这里还没有内容'); }
function date(value) { return formatDate(value); }

async function redeemAccess() {
  const code = prompt('请输入审核或管理员权限口令。口令只会发送到服务端验证：');
  if (!code) return;
  try { const { user } = await api('/api/auth/access', { method: 'POST', body: { code } }); state.user = user; cacheSession(user); toast(`已获得${roleName(user.role)}权限`); render(); }
  catch (err) { toast(err.message); }
}

async function logout() {
  if (state.user) clearUserLocalDrafts(state.user.studentId);
  state.activeDraftManager?.destroy();
  await api('/api/auth/logout', { method: 'POST' }); state.user = null; clearCache(sessionStorage, SESSION_CACHE_KEY); toast('已退出登入'); location.hash = '#/'; render();
}

loginDialog.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget; const errorElement = form.querySelector('[data-login-error]');
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { studentId: new FormData(form).get('studentId') } });
    state.user = user; cacheSession(user); loginDialog.close(); form.reset(); toast('登入成功'); render();
  } catch (err) { errorElement.textContent = err.message; }
});

async function render() {
  const current = route();
  if (['teachers', 'teacher', 'search'].includes(current.page)) await ensureTeachers();
  if (!['contribute', 'admin-article-edit', 'admin-review-edit'].includes(current.page) && state.activeDraftManager) {
    state.activeDraftManager.destroy();
    state.activeDraftManager = null;
    state.activeEditor = null;
  }
  if (current.page === 'article') return articlePage(current.value);
  if (current.page === 'mine') return minePage();
  if (current.page === 'review') return reviewPage();
  if (current.page === 'admin') return adminPage();
  if (['contribute', 'admin-article-edit', 'admin-review-edit'].includes(current.page)) return contributePage();
  const pages = { home, section: () => sectionPage(current.value), teachers: teacherDirectory, teacher: () => teacherPage(current.value), 'teacher-submit': teacherSubmissionPage, thanks: thanksPage, about: aboutPage, changelog: changelogPage, search: searchPage };
  shell((pages[current.page] || notFound)());
}

async function init() {
  try {
    const [bootstrap, session] = await Promise.all([loadBootstrap(), loadSession()]);
    applyBootstrap(bootstrap); state.user = session.user;
    window.addEventListener('hashchange', render); render();
    void recordVisit();
  } catch (err) { app.innerHTML = errorView(`初始化失败：${err.message}`, true); }
}

init();
