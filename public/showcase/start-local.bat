@echo off
cd /d %~dp0
echo Membuka VRINTEX Family UI di http://localhost:8080
start http://localhost:8080
python -m http.server 8080
pause
