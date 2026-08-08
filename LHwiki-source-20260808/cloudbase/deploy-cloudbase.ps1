[CmdletBinding()]
param(
  [string]$EnvId,
  [switch]$SkipLogin
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$CloudBaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $CloudBaseDir
$LogPath = Join-Path $CloudBaseDir 'deployment.log'
Set-Content -LiteralPath $LogPath -Value "LHwiki CloudBase deployment $(Get-Date -Format o)" -Encoding UTF8

try {
  $BundledNodeDir = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin'
  $BundledNode = Join-Path $BundledNodeDir 'node.exe'
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $BundledNode)) {
    $env:PATH = "$BundledNodeDir;$env:PATH"
  }
  $Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
  if (-not $Node) { throw 'CloudBase CLI 需要 Node.js。请安装 Node.js LTS，或确认 Codex 自带运行时仍然存在。' }

  $Pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $Pnpm) { $Pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source }
  if (-not $Pnpm) {
    $BundledPnpm = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd'
    if (Test-Path -LiteralPath $BundledPnpm) { $Pnpm = $BundledPnpm }
  }
  if (-not $Pnpm) { throw '没有找到 pnpm。请安装 Node.js 20+，然后执行：npm install -g pnpm' }

  function Test-LocalTcpPort([int]$Port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
      $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
      if (-not $pending.AsyncWaitHandle.WaitOne(700)) { return $false }
      $client.EndConnect($pending)
      return $true
    } catch {
      return $false
    } finally {
      $client.Dispose()
    }
  }

  $env:npm_config_registry = 'https://registry.npmmirror.com'
  if (Test-LocalTcpPort 7897) {
    $ScriptProxy = 'http://127.0.0.1:7897'
    $env:HTTP_PROXY = $ScriptProxy
    $env:HTTPS_PROXY = $ScriptProxy
    $env:http_proxy = $ScriptProxy
    $env:https_proxy = $ScriptProxy
    $env:NO_PROXY = 'localhost,127.0.0.1'
    Add-Content -LiteralPath $LogPath -Value "Network: $ScriptProxy; registry: $env:npm_config_registry" -Encoding UTF8
  } else {
    Add-Content -LiteralPath $LogPath -Value "Network: system; registry: $env:npm_config_registry" -Encoding UTF8
  }
  $NodeVersion = (& $Node --version).Trim()
  Add-Content -LiteralPath $LogPath -Value "Node: $Node ($NodeVersion)" -Encoding UTF8

if (-not $EnvId) {
  $EnvId = Read-Host '请输入 CloudBase 上海环境 ID（例如 lhwiki-1gxxxxxx）'
}
if ([string]::IsNullOrWhiteSpace($EnvId)) { throw '环境 ID 不能为空' }

function Write-Step([string]$Message) {
  Write-Host "`n> $Message" -ForegroundColor Cyan
  Add-Content -LiteralPath $LogPath -Value "`n> $Message" -Encoding UTF8
}

function Invoke-Tcb {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [switch]$AllowAlreadyExists
  )
  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $captured = & $Pnpm '--package=@cloudbase/cli@latest' dlx tcb @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  $captured | ForEach-Object { Write-Host $_; Add-Content -LiteralPath $LogPath -Value $_ -Encoding UTF8 }
  if ($exitCode -ne 0) {
    $text = $captured -join "`n"
    if ($AllowAlreadyExists -and $text -match '(already exists|NamespaceExists|已存在)') { return }
    throw "CloudBase 命令失败：tcb $($Arguments -join ' ')"
  }
}

function Invoke-PnpmCommand {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $previousErrorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $captured = & $Pnpm @Arguments 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorPreference
  }
  $captured | ForEach-Object { Write-Host $_; Add-Content -LiteralPath $LogPath -Value $_ -Encoding UTF8 }
  if ($exitCode -ne 0) { throw "pnpm 命令失败：pnpm $($Arguments -join ' ')" }
}

Write-Host 'LHwiki：CloudBase 上海迁移部署' -ForegroundColor Green
Write-Host "项目目录：$ProjectDir"
Write-Host "环境 ID：$EnvId"

Push-Location $CloudBaseDir
try {
  Write-Step '检查 CloudBase CLI 版本'
  Invoke-Tcb -Arguments @('--version')

  if (-not $SkipLogin) {
    Write-Step '登入腾讯云 CloudBase'
    Invoke-Tcb -Arguments @('login')
  }

  Write-Step '绑定并确认目标环境'
  Invoke-Tcb -Arguments @('env', 'use', $EnvId)

  Write-Step '核对当前 CLI 的部署参数'
  Invoke-Tcb -Arguments @('db', 'nosql', 'execute', '--help')
  Invoke-Tcb -Arguments @('fn', 'deploy', '--help')
  Invoke-Tcb -Arguments @('hosting', 'deploy', '--help')
  Invoke-Tcb -Arguments @('permission', 'set', '--help')

  $cloudBaseApiKey = $env:CLOUDBASE_APIKEY
  if ([string]::IsNullOrWhiteSpace($cloudBaseApiKey)) {
    Write-Host "`nHTTP 云函数访问文档数据库需要 CloudBase 服务器 API Key。" -ForegroundColor Yellow
    Write-Host '请在 CloudBase 控制台的身份认证 / API Key 中创建专用于 lhwiki-api 的服务器密钥。' -ForegroundColor Yellow
    $secureApiKey = Read-Host '粘贴 API Key（输入不会显示）' -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureApiKey)
    try { $cloudBaseApiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
  if ([string]::IsNullOrWhiteSpace($cloudBaseApiKey)) { throw 'CloudBase API Key 不能为空' }

  $secretBytes = New-Object byte[] 48
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $random.GetBytes($secretBytes) } finally { $random.Dispose() }
  $sessionSecret = [Convert]::ToBase64String($secretBytes)

  $configObject = Get-Content -LiteralPath 'cloudbaserc.template.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $configObject.envId = $EnvId
  $configObject.functions[0] | Add-Member -NotePropertyName envVariables -NotePropertyValue ([pscustomobject]@{
    TCB_ENV = $EnvId
    SESSION_SECRET = $sessionSecret
    CLOUDBASE_APIKEY = $cloudBaseApiKey
  }) -Force
  $configObject | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath 'cloudbaserc.json' -Encoding UTF8

  Write-Step '创建文档数据库集合'
  foreach ($collection in @('users', 'sections', 'articles', 'submissions', 'review_events')) {
    $innerCommand = ConvertTo-Json -InputObject @{ create = $collection } -Compress
    $outerCommand = ConvertTo-Json -InputObject @(@{ TableName = $collection; CommandType = 'COMMAND'; Command = $innerCommand }) -Compress
    Invoke-Tcb -Arguments @('db', 'nosql', 'execute', '--command', $outerCommand, '--env-id', $EnvId) -AllowAlreadyExists
  }

  Write-Step '打包 HTTP 云函数运行依赖'
  Invoke-PnpmCommand -Arguments @('--dir', (Join-Path $CloudBaseDir 'functions\lhwiki-api'), 'install', '--prod', '--no-frozen-lockfile')

  Write-Step '预览 LHwiki HTTP API 云函数部署'
  Invoke-Tcb -Arguments @('fn', 'deploy', 'lhwiki-api', '--httpFn', '--path', '/api', '--dry-run', '--env-id', $EnvId)

  Write-Step '部署 LHwiki HTTP API 云函数'
  Invoke-Tcb -Arguments @('fn', 'deploy', 'lhwiki-api', '--httpFn', '--path', '/api', '--force', '--yes', '--env-id', $EnvId)

  Write-Step '开放函数的公开调用权限（业务写操作仍需站内登入）'
  Invoke-Tcb -Arguments @('permission', 'set', 'function', '--level', 'custom', '--rule', '{"*":{"invoke":"true"}}', '--yes', '--env-id', $EnvId)

  Write-Step '部署静态前端'
  Push-Location (Join-Path $ProjectDir 'public')
  try {
    Invoke-Tcb -Arguments @('hosting', 'detail', '--env-id', $EnvId)
    Invoke-Tcb -Arguments @('hosting', 'deploy', '.', '--env-id', $EnvId, '--yes')
  } finally {
    Pop-Location
  }

  Write-Step '核验云函数、权限和静态文件'
  Invoke-Tcb -Arguments @('fn', 'detail', 'lhwiki-api', '--env-id', $EnvId)
  Invoke-Tcb -Arguments @('permission', 'get', 'function', '--env-id', $EnvId)
  Invoke-Tcb -Arguments @('hosting', 'list', '--env-id', $EnvId)

  Remove-Item -LiteralPath 'cloudbaserc.json' -Force
  $cloudBaseApiKey = $null
  $sessionSecret = $null

  Write-Host "`n部署完成。下一步请按《备案与域名接入.md》绑定备案域名。" -ForegroundColor Green
  Write-Host '绑定后先访问：https://你的域名/api/health'
  Write-Host "完整日志：$LogPath"
} finally {
  Pop-Location
}
} catch {
  $generatedConfig = Join-Path $CloudBaseDir 'cloudbaserc.json'
  if (Test-Path -LiteralPath $generatedConfig) { Remove-Item -LiteralPath $generatedConfig -Force }
  $details = ($_ | Out-String).Trim()
  Add-Content -LiteralPath $LogPath -Value "`n[FATAL]`n$details" -Encoding UTF8
  Write-Host "`n部署未完成：" -ForegroundColor Red
  Write-Host $details -ForegroundColor Red
  Write-Host "`n错误已经写入：$LogPath" -ForegroundColor Yellow
  Write-Host '此窗口会保持打开；请把上面的红字或 deployment.log 发给 Codex。' -ForegroundColor Yellow
  $global:LASTEXITCODE = 1
  return
}
