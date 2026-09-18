@echo off
rem Makes your running Fragline server (npm start) reachable from anywhere through a free Cloudflare
rem quick tunnel. Send friends the https://....trycloudflare.com link printed below.
rem The link changes every time you run this. Close this window to stop sharing.
set CF=%ProgramFiles(x86)%\cloudflared\cloudflared.exe
if not exist "%CF%" set CF=cloudflared
echo Starting tunnel to http://localhost:3000 ... look for the trycloudflare.com link below.
"%CF%" tunnel --no-autoupdate --url http://localhost:3000
pause
