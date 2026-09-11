[CmdletBinding()]
param(
  [string]$EnvId = 'lhwiki-d9g6r8vfzc7be1c0a'
)

$ErrorActionPreference = 'Stop'
$ExpectedEnvId = 'lhwiki-d9g6r8vfzc7be1c0a'
if ($EnvId -ne $ExpectedEnvId) {
  throw "拒绝为非生产环境准备发布包：$EnvId"
}

$CloudBaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $CloudBaseDir
$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) { $Node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $Node) {
  $BundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $BundledNode) { $Node = $BundledNode }
}
if (-not $Node) { throw '没有找到 Node.js 20+，无法运行测试和构建发布包。' }

$conflicts = Get-ChildItem -LiteralPath $ProjectDir -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match 'sync-conflict|\.sync-conflict-' }
if ($conflicts) { throw '检测到 Syncthing 冲突文件，停止准备发布包。' }

Push-Location $ProjectDir
try {
  & $Node '.\scripts\run-tests.mjs'
  if ($LASTEXITCODE -ne 0) { throw '测试失败，停止准备发布包。' }
  & $Node '.\scripts\build-cloudbase-function.mjs'
  if ($LASTEXITCODE -ne 0) { throw '生产函数白名单打包失败。' }
} finally {
  Pop-Location
}

$FunctionRoot = Join-Path $ProjectDir 'release\cloudbase-functions'
$StaticRoot = Join-Path $ProjectDir 'public'
Write-Host '生产候选已准备完成；本脚本不会连接或修改线上资源。' -ForegroundColor Green
Write-Host "CloudBase EnvId：$ExpectedEnvId"
Write-Host "函数 functionRootPath：$FunctionRoot"
Write-Host "静态文件目录：$StaticRoot"
Write-Host '实际发布前仍须核验 Syncthing idle、备份、测试结果和当前生产版本；只部署发生变化的组件。'
