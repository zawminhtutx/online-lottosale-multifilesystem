@echo off
title Online Lotto Print Agent
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js is not installed. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node server.mjs
pause
