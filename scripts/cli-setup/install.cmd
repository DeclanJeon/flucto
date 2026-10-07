@echo off
rem One-shot Flucto CLI bootstrap for Windows — delegates to install.ps1.
rem Usage: install.cmd [-InstallDir PATH] [-NoProfile]
setlocal
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install.ps1" %*
exit /b %ERRORLEVEL%
