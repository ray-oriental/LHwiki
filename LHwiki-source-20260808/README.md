# LHwiki

面向潞河校园的轻量共建手册。读者可以公开浏览；同学用符合规则的九位学号登入并提交富文本内容；审核者可以退回、拒绝或批准投稿；管理员可以授予和收回审核权限。

生产环境部署在 CloudBase 上海：

- 网站：<https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com/>
- 前端：CloudBase 静态网站托管
- 后端：`lhwiki-api` Node.js 20 HTTP 云函数
- 数据库：CloudBase PostgreSQL
- 部署与备案说明：[`cloudbase/README.md`](cloudbase/README.md)

原 Cloudflare Workers + D1 配置保留为灾备回退，不再是当前生产环境。

## 版本迭代

以下版本号根据正式上线后的交付节点补记；完整记录见 [`CHANGELOG.md`](CHANGELOG.md)。

| 版本 | 核心更新 |
| --- | --- |
| **v0.7.0 · 协作与资源优化** | 管理员可编辑待审稿；修复编辑器跳顶；补充教师索引；加入前端缓存、摘要接口、访问量批处理和登录扫描防护。 |
| **v0.1.0 · 最小可用版** | 建立目录、搜索、文章浏览、学号投稿和人工审核闭环，首版运行于 Cloudflare Workers + D1。 |
| **v0.2.0 · LHwiki** | 完成品牌与界面重构，加入九位学号校内初筛、审核/管理员角色、教师索引和移动端适配。 |
| **v0.3.0 · 上海迁移** | 迁移至 CloudBase 上海：静态托管 + Node.js 20 HTTP 云函数 + PostgreSQL，改善中国大陆访问。 |
| **v0.4.0 · 治理与安全** | 增加致谢榜、实名贡献者去重、管理员持久化编辑/删除、限流、自动备份和端到端测试。 |
| **v0.5.0 · 写作体验** | 上线类 Notion/知乎块编辑器、快捷键、云端实时草稿、离线恢复、冲突保护和文章子目录。 |
| **v0.5.1 · 稳定性修复** | 修复日期解析与运行密钥故障，加入超时重试、健康检查、双入口巡检和每日自动监控。 |
| **v0.6.0 · 教师共建** | 教师索引支持校内补充：姓名/学科必填、格言选填，经审核后公开，并可查看个人审核状态。 |

## 已实现功能

- 侧栏目录、分区卡片、文章列表、关键词搜索和移动端导航。
- `20xx` 年份、三位班级号、两位序号组成的九位学号登入；完整学号不会出现在公开文章、致谢页或公开接口中。
- 类 Notion/知乎的纯文本内容块编辑器，支持正文、二/三级标题、引用、项目列表和编号列表；Enter 拆分、快捷格式、纯文本粘贴与实时字数统计，不支持图片与附件。
- 草稿会先写入当前设备，再以 revision 乐观锁自动同步云端；支持离线恢复、失败退避、多页面冲突保护、多个草稿和手动立即保存。
- 使用新版编辑器形成的二/三级标题会自动生成两级文章目录，桌面端粘附阅读栏，移动端可折叠。
- 投稿状态：等待审核、需修改、已发布、未采用；投稿者可以按审核意见修改后重新提交。
- 审核队列、审核记录和角色管理；批准后自动生成公开文章。
- 管理员可以在文章页直接编辑或删除已发布稿件；修改即时生效，删除保留原投稿和审核记录作为审计依据。
- `ray_oriental` 是受保护的站点管理员：登入、会话读取和权限接口都会保持其管理员角色，不能通过站内操作降权。
- “致谢”页面：固定展示开发者 Chenrx；首次实名投稿获批后，内容贡献者自动上榜。每个学号只有一个机会，姓名取第一次实名投稿时填写的名称；匿名投稿不进入榜单。
- 服务端签名会话、HttpOnly Cookie、数据库角色复核、请求来源校验、结构化正文白名单、字段长度限制和按 IP 写操作限流。
- 每位账号每日最多投稿 10 次；公开目录与文章使用短时缓存，降低函数和数据库消耗。

## 本地运行与测试

需要 Node.js 20 或更高版本。

```powershell
pnpm install
pnpm test
Copy-Item .dev.vars.example .dev.vars
# 将 .dev.vars 中的 SESSION_SECRET 替换为至少 32 字节的本地随机字符串
pnpm db:local
pnpm dev -- --local --port 8787
```

启动后访问 <http://localhost:8787>。如果使用 npm，对应命令为 `npm install`、`npm test`、`npm run db:local` 和 `npm run dev -- --local --port 8787`。只浏览公开页面可以不配置会话密钥；需要登入时必须先配置 `.dev.vars` 中的 `SESSION_SECRET`。开发服务器需要保持运行，关闭终端或按下 `Ctrl+C` 后网站将无法访问。

Cloudflare 回退版本的本地开发命令和密钥样例仍保留在 `package.json`、`.dev.vars.example` 与 `wrangler.jsonc` 中。CloudBase 生产部署不要把服务器 API Key 写入源码、前端或 `.env` 文件。

## 自动备份

生产数据每天 03:30 由 Windows 计划任务 `LHwiki-CloudBase-Backup` 自动导出到本项目的 `backup` 目录：

```text
D:\Workspace\codex project\campus-notes\backup
```

备份包括 `sections`、`articles`、`users`、`submissions`、`review_events`、`contributors`、`drafts`、`teacher_submissions` 和 `teacher_additions`。脚本采用分页读取、临时文件原子落盘、JSON 回读校验和 SHA-256 校验文件，保留最近 30 份。备份包含学号、未公开投稿和审核记录，严禁上传到公开仓库或公开网盘。

手工备份：

```powershell
& ".\cloudbase\backup-cloudbase.ps1"
```

重新配置计划任务或备份专用 API Key：

```powershell
& ".\cloudbase\setup-backup.ps1"
```

机器本地的备份凭据由 Windows DPAPI 加密，存放于 `%LOCALAPPDATA%\LHwiki`，不会同步进项目。维护日志和需要处理的告警写入 `backup\maintenance.log` 与 `backup\ATTENTION.txt`。完整恢复步骤见 [`backup/README.md`](backup/README.md)。

## 安全与运维

- 当前管理员登入逻辑按项目约定保持不变。
- 学号格式只是一层校内初筛，不等同于强身份认证；公开署名不能视为学校认证的实名。
- `lhwiki-api` 的服务器 API Key 仅存于云函数环境变量；运行 Key 和备份 Key 已分离，泄漏时可单独吊销。
- 当前运行 Key 和备份 Key 均在 2027-08-08 到期；备份任务会在 30 天内到期时写入告警文件。轮换后需要分别更新云函数环境变量和本机 DPAPI 凭据。
- 登录、投稿、编辑、审核和管理接口均有按 IP 的分钟级限流；账号投稿另有每日限制。当前限流是单实例内存限流，能抑制普通滥用，但不是分布式防护或专业 DDoS 清洗。
- 公开目录缓存 60 秒、文章缓存 300 秒；草稿、投稿、审核和管理响应不缓存。
- 禁止 HTML、图片和附件。编辑器输出受限结构化区块，服务端再次验证，浏览器只以文本节点渲染。
- 对教师、学生和社团的评价仍有隐私与名誉风险。至少保留两名人工审核者，并优先拦截可识别个人的敏感信息、未经证实的严重指控和人身攻击。
- CloudBase 免费资源点不是“无限流量”。文本内容和小规模校园使用通常不易耗尽额度，但恶意刷新、爬虫、批量投稿以及每次 API 请求触发的函数和数据库调用都可能放大消耗，应定期查看 CloudBase 控制台的资源用量与账单告警。

## 上线后变更原则

- 数据库结构只通过 `cloudbase/migrations/` 中的新迁移修改，不回改已经执行的历史迁移。
- 修改后至少运行 `pnpm test`，再人工走通登入、投稿、退回、重新提交、批准、公开浏览、致谢上榜和撤权。
- 发布前确认 Syncthing 已完成，且项目内没有 `sync-conflict` 文件；不要在两台电脑上同时编辑同一项目。

## 开源发布

项目采用 MIT License。上传 GitHub 前请按照 [`GITHUB发布说明.md`](GITHUB发布说明.md) 操作；发布包会排除依赖、备份、日志、本机凭据、部署私有数据和运行密钥。发现安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要在公开 Issue 中粘贴学号、投稿或密钥。
