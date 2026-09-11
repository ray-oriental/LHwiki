[CmdletBinding()]
param(
  [string]$EnvId = 'lhwiki-d9g6r8vfzc7be1c0a',
  [SecureString]$ApiKey,
  [datetime]$ApiKeyExpiresAt = '2027-08-08T00:00:00+08:00',
  [string]$DailyAt = '03:30',
  [switch]$EnableScheduledTask,
  [switch]$SkipScheduledTask,
  [switch]$ConfirmPostgreSqlWakeup
)

$ErrorActionPreference = 'Stop'
if ($EnableScheduledTask) {
  throw '已永久停用每日 PostgreSQL 备份任务；在线工作流使用私有 COS，历史数据库只能按明确需要人工归档。'
}
if ($EnvId -ne 'lhwiki-d9g6r8vfzc7be1c0a') { throw '备份凭据必须属于 LHwiki 正式环境。' }
if (-not $ApiKey) { $ApiKey = Read-Host '请输入专用于人工历史归档的 CloudBase API Key' -AsSecureString }

$LocalRoot = Join-Path $env:LOCALAPPDATA 'LHwiki'
$CredentialPath = Join-Path $LocalRoot 'backup-api-key.clixml'
$SettingsPath = Join-Path $LocalRoot 'backup-settings.json'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupScript = Join-Path $PSScriptRoot 'backup-cloudbase.ps1'
New-Item -ItemType Directory -Force -Path $LocalRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ProjectRoot 'backup') | Out-Null

$credential = [PSCredential]::new($EnvId, $ApiKey)
$credential | Export-Clixml -LiteralPath $CredentialPath
[ordered]@{
  environmentId = $EnvId
  environmentExpiresAt = '2027-02-07T23:59:59+08:00'
  apiKeyExpiresAt = $ApiKeyExpiresAt.ToString('o')
  configuredAt = (Get-Date).ToString('o')
  scheduledBackup = $false
} | ConvertTo-Json | Set-Content -LiteralPath $SettingsPath -Encoding UTF8

if ($ConfirmPostgreSqlWakeup) {
  & $BackupScript -ProjectRoot $ProjectRoot -ConfirmPostgreSqlWakeup
}
Write-Host '已配置本机人工归档凭据；不会创建每日计划任务。'
if (-not $ConfirmPostgreSqlWakeup) {
  Write-Host '本次未连接历史 PostgreSQL。需要新归档时，请明确添加 -ConfirmPostgreSqlWakeup。'
}
Write-Host "备份位置：$(Join-Path $ProjectRoot 'backup')"
Write-Host "凭据使用 Windows DPAPI 加密保存在：$CredentialPath"
