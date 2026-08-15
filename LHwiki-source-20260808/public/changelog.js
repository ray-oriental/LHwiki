export const CHANGELOG_ENTRIES = Object.freeze([
  {
    version: 'v0.8.1',
    title: '深色模式与 Markdown',
    date: '2026-08-15',
    items: [
      '新增跟随系统、浅色和深色三种外观选择，并记住手动偏好。',
      '投稿编辑器支持 Markdown 输入与输出，兼容现有标题、列表、表格、公式、分栏和折叠内容。',
      'Markdown 链接和代码采用安全文本渲染，不改变数据库结构、云端接口或角色权限。'
    ]
  },
  {
    version: 'v0.8.0',
    title: '轻量文档工作台与更新日志',
    date: '2026-08-13',
    items: [
      '编辑器新增四级标题、纯文本表格、分栏、折叠标题、块级公式和分隔线。',
      '统一可搜索的命令面板支持顶部、块旁和斜杠入口，并可使用中英文别名。',
      '完善表格键盘操作、窄屏布局、公式安全渲染、嵌套块标识和高级内容的云端覆盖保护。',
      '新增站内更新日志，并将后续更新同步记录纳入发布流程。'
    ]
  },
  {
    version: 'v0.7.0',
    title: '协作、编辑与资源优化',
    date: '2026-08-12',
    items: [
      '管理员可校订待审核文章，同时保留投稿归属和完整审核流程。',
      '修复回车失焦、长文换行跳顶和搜索失焦，页面滚动会以最小距离跟随输入焦点。',
      '扩充教师索引，并通过缓存、按需加载、访问量批处理和登录限流降低资源消耗。',
      '补齐自动测试、PostgreSQL 迁移与开源发布说明。'
    ]
  },
  {
    version: 'v0.6.0',
    title: '教师索引共建',
    date: '2026-08-09',
    items: [
      '新增教师资料补充入口，资料经独立审核后才进入公开索引。',
      '审核中心和“我的投稿”统一展示文章与教师资料的进度。',
      '加入重复检查、每日上限及对应的数据库权限与备份支持。'
    ]
  },
  {
    version: 'v0.5.1',
    title: '稳定性修复',
    date: '2026-08-09',
    items: [
      '修复 PostgreSQL 时间戳解析和云函数初始化故障。',
      '增加请求超时、只读重试、健康检查、错误降级和双入口巡检。'
    ]
  },
  {
    version: 'v0.5.0',
    title: '写作体验重构',
    date: '2026-08-09',
    items: [
      '上线纯文本块编辑器，支持标题、引用、列表、回车拆分、快捷格式和实时字数。',
      '草稿本地优先保存，再以乐观锁同步云端，并支持离线恢复和冲突保护。',
      '文章可根据标题自动生成两级目录。'
    ]
  },
  {
    version: 'v0.4.0',
    title: '治理、安全与运维',
    date: '2026-08-08',
    items: [
      '新增致谢页和实名内容贡献者记录。',
      '完善管理员保护、已发布文章管理、会话安全、内容校验和访问限流。',
      '建立带校验的自动备份、恢复说明、冒烟测试与稳定性检查。'
    ]
  },
  {
    version: 'v0.3.0',
    title: 'CloudBase 上海迁移',
    date: '2026-08-07',
    items: [
      '生产环境迁至 CloudBase 上海静态托管、Node.js 20 云函数和 PostgreSQL。',
      '配置同域 API 路由，并保留 Cloudflare 版本作为灾备路径。'
    ]
  },
  {
    version: 'v0.2.0',
    title: '校园内容与体验完善',
    date: '2026-08-07',
    items: [
      '加入教师索引、课程评价、校园生活、社团与高三备考等目录。',
      '增加九位学号校内初筛，以及审核者和管理员权限体系。',
      '完成搜索、侧栏导航、移动端布局和经验分享文案。'
    ]
  },
  {
    version: 'v0.1.0',
    title: '最小可用版',
    date: '2026-08-07',
    items: [
      '建立公开目录、分区、文章浏览和关键词搜索。',
      '实现投稿、人工审核和批准后公开发布的完整闭环。',
      '首版运行于 Cloudflare Workers 与 D1。'
    ]
  }
]);

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
})[char]);

export function changelogPage() {
  const entries = CHANGELOG_ENTRIES.map((entry, index) => `
    <article class="changelog-entry">
      <div class="changelog-marker" aria-hidden="true"><span>${String(index + 1).padStart(2, '0')}</span></div>
      <div class="changelog-copy">
        <div class="changelog-meta"><strong>${escapeHtml(entry.version)}</strong><time datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date)}</time></div>
        <h2>${escapeHtml(entry.title)}</h2>
        <ul>${entry.items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
    </article>`).join('');

  return `<header class="page-heading changelog-heading"><span class="eyebrow">RELEASE NOTES</span><h1>更新日志</h1><p>记录 LHwiki 从最初版本到现在的功能演进。最新更新排在最前。</p></header><section class="changelog-list" aria-label="LHwiki 版本更新记录">${entries}</section>`;
}
