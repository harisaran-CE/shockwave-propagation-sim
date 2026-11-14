@echo off
rem Starts a small local web server for the Flowline browser app so 3D mode works.
rem Keep this window open while you use the app; close it to stop the server.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python from python.org, then run this file again.
  pause
  exit /b 1
)

cd /d "%~dp0browser_app"
echo Flowline is starting at http://localhost:8000/index.html
echo Keep this window open while you use the app.
start "" "http://localhost:8000/index.html"
python -m http.server 8000 --bind 127.0.0.1
