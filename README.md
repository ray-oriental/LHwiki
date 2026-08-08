# LHwiki

面向潞河校园的轻量共建手册。读者可以公开浏览；同学用符合规则的九位学号登入并提交富文本内容；审核者可以退回、拒绝或批准投稿；管理员可以授予和收回审核权限。

生产环境部署在 CloudBase 上海：

- 网站：<https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com/>
- 前端：CloudBase 静态网站托管
- 后端：`lhwiki-api` Node.js 20 HTTP 云函数
- 数据库：CloudBase PostgreSQL
- 部署与备案说明：[`cloudbase/README.md`](cloudbase/README.md)

原 Cloudflare Workers + D1 配置保留为灾备回退，不再是当前生产环境。

## 已实现功能

- 侧栏目录、分区卡片、文章列表、关键词搜索和移动端导航。
- 所见即所得编辑器，支持段落、小标题、引用、项目列表和编号列表，不支持图片与附件。
- 投稿状态：等待审核、需修改、已发布、未采用；投稿者可以按审核意见修改后重新提交。
- 审核队列、审核记录和角色管理；批准后自动生成公开文章。
- 管理员可以在文章页直接编辑或删除已发布稿件；修改即时生效，删除保留原投稿和审核记录作为审计依据。
- 首次实名投稿获批后，内容贡献者自动上榜。每个学号只有一个机会，姓名取第一次实名投稿时填写的名称；匿名投稿不进入榜单。
- 服务端签名会话、HttpOnly Cookie、数据库角色复核、请求来源校验、结构化正文白名单、字段长度限制和按 IP 写操作限流。
- 每位账号每日最多投稿 10 次；公开目录与文章使用短时缓存，降低函数和数据库消耗。

## 本地运行与测试

需要 Node.js 20 或更高版本。

```powershell
pnpm install
pnpm test
```


## 自动备份

生产数据每天 03:30 由 Windows 计划任务 `LHwiki-CloudBase-Backup` 自动导出到本项目的 `backup` 目录：

```text
D:\Workspace\codex project\campus-notes\backup
```

备份包括 `sections`、`articles`、`users`、`submissions`、`review_events` 和 `contributors`。脚本采用分页读取、临时文件原子落盘、JSON 回读校验和 SHA-256 校验文件，保留最近 30 份。备份包含学号、未公开投稿和审核记录。


重新配置计划任务或备份专用 API Key：

```powershell
& ".\cloudbase\setup-backup.ps1"
```

机器本地的备份凭据由 Windows DPAPI 加密，存放于 `%LOCALAPPDATA%\LHwiki`，不会同步进项目。维护日志和需要处理的告警写入 `backup\maintenance.log` 与 `backup\ATTENTION.txt`。完整恢复步骤见 [`backup/README.md`](backup/README.md)。

## 安全与运维

- 学号格式只是一层校内初筛，不等同于强身份认证；公开署名不能视为学校认证的实名。
- `lhwiki-api` 的服务器 API Key 仅存于云函数环境变量；运行 Key 和备份 Key 已分离，泄漏时可单独吊销。
- 当前运行 Key 和备份 Key 均在 2027-08-08 到期；备份任务会在 30 天内到期时写入告警文件。轮换后需要分别更新云函数环境变量和本机 DPAPI 凭据。
- 登录、投稿、编辑、审核和管理接口均有按 IP 的分钟级限流；账号投稿另有每日限制。当前限流是单实例内存限流，能抑制普通滥用，但不是分布式防护或专业 DDoS 清洗。
- 公开目录缓存 60 秒、文章缓存 300 秒；投稿、审核和管理响应不缓存。
- 禁止 HTML、图片和附件。编辑器输出受限结构化区块，服务端再次验证，浏览器只以文本节点渲染。
- 对教师、学生和社团的评价仍有隐私与名誉风险。至少保留两名人工审核者，并优先拦截可识别个人的敏感信息、未经证实的严重指控和人身攻击。

## 上线后变更原则

- 数据库结构只通过 `cloudbase/migrations/` 中的新迁移修改，不回改已经执行的历史迁移。
- 修改后至少运行 `pnpm test`，再人工走通登入、投稿、退回、重新提交、批准、公开浏览、致谢上榜和撤权。
- 发布前确认 Syncthing 已完成，且项目内没有 `sync-conflict` 文件；不要在两台电脑上同时编辑同一项目。

## 开源发布

项目采用 MIT License。上传 GitHub 前请按照 [`GITHUB发布说明.md`](GITHUB发布说明.md) 操作；发布包会排除依赖、备份、日志、本机凭据、部署私有数据和运行密钥。发现安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告，不要在公开 Issue 中粘贴学号、投稿或密钥。
