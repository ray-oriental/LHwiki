import { TEACHERS } from './teachers.js';
import { formatDate } from './date.js';

const state = { sections: [], articles: [], contributors: [], user: null, search: '', editing: null, articleEditing: null, articleCacheBust: null, contributionPreset: null, teacherQuery: '', teacherSubject: '全部' };
const app = document.querySelector('#app');
const loginDialog = document.querySelector('#login-dialog');
const statusLabels = { pending: '等待审核', changes_requested: '需修改', approved: '已发布', rejected: '未采用' };

const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers },
    body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
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
    ? navLink('#/review', '✓', '审核投稿', current.page === 'review') : '';
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
  const subjects = ['全部', ...new Set(TEACHERS.map(item => item.subject).filter(item => item !== '学科待补充'))];
  const query = state.teacherQuery.trim().toLowerCase();
  const teachers = TEACHERS.filter(teacher => (!query || `${teacher.name}${teacher.subject}${teacher.motto}`.toLowerCase().includes(query)) && (state.teacherSubject === '全部' || teacher.subject === state.teacherSubject));
  setTimeout(bindTeacherFilters, 0);
  return `<header class="page-heading teacher-heading"><span class="eyebrow">PUBLIC FACULTY INDEX</span><h1>教师索引</h1><p>根据潞河中学官网公开教师展示整理，共 ${TEACHERS.length} 位。它不是完整在岗花名册；学科不明处保留“待补充”，欢迎提交可靠来源。</p></header>
    <div class="source-note"><strong>关于匿名评价</strong><span>评价不会即时公开，而是进入审核队列。请写清年级、课程场景和大致时间；只谈亲身体验，不公开联系方式、家庭、成绩等隐私，也不接受人身攻击或未经核实的指控。</span></div>
    <div class="teacher-tools"><label class="teacher-search">搜索教师<input id="teacher-search" value="${esc(state.teacherQuery)}" placeholder="输入姓名、学科或关键词"></label><div class="subject-tabs">${subjects.map(subject => `<button class="subject-tab ${state.teacherSubject === subject ? 'active' : ''}" data-subject="${esc(subject)}">${esc(subject)}</button>`).join('')}</div></div>
    <div class="teacher-count">当前显示 ${teachers.length} 位</div>
    <div class="teacher-grid">${teachers.map(teacherCard).join('')}</div>`;
}

function teacherCard(teacher) {
  const reviewCount = state.articles.filter(article => article.section_slug === 'courses' && article.subject === teacher.name).length;
  return `<article class="teacher-card"><a href="#/teacher/${encodeURIComponent(teacher.id)}" class="teacher-card-main"><div class="teacher-monogram">${esc(teacher.name.slice(0, 1))}</div><div><div class="teacher-name"><h2>${esc(teacher.name)}</h2><span>${esc(teacher.subject)}</span></div><p>${esc(teacher.motto)}</p></div></a><footer><span>${reviewCount ? `${reviewCount} 篇已审核分享` : '等待第一篇课堂记录'}</span><button class="text-button" data-review-teacher="${esc(teacher.name)}">匿名分享经历</button></footer></article>`;
}

function bindTeacherFilters() {
  document.querySelector('#teacher-search')?.addEventListener('input', event => { state.teacherQuery = event.target.value; document.querySelector('.content').innerHTML = teacherDirectory(); });
  document.querySelectorAll('[data-subject]').forEach(button => button.addEventListener('click', () => { state.teacherSubject = button.dataset.subject; document.querySelector('.content').innerHTML = teacherDirectory(); }));
  bindTeacherReviewButtons();
}

function teacherPage(id) {
  const teacher = TEACHERS.find(item => item.id === id);
  if (!teacher) return notFound();
  const reviews = state.articles.filter(article => article.section_slug === 'courses' && article.subject === teacher.name);
  return `<div class="breadcrumbs"><a href="#/">首页</a>　/　<a href="#/teachers">教师索引</a></div><header class="teacher-profile"><div class="teacher-monogram large">${esc(teacher.name.slice(0, 1))}</div><div><span class="eyebrow">${esc(teacher.subject)}</span><h1>${esc(teacher.name)}</h1><p>${esc(teacher.motto)}</p><a class="source-link" href="${esc(teacher.sourceUrl)}" target="_blank" rel="noreferrer">查看公开资料来源 ↗</a></div></header>
    <div class="source-note"><strong>资料边界</strong><span>本页只展示公开职业信息。下方文章均为投稿者的个人经历，经内容审核后发布，不代表学校、教师或本站的统一结论。</span></div>
    <div class="section-heading"><div><h2>课堂与相处经验</h2><p>具体经历比星级打分更有帮助。</p></div><button class="button primary" data-review-teacher="${esc(teacher.name)}">匿名分享经历</button></div>${articleList(reviews)}`;
}

async function articlePage(slug) {
  shell(`<div class="empty">正在翻到这一页…</div>`);
  try {
    const cacheBust = state.articleCacheBust === slug ? `?refresh=${Date.now()}` : '';
    state.articleCacheBust = null;
    const { article } = await api(`/api/articles/${encodeURIComponent(slug)}${cacheBust}`);
    const section = state.sections.find(item => item.slug === article.section_slug);
    const adminActions = state.user?.role === 'admin' ? `<div class="form-actions"><button class="button" type="button" data-admin-edit-article>编辑已发布稿件</button><button class="button danger" type="button" data-admin-delete-article>删除稿件</button></div>` : '';
    shell(`<div class="article-layout"><article><div class="breadcrumbs"><a href="#/">首页</a>　/　<a href="#/section/${esc(article.section_slug)}">${esc(section?.title || '')}</a></div>
      <header class="page-heading"><div class="article-meta"><span class="tag">${esc(article.content_type)}</span>${article.subject ? `<span>${esc(article.subject)}</span>` : ''}</div><h1>${esc(article.title)}</h1><p>${esc(article.summary)}</p><div class="meta" style="margin-top:18px">撰写：${esc(article.author_label)}　·　更新于 ${date(article.updated_at)}</div></header>
      ${adminActions}<div class="prose" id="article-body"></div></article>
      <aside class="article-aside"><strong>阅读提示</strong>内容来自个人经历，时间和情境可能不同。涉及重要决定时，请同时参考官方信息和更多观点。</aside></div>`);
    renderBlocks(document.querySelector('#article-body'), article.body);
    document.querySelector('[data-admin-edit-article]')?.addEventListener('click', () => {
      state.articleEditing = article;
      location.hash = '#/admin-article-edit';
    });
    document.querySelector('[data-admin-delete-article]')?.addEventListener('click', async () => {
      if (!confirm(`确定删除《${article.title}》吗？此操作不会删除原投稿和审核记录。`)) return;
      try {
        await api(`/api/admin/articles/${encodeURIComponent(article.slug)}`, { method: 'DELETE' });
        const fresh = await api(`/api/bootstrap?refresh=${Date.now()}`);
        state.sections = fresh.sections; state.articles = fresh.articles; state.contributors = fresh.contributors || [];
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

function contributePage() {
  const articleEditing = route().page === 'admin-article-edit' ? state.articleEditing : null;
  if (route().page === 'admin-article-edit' && !articleEditing) return errorView('没有选择要编辑的已发布文章');
  if (articleEditing && state.user?.role !== 'admin') return errorView('需要管理员权限');
  if (!state.user) return `<header class="page-heading"><span class="eyebrow">参与共建</span><h1>分享一段值得留下的经历</h1><p>无需 GitHub，也无需学习 Markdown。</p></header><div class="form-card empty"><span class="emoji">✎</span><p>登入后即可开始撰写，草稿内容只会在提交时发送。</p><button class="button primary" data-login>用学号登入</button></div>`;
  const editing = articleEditing || state.editing;
  const isArticleEdit = Boolean(articleEditing);
  const preset = !editing ? state.contributionPreset : null;
  setTimeout(() => bindEditor(editing, isArticleEdit), 0);
  return `<header class="page-heading"><span class="eyebrow">${isArticleEdit ? '管理已发布内容' : editing ? `修改投稿 #${editing.id}` : '新投稿'}</span><h1>${isArticleEdit ? `编辑《${esc(editing.title)}》` : '把经历写具体'}</h1><p>${isArticleEdit ? '保存后直接更新公开文章，不再进入审核队列。文章地址保持不变。' : '好的分享让读者看见背景、选择、过程和结果，而不只是一个好或坏的结论。'}</p></header>
    <form class="form-card" id="contribution-form"><div class="notice">学号只用于校内成员筛选和保存投稿记录，不会出现在公开内容或审核队列中。</div>
      <div class="form-grid"><label>投稿分区<select name="sectionSlug" required><option value="">请选择</option>${state.sections.map(section => `<option value="${esc(section.slug)}" ${(editing?.section_slug || preset?.sectionSlug) === section.slug ? 'selected' : ''}>${section.icon} ${esc(section.title)}</option>`).join('')}</select></label>
      <label>内容类型<select name="contentType" required>${['访谈','评价','经验','指南'].map(type => `<option ${(editing?.content_type || preset?.contentType) === type ? 'selected' : ''}>${type}</option>`).join('')}</select></label></div>
      <label>标题<input name="title" maxlength="100" value="${esc(editing?.title || preset?.title || '')}" placeholder="例如：加入文学社一年后，我学到了什么" required></label>
      <label>一句话摘要<textarea name="summary" maxlength="240" placeholder="告诉读者文章的背景、重点和适合谁阅读" required>${esc(editing?.summary || '')}</textarea><span class="field-help">10—240 字</span></label>
      <label>评价对象或访谈主题（选填）<input name="subject" maxlength="80" value="${esc(editing?.subject || preset?.subject || '')}" placeholder="例如：文学社 / 高三一轮复习"></label>
      <div class="editor-wrap"><label>正文</label><div class="editor-toolbar" aria-label="排版工具">
        <button type="button" class="tool" data-format="p">正文</button><button type="button" class="tool" data-format="h2">小标题</button><button type="button" class="tool" data-format="blockquote">引用</button><button type="button" class="tool" data-command="insertUnorderedList">项目列表</button><button type="button" class="tool" data-command="insertOrderedList">编号列表</button>
      </div><div id="editor" class="editor" contenteditable="true" data-placeholder="从一个具体场景开始写起……"></div><span class="field-help">至少 50 字；第一版支持标题、段落、引用和列表。</span></div>
      <div class="byline-panel"><div><label>署名<input name="authorLabel" maxlength="40" value="${esc(editing?.author_label === '匿名同学' ? '' : editing?.author_label || '')}" placeholder="例如：陈同学 / Chenrx" ${editing?.author_label === '匿名同学' ? '' : 'required'}></label><label class="checkbox"><input type="checkbox" name="anonymous" ${editing?.author_label === '匿名同学' ? 'checked' : ''}> 公开时显示为“匿名同学”</label></div>
      <aside class="credit-note"><strong>让名字和经验一起留下</strong><p>选择实名署名的投稿通过审核后，署名会出现在「致谢」中。每个学号只记录第一次实名投稿时填写的名字；匿名投稿不会上榜，也不会受到区别审核。</p><a href="#/thanks">查看致谢板块 →</a></aside></div>
      <div class="notice warn">提交前请删除他人的联系方式、成绩、家庭情况等隐私。评价老师或同学时，请描述事实与个人感受，避免人身攻击。</div>
      <p class="form-error" data-form-error></p><div class="form-actions"><button class="button primary" type="submit">${isArticleEdit ? '保存公开文章' : '提交审核'}</button></div></form>`;
}

function bindEditor(editing, isArticleEdit = false) {
  const form = document.querySelector('#contribution-form');
  if (!form) return;
  if (editing?.body) renderBlocks(document.querySelector('#editor'), editing.body);
  const anonymous = form.elements.anonymous;
  const authorLabel = form.elements.authorLabel;
  const syncByline = () => {
    authorLabel.disabled = anonymous.checked;
    authorLabel.required = !anonymous.checked;
    if (anonymous.checked) authorLabel.setAttribute('aria-describedby', 'anonymous-byline-help');
    else authorLabel.removeAttribute('aria-describedby');
  };
  anonymous.addEventListener('change', syncByline);
  syncByline();
  document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => document.execCommand('formatBlock', false, button.dataset.format)));
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => document.execCommand(button.dataset.command, false)));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const payload = { ...values, anonymous: form.elements.anonymous.checked, body: editorBlocks(document.querySelector('#editor')) };
    const errorElement = form.querySelector('[data-form-error]');
    try {
      if (isArticleEdit) {
        const slug = editing.slug;
        await api(`/api/admin/articles/${encodeURIComponent(slug)}`, { method: 'PUT', body: payload });
        const fresh = await api(`/api/bootstrap?refresh=${Date.now()}`);
        state.sections = fresh.sections; state.articles = fresh.articles; state.contributors = fresh.contributors || [];
        state.articleEditing = null;
        state.articleCacheBust = slug;
        toast('已更新公开文章');
        location.hash = `#/article/${encodeURIComponent(slug)}`;
        return;
      }
      const result = await api(editing ? `/api/submissions/${editing.id}` : '/api/submissions', { method: editing ? 'PUT' : 'POST', body: payload });
      toast(editing ? '修改已重新提交审核' : `投稿 #${result.id} 已进入审核队列`);
      state.editing = null;
      state.contributionPreset = null;
      location.hash = '#/mine';
    } catch (err) { errorElement.textContent = err.message; }
  });
}

function personCard(name, detail) {
  const initial = Array.from(String(name).trim())[0]?.toUpperCase() || 'L';
  return `<article class="credit-person"><span class="credit-avatar" aria-hidden="true">${esc(initial)}</span><div><strong>${esc(name)}</strong><p>${esc(detail)}</p></div></article>`;
}

function thanksPage() {
  const contributors = state.contributors.length
    ? state.contributors.map(item => personCard(item.displayName, '实名内容贡献者')).join('')
    : `<div class="credit-empty">第一位实名内容贡献者会从这里开始。匿名投稿仍会被同样认真地审核。</div>`;
  return `<header class="page-heading thanks-heading"><span class="eyebrow">ACKNOWLEDGEMENTS</span><h1>谢谢每一个把经验留下的人</h1><p>网站由代码搭起，也由一篇篇具体的讲述真正完成。这里只记录投稿者主动选择公开的署名。</p></header>
    <section class="credit-section developer-credit"><div class="credit-intro"><span>01 / DEVELOPERS</span><h2>开发者</h2><p>负责网站构建、前后端开发、UI 设计与部署维护。</p></div><div class="credit-people">${personCard('Chenrx', '网站构建 · UI 设计 · 全栈开发')}</div></section>
    <section class="credit-section"><div class="credit-intro"><span>02 / WRITERS</span><h2>内容贡献者</h2><p>实名投稿经审核通过后，每个学号在这里留下一个名字，以第一次实名投稿署名为准。</p></div><div class="credit-people">${contributors}</div></section>`;
}

function editorBlocks(editor) {
  const blocks = [];
  const push = (type, text) => { if (text.trim()) blocks.push({ type, text: text.trim() }); };
  for (const node of editor.children) {
    const tag = node.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') [...node.querySelectorAll(':scope > li')].forEach(li => push(tag === 'ul' ? 'bullet' : 'number', li.textContent));
    else push(/^h[1-6]$/.test(tag) ? 'heading' : tag === 'blockquote' ? 'quote' : 'paragraph', node.textContent);
  }
  if (!blocks.length && editor.textContent.trim()) push('paragraph', editor.textContent);
  return blocks;
}

function renderBlocks(container, blocks = []) {
  let currentList = null;
  for (const block of blocks) {
    if (block.type === 'bullet' || block.type === 'number') {
      const tag = block.type === 'bullet' ? 'UL' : 'OL';
      if (!currentList || currentList.tagName !== tag) { currentList = document.createElement(tag); container.append(currentList); }
      const item = document.createElement('li'); item.textContent = block.text; currentList.append(item); continue;
    }
    currentList = null;
    const element = document.createElement(block.type === 'heading' ? 'h2' : block.type === 'quote' ? 'blockquote' : 'p');
    element.textContent = block.text;
    container.append(element);
  }
}

async function minePage() {
  if (!state.user) { loginDialog.showModal(); location.hash = '#/'; return; }
  shell(`<div class="empty">正在读取你的投稿…</div>`);
  try {
    const { submissions } = await api('/api/submissions/mine');
    shell(`<header class="page-heading"><span class="eyebrow">My contributions</span><h1>我的投稿</h1><p>查看审核进度和修改建议。</p></header>
      ${submissions.length ? `<div class="article-list">${submissions.map((item, index) => `<div class="article-row"><div><div class="meta"><span class="status ${item.status}">${statusLabels[item.status]}</span><span>#${item.id}</span><span>${date(item.updated_at)}</span></div><h3>${esc(item.title)}</h3><p>${esc(item.summary)}</p>${item.review_note ? `<div class="notice warn"><strong>审核意见：</strong>${esc(item.review_note)}</div>` : ''}</div><div><span class="tag">${esc(item.content_type)}</span>${['pending','changes_requested'].includes(item.status) ? `<button class="button small" style="margin-top:10px" data-edit-index="${index}">继续编辑</button>` : ''}</div></div>`).join('')}</div>` : `<div class="empty"><span class="emoji">✎</span>还没有投稿。<br><a href="#/contribute" class="button primary" style="margin-top:14px">写第一篇</a></div>`}`);
    document.querySelectorAll('[data-edit-index]').forEach(button => button.addEventListener('click', () => {
      state.editing = submissions[Number(button.dataset.editIndex)]; location.hash = '#/contribute';
    }));
  } catch (err) { shell(errorView(err.message)); }
}

async function reviewPage() {
  if (!state.user || !['reviewer', 'admin'].includes(state.user.role)) return shell(errorView('需要审核权限'));
  shell(`<div class="empty">正在读取审核队列…</div>`);
  try {
    const { submissions } = await api('/api/review');
    shell(`<header class="page-heading"><span class="eyebrow">Review queue</span><h1>待审核投稿</h1><p>保留真实而多元的表达，同时守住隐私、事实与尊重的边界。</p></header>
      ${submissions.length ? `<div class="dashboard-grid"><div class="panel"><div class="panel-head">等待处理 · ${submissions.length}</div>${submissions.map((item, index) => `<button class="queue-item ${index === 0 ? 'active' : ''}" data-review-index="${index}"><strong>${esc(item.title)}</strong><small>${esc(item.section_title)} · ${esc(item.student_id)}</small></button>`).join('')}</div><div class="panel" id="review-detail"></div></div>` : `<div class="empty"><span class="emoji">✓</span>审核队列已经清空。</div>`}`);
    if (submissions.length) {
      const show = index => renderReviewDetail(submissions[index]);
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
    <form class="review-actions" id="review-form"><label>给投稿者的说明<textarea name="note" maxlength="1000" placeholder="通过时可选；退回修改或拒绝时必填"></textarea></label><div class="form-error"></div><div class="form-actions"><button type="button" class="button danger" data-action="reject">不采用</button><button type="button" class="button" data-action="request_changes">退回修改</button><button type="button" class="button primary" data-action="approve">通过并发布</button></div></form>`;
  renderBlocks(document.querySelector('#review-prose'), item.body);
  detail.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    const note = detail.querySelector('textarea').value;
    try {
      await api(`/api/review/${item.id}`, { method: 'POST', body: { action: button.dataset.action, note } });
      toast(button.dataset.action === 'approve' ? '内容已发布' : '审核结果已保存');
      reviewPage();
      const fresh = await api('/api/bootstrap'); state.sections = fresh.sections; state.articles = fresh.articles;
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
  const teachers = query ? TEACHERS.filter(teacher => `${teacher.name}${teacher.subject}${teacher.motto}`.toLowerCase().includes(query)) : [];
  return `<header class="page-heading"><span class="eyebrow">Search</span><h1>搜索${query ? `“${esc(query)}”` : ''}</h1><p>${query ? `找到 ${teachers.length} 位教师和 ${results.length} 篇内容` : '在上方输入关键词'}</p></header>${teachers.length ? `<div class="section-heading"><div><h2>教师</h2></div></div><div class="teacher-grid compact">${teachers.map(teacherCard).join('')}</div>` : ''}<div class="section-heading"><div><h2>文章</h2></div></div>${articleList(results)}`;
}

function errorView(message) { return `<div class="empty"><span class="emoji">△</span>${esc(message)}<br><a class="button" href="#/" style="margin-top:14px">返回首页</a></div>`; }
function notFound() { return errorView('这里还没有内容'); }
function date(value) { return formatDate(value); }

async function redeemAccess() {
  const code = prompt('请输入审核或管理员权限口令。口令只会发送到服务端验证：');
  if (!code) return;
  try { const { user } = await api('/api/auth/access', { method: 'POST', body: { code } }); state.user = user; toast(`已获得${roleName(user.role)}权限`); render(); }
  catch (err) { toast(err.message); }
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }); state.user = null; toast('已退出登入'); location.hash = '#/'; render();
}

loginDialog.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget; const errorElement = form.querySelector('[data-login-error]');
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { studentId: new FormData(form).get('studentId') } });
    state.user = user; loginDialog.close(); form.reset(); toast('登入成功'); render();
  } catch (err) { errorElement.textContent = err.message; }
});

async function render() {
  const current = route();
  if (current.page === 'article') return articlePage(current.value);
  if (current.page === 'mine') return minePage();
  if (current.page === 'review') return reviewPage();
  if (current.page === 'admin') return adminPage();
  const pages = { home, section: () => sectionPage(current.value), teachers: teacherDirectory, teacher: () => teacherPage(current.value), contribute: contributePage, 'admin-article-edit': contributePage, thanks: thanksPage, about: aboutPage, search: searchPage };
  shell((pages[current.page] || notFound)());
}

async function init() {
  try {
    const [bootstrap, session] = await Promise.all([api('/api/bootstrap'), api('/api/session')]);
    state.sections = bootstrap.sections; state.articles = bootstrap.articles; state.contributors = bootstrap.contributors || []; state.user = session.user;
    window.addEventListener('hashchange', render); render();
  } catch (err) { app.innerHTML = errorView(`初始化失败：${err.message}`); }
}

init();
