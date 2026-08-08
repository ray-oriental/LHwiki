# LHwiki 自动备份

此目录由 `cloudbase/backup-cloudbase.ps1` 写入，默认每天 03:30 运行并保留最近 30 份：

- `lhwiki-YYYYMMDD-HHmmss.json`：完整业务数据。
- 同名 `.sha256`：完整性校验值。
- `maintenance.log`：备份、健康检查和到期检查日志。
- `ATTENTION.txt`：只有需要处理的异常或到期提醒存在时才会出现。

备份 API Key 不保存在项目中，而是使用当前 Windows 用户的 DPAPI 加密后放在 `%LOCALAPPDATA%\LHwiki`。备份文件包含学号和未公开投稿，不能上传到公开仓库或公开网盘。
