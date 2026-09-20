Set-Location $PSScriptRoot
Write-Host "VRINTEX Family UI: http://localhost:8080" -ForegroundColor Cyan
Start-Process "http://localhost:8080"
python -m http.server 8080
