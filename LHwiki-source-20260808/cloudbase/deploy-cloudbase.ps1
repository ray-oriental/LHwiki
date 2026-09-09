[CmdletBinding()]
param(
  [string]$EnvId = 'lhwiki-d9g6r8vfzc7be1c0a',
  [switch]$SkipLogin
)

$ErrorActionPreference = 'Stop'
$CloudBaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Warning '旧版 NoSQL/PostgreSQL 全量一键部署已永久停用，以免重新打包数据库适配器、覆盖运行密钥或唤醒历史数据库。'
if ($SkipLogin) { Write-Verbose '-SkipLogin 已保留为兼容参数；准备发布包不需要登录。' }
& (Join-Path $CloudBaseDir 'prepare-production-release.ps1') -EnvId $EnvId
Write-Host '未执行线上部署。请由生产发布流程使用上方白名单函数目录，并显式指定完整 EnvId。' -ForegroundColor Yellow
