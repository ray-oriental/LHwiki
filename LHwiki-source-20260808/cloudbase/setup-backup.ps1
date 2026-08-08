[CmdletBinding()]
param(
  [string]$EnvId = 'lhwiki-d9g6r8vfzc7be1c0a',
  [SecureString]$ApiKey,
  [datetime]$ApiKeyExpiresAt = '2027-08-08T00:00:00+08:00',
  [string]$DailyAt = '03:30'
)

$ErrorActionPreference = 'Stop'
if (-not $ApiKey) { $ApiKey = Read-Host '请输入专用于本机备份的 CloudBase API Key' -AsSecureString }
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
} | ConvertTo-Json | Set-Content -LiteralPath $SettingsPath -Encoding UTF8

$time = [datetime]::ParseExact($DailyAt, 'HH:mm', [Globalization.CultureInfo]::InvariantCulture)
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$BackupScript`""
$trigger = New-ScheduledTaskTrigger -Daily -At $time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'LHwiki-CloudBase-Backup' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description '每日备份 LHwiki CloudBase PostgreSQL 到项目 backup 文件夹，并执行健康与到期检查。' -Force | Out-Null

& $BackupScript -ProjectRoot $ProjectRoot
Write-Host '已启用每日自动备份：LHwiki-CloudBase-Backup'
Write-Host "备份位置：$(Join-Path $ProjectRoot 'backup')"
Write-Host "凭据使用 Windows DPAPI 加密保存在：$CredentialPath"

