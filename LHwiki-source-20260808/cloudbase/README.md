# LHwiki CloudBase 上海生产说明

当前生产架构为：

- `public/`：CloudBase 静态网站托管；
- `functions/lhwiki-api/`：Node.js 20 HTTP 云函数；
- 在线工作流：上海 COS 私有桶中的加密追加事件与快照；
- 公开读取：白名单公开快照与六小时缓存；
- CloudBase PostgreSQL：只读保留的历史归档，正常网站请求不得连接；
- 备案自定义域名：同域名下 `/api/*` 进入云函数，其余路径进入静态托管。

## 安全发布准备

1. 确认 Syncthing 为 idle 且没有 `sync-conflict` 文件。
2. 运行 `cloudbase/prepare-production-release.ps1`。它会执行完整测试，并按 `function-production-files.json` 的 13 文件白名单构建 `release/cloudbase-functions/lhwiki-api`。
3. 核验生成的 SHA-256 清单；正常函数包不得含 `pg-store.cjs`、迁移、备份、密钥、日志或数据库配置。
4. 使用 CloudBase MCP，只部署发生变化的组件，并始终显式指定环境 `lhwiki-d9g6r8vfzc7be1c0a`。函数发布使用 `release/cloudbase-functions` 作为 `functionRootPath`；纯前端变更只上传 `public/`。
5. 发布后仅用 `/api/health` 和只读管控面指标验收；除非用户明确要求业务写入验收，不运行生产投稿冒烟或 PostgreSQL 备份。

旧版 `deploy-cloudbase.ps1` 的 NoSQL/PostgreSQL 全量部署逻辑已经永久停用；同名入口现在只准备安全候选包，不会登录或修改线上。历史数据库结构仍由 `cloudbase/migrations/` 记录，但这些文件只用于归档维护，不能进入正常函数包。

草稿、投稿、审核、权限和公开发布继续由应用层签名会话、角色检查、`student_id` 所有权和单调递增的 `revision` 保护；底层存储改为私有加密对象事件，不再依赖 PostgreSQL `service_role`。

## 当前线上环境

- 环境：`lhwiki-d9g6r8vfzc7be1c0a`（上海）
- 同域访问地址：`https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com/`
- `/`：公开静态网站；`/api/*`：公开网关路由到 `lhwiki-api`
- API 网关本身不要求 CloudBase 身份认证；投稿、审核和管理操作仍由应用自己的签名会话、来源检查和角色权限保护。
- 当前种子数据：7 个分区、9 篇基础文章。
- 迁移前完整归档和原 PostgreSQL 均已保留；不创建每日数据库备份任务，只有恢复核对时才显式确认一次人工读取。

## 历史 D1 迁移材料

Cloudflare D1 与 PostgreSQL 迁移脚本只作为历史回滚材料，不属于当前发布流程。`migration-data.private.json` 含学号及未公开投稿，始终由 `.gitignore` 排除，也不得复制进函数候选包。现有全部投稿已经迁移并核验，不应重复执行旧迁移。

## 更新基础内容

修改根目录 `schema.sql` 后重新生成种子：

```powershell
node .\cloudbase\tools\build-seed.mjs
```

种子只在全新、空的 `sections` 表中自动导入，不会覆盖已经上线的内容。

## 生成公开内容快照

公共目录和文章正文从 `lhwiki-system/public-snapshot.json` 云存储对象读取，函数端与浏览器端保留六小时缓存；普通浏览、稳定性巡检和缓存刷新都不得读取 PostgreSQL。部署包中的同名快照仅作为云存储故障时的只读回退。完成一次人工核验的生产备份后，可在受控电脑上用明确路径生成快照；脚本会拒绝未批准字段、无效正文和未审核的贡献者/教师补充：

```powershell
node .\scripts\build-public-snapshot.mjs 'D:\受控路径\lhwiki-YYYYMMDD-HHmmss.json'
```

快照不包含学号、草稿、投稿、审核记录或数据库主键以外的私有字段；不要把备份路径或备份正文提交到公开仓库。首次部署时把生成结果上传到固定云存储路径，并在函数包内保留一份相同文件。
公开文章、教师补充或管理员文章修改完成后，后端会在同一次私有 COS 工作流提交中重建白名单快照并覆盖固定对象；读取失败回退到包内快照，上传失败会记录受限诊断并在响应中返回 `publicSnapshotSynced: false`，不会把私有事件内容暴露到公共快照。

`scripts/functional-smoke.mjs` 默认只连接本机 `127.0.0.1:9000`。生产写作冒烟会真实创建、修改和删除工作流事件，因此必须显式设置确认变量才允许运行；日常线上验收只使用数据库无关的 `/api/health` 与管控面指标。

## 安全说明

- `SESSION_SECRET`、工作流密钥和临时云凭据都不写入仓库；安全发布脚本不会生成或覆盖线上环境变量；
- `ray_oriental` 是唯一通过特殊登入标识自动取得管理员权限的账号；
- 普通学生仍需输入 `20xx` 年份 + 三位班级号 + 两位序号组成的九位学号；
- 学号格式只是校内初筛，不等同于可靠身份认证；
- 历史归档 API Key 仅在明确人工备份时使用，由本机 DPAPI 保存；正常函数包不含 PostgreSQL API Key；
- Cloudflare 版本继续作为灾备回退材料保留，不参与当前生产请求。
