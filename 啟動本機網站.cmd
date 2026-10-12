@echo off
chcp 65001 >nul
title 多益練習 APP - 本機網站
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 找不到 Node.js，請先安裝 Node.js，再重新開啟此檔案。
  pause
  exit /b 1
)
node scripts/start-local.mjs
if errorlevel 1 pause
