[CmdletBinding()]
param(
  [string]$DatabaseName = 'campus-notes-db'
)

$ErrorActionPreference = 'Stop'
$CloudBaseDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $CloudBaseDir
$Pnpm = (Get-Command pnpm.cmd -ErrorAction SilentlyContinue).Source
if (-not $Pnpm) { $Pnpm = (Get-Command pnpm -ErrorAction SilentlyContinue).Source }
if (-not $Pnpm) { throw '没有找到 pnpm' }
$Node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $Node) { throw '没有找到 Node.js 20+' }

$ExportPath = Join-Path $CloudBaseDir 'd1-export.private.sql'
Push-Location $ProjectDir
try {
  & $Pnpm exec wrangler d1 export $DatabaseName --remote --output $ExportPath
  if ($LASTEXITCODE -ne 0) { throw 'D1 导出失败' }
  & $Node (Join-Path $CloudBaseDir 'tools\convert-d1-export.mjs') $ExportPath
  if ($LASTEXITCODE -ne 0) { throw 'D1 转换失败' }
  Write-Host '转换完成。请立即运行 CloudBase 部署脚本；私有迁移文件不会进入 Git。' -ForegroundColor Green
} finally {
  Pop-Location
}
