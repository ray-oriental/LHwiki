@echo off
setlocal
title LHwiki CloudBase Deployment
cd /d "%~dp0"
if not exist "%~dp0deploy-cloudbase.ps1" (
  echo [ERROR] deploy-cloudbase.ps1 was not found.
  echo Extract the whole ZIP first, then run this file from the cloudbase folder.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0deploy-cloudbase.ps1"
set "DEPLOY_EXIT=%ERRORLEVEL%"
echo.
echo Deployment process exit code: %DEPLOY_EXIT%
echo Check the output above and deployment.log.
pause
exit /b %DEPLOY_EXIT%
