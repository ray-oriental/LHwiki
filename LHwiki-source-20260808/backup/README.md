# LHwiki 历史 PostgreSQL 归档

此目录保留迁移前与人工维护时生成的完整 PostgreSQL 归档。在线投稿、草稿、审核和权限已经迁移到私有 COS，正常发布不再读取历史数据库。每日 PostgreSQL 备份任务已永久停用；各电脑如仍存在 `LHwiki-CloudBase-Backup`，应将其禁用或删除。

只有明确需要恢复核对或重新归档时，才可在确认会产生数据库核时后运行：

```powershell
& '.\cloudbase\backup-cloudbase.ps1' -ConfirmPostgreSqlWakeup
```

脚本继续保留最近 30 份：

- `lhwiki-YYYYMMDD-HHmmss.json`：完整业务数据，包括仅用户本人可见的云端草稿。
- 同名 `.sha256`：完整性校验值。
- `maintenance.log`：备份、健康检查和到期检查日志。
- `ATTENTION.txt`：只有需要处理的异常或到期提醒存在时才会出现。

备份 API Key 不保存在项目中，而是使用当前 Windows 用户的 DPAPI 加密后放在 `%LOCALAPPDATA%\LHwiki`。备份文件包含学号、草稿和未公开投稿，不能上传到公开仓库或公开网盘。
