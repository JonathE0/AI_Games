@echo off
rem Opens Fragline in Chrome (or Edge) with the browser's frame-rate cap and V-Sync turned off,
rem like Krunker's "unlimited FPS" launchers. Uses its own browser profile so the flags always apply.
rem Start the server first (npm start). Pass a different address as an argument if needed.
set URL=%~1
if "%URL%"=="" set URL=http://localhost:3000
set FLAGS=--disable-frame-rate-limit --disable-gpu-vsync --new-window
set B=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not exist "%B%" set B=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not exist "%B%" set B=%LocalAppData%\Google\Chrome\Application\chrome.exe
if not exist "%B%" set B=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe
if not exist "%B%" (echo Could not find Chrome or Edge. & pause & exit /b 1)
start "" "%B%" --user-data-dir="%LocalAppData%\FraglineBrowser" %FLAGS% %URL%
