# LHwiki CloudBase 上海迁移包

本目录把现有 Cloudflare Worker + D1 版本迁移为：

- `public/`：CloudBase 静态网站托管；
- `functions/lhwiki-api/`：Node.js 20 HTTP 云函数；
- CloudBase PostgreSQL：`users`、`sections`、`articles`、`submissions`、`review_events`、`contributors`、`drafts` 七张表；
- 备案自定义域名：同域名下 `/api/*` 进入云函数，其余路径进入静态托管。

## 最短部署流程

1. 在 CloudBase 控制台创建上海环境并启用 PostgreSQL、云函数和静态托管。
2. 在“身份认证 / API Key”中创建一个专供 `lhwiki-api` 使用的服务器 API Key；它只会以函数环境变量保存。
3. 安装 Node.js 20+ 和 pnpm；在 Codex 桌面环境中，脚本会自动使用 Codex 自带的 Node 和 pnpm。
4. 双击 `双击部署LHwiki到CloudBase.cmd`，输入环境 ID、API Key 并完成腾讯云授权。
5. 按 `备案与域名接入.md` 提交备案、绑定证书、CNAME 和同域路由。

数据库结构由 `cloudbase/migrations/` 中的 PostgreSQL 迁移管理。HTTP 函数通过 CloudBase 关系型数据库 REST API 访问数据；服务器 API Key 只存在于函数环境变量，前端代码中没有密钥。基础内容来自 `seed-data.json`，首次访问 API 时自动写入空表。

`drafts` 仅允许 `lhwiki-api` 的 `service_role` 访问，浏览器不能直接读写。应用层签名会话先校验学号身份，再按 `student_id` 限定草稿；保存使用单调递增的 `revision` 做条件更新，冲突返回 409，避免多个页面互相覆盖。

## 当前线上环境

- 环境：`lhwiki-d9g6r8vfzc7be1c0a`（上海）
- 同域访问地址：`https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com/`
- `/`：公开静态网站；`/api/*`：公开网关路由到 `lhwiki-api`
- API 网关本身不要求 CloudBase 身份认证；投稿、审核和管理操作仍由应用自己的签名会话、来源检查和角色权限保护。
- 当前种子数据：7 个分区、9 篇基础文章。
- 每天 03:30 的自动备份写入项目根目录 `backup/`，计划任务名为 `LHwiki-CloudBase-Backup`。

## 是否迁移当前 D1 中的非公开数据

默认包只带基础分区和公开示例文章，不包含任何学号、投稿或审核记录。如果要完整迁移当前 D1：

```powershell
& ".\cloudbase\导出现有D1数据.ps1"
& ".\cloudbase\deploy-cloudbase.ps1"
```

第一条命令调用已授权的 Wrangler 导出 D1，并生成被 `.gitignore` 排除的 `migration-data.private.json`。它含学号及未公开投稿，只能保存在受控电脑中；迁移成功后应安全删除本地导出文件。

## 更新基础内容

修改根目录 `schema.sql` 后重新生成种子：

```powershell
node .\cloudbase\tools\build-seed.mjs
```

种子只在全新、空的 `sections` 表中自动导入，不会覆盖已经上线的内容。

## 安全说明

- `SESSION_SECRET` 不写入仓库，由部署脚本随机生成并写入函数环境变量；
- `ray_oriental` 是唯一通过特殊登入标识自动取得管理员权限的账号；
- 普通学生仍需输入 `20xx` 年份 + 三位班级号 + 两位序号组成的九位学号；
- 学号格式只是校内初筛，不等同于可靠身份认证；
- 服务器 API Key 需要在到期前轮换；当前运行 Key 与备份 Key 均在 2027-08-08 到期，备份任务会在提前 30 天时生成告警；
- Cloudflare 版本继续保留，直到 CloudBase 上线验收和数据备份完成。
