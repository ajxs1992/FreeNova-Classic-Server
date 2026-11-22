@echo off
cd /d "C:\Users\conts\Desktop\.,\FREENOVA System\web-panel"
echo Starting local FreeNova panel (SQLite next to HLDS, HTTP 8080, no Cloudflare)...
node server_local.mjs
pause
