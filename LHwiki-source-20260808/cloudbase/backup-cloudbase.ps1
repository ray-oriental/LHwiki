[CmdletBinding()]
param(
  [string]$ProjectRoot,
  [int]$Keep = 30
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
$EnvIdExpected = 'lhwiki-d9g6r8vfzc7be1c0a'
$SiteUrl = 'https://lhwiki-d9g6r8vfzc7be1c0a-1465088461.ap-shanghai.app.tcloudbase.com'
$CredentialPath = Join-Path $env:LOCALAPPDATA 'LHwiki\backup-api-key.clixml'
$SettingsPath = Join-Path $env:LOCALAPPDATA 'LHwiki\backup-settings.json'
$BackupRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'backup'))
$ExpectedRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\') + '\'
if (-not $BackupRoot.StartsWith($ExpectedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw '备份目录必须位于 LHwiki 项目目录内。'
}
if (-not (Test-Path -LiteralPath $CredentialPath)) {
  throw "尚未配置备份凭据，请先运行 cloudbase\setup-backup.ps1。"
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
$credential = Import-Clixml -LiteralPath $CredentialPath
$envId = $credential.UserName
if ($envId -ne $EnvIdExpected) { throw '备份凭据所属环境与 LHwiki 正式环境不一致。' }
$apiKey = $credential.GetNetworkCredential().Password
$headers = @{ Accept = 'application/json'; Authorization = "Bearer $apiKey" }
$network = @{ TimeoutSec = 30 }
if (Test-NetConnection -ComputerName '127.0.0.1' -Port 7897 -InformationLevel Quiet -WarningAction SilentlyContinue) {
  $network.Proxy = 'http://127.0.0.1:7897'
}
$tables = @('sections', 'articles', 'users', 'submissions', 'review_events', 'contributors')
$data = [ordered]@{}

foreach ($table in $tables) {
  $rows = @()
  $offset = 0
  do {
    $uri = "https://$envId.api.tcloudbasegateway.com/v1/rdb/rest/$table`?select=*&limit=1000&offset=$offset"
    $response = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers @network
    $page = @($response)
    while ($page.Count -eq 1 -and $page[0] -is [Array]) {
      $page = @($page[0] | ForEach-Object { $_ })
    }
    $rows += $page
    $offset += $page.Count
  } while ($page.Count -eq 1000)
  $data[$table] = $rows
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$finalPath = Join-Path $BackupRoot "lhwiki-$stamp.json"
$tempPath = "$finalPath.tmp"
$payload = [ordered]@{
  formatVersion = 1
  environmentId = $envId
  exportedAt = (Get-Date).ToUniversalTime().ToString('o')
  counts = [ordered]@{}
  data = $data
}
foreach ($table in $tables) { $payload.counts[$table] = @($data[$table]).Count }
$payload | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $tempPath -Encoding UTF8

$verified = Get-Content -Raw -LiteralPath $tempPath -Encoding UTF8 | ConvertFrom-Json
if ($verified.environmentId -ne $envId -or $null -eq $verified.data.articles) {
  Remove-Item -LiteralPath $tempPath -Force
  throw '备份完整性校验失败，临时文件已删除。'
}
Move-Item -LiteralPath $tempPath -Destination $finalPath
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $finalPath).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($finalPath))" | Set-Content -LiteralPath "$finalPath.sha256" -Encoding ASCII

$files = @(Get-ChildItem -LiteralPath $BackupRoot -Filter 'lhwiki-*.json' -File | Sort-Object LastWriteTime -Descending)
if ($files.Count -gt $Keep) {
  foreach ($old in $files[$Keep..($files.Count - 1)]) {
    $resolved = [IO.Path]::GetFullPath($old.FullName)
    if (-not $resolved.StartsWith($BackupRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '拒绝清理项目备份目录以外的文件。' }
    Remove-Item -LiteralPath $resolved -Force
    $oldHash = "$resolved.sha256"
    if (Test-Path -LiteralPath $oldHash) { Remove-Item -LiteralPath $oldHash -Force }
  }
}

$warnings = @()
try {
  $health = Invoke-RestMethod -Method Get -Uri "$SiteUrl/api/health" @network
  if (-not $health.ok) { $warnings += '线上健康检查未返回 ok=true。' }
} catch { $warnings += "线上健康检查失败：$($_.Exception.Message)" }

if (Test-Path -LiteralPath $SettingsPath) {
  $settings = Get-Content -Raw -LiteralPath $SettingsPath -Encoding UTF8 | ConvertFrom-Json
  foreach ($entry in @(
    @{ Label = 'CloudBase 体验版环境'; Date = $settings.environmentExpiresAt },
    @{ Label = '备份 API Key'; Date = $settings.apiKeyExpiresAt }
  )) {
    if ($entry.Date) {
      $days = [math]::Floor(((Get-Date $entry.Date) - (Get-Date)).TotalDays)
      if ($days -le 30) { $warnings += "$($entry.Label)将在 $days 天后到期。" }
    }
  }
}

$logPath = Join-Path $BackupRoot 'maintenance.log'
$line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') backup=$([IO.Path]::GetFileName($finalPath)) counts=$($payload.counts | ConvertTo-Json -Compress) warnings=$($warnings.Count)"
Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
if ($warnings.Count) {
  $attention = @("LHwiki 运维提醒（$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')）", '') + $warnings
  $attention | Set-Content -LiteralPath (Join-Path $BackupRoot 'ATTENTION.txt') -Encoding UTF8
  try { & msg.exe $env:USERNAME ($warnings -join ' ') 2>$null } catch {}
} else {
  $attentionPath = Join-Path $BackupRoot 'ATTENTION.txt'
  if (Test-Path -LiteralPath $attentionPath) { Remove-Item -LiteralPath $attentionPath -Force }
}

Write-Host "备份完成：$finalPath"
Write-Host "数据行数：$($payload.counts | ConvertTo-Json -Compress)"


