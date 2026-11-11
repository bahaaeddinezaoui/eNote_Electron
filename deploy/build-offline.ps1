# ==============================================================================
# deploy/build-offline.ps1
# Builds the eNote client distribution (Installer + Portable) for Offline LAN
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " Building eNote Desktop Client for Offline LAN" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan

# 1. Verify build prerequisites
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

$fontDir = Join-Path $projectRoot "build\fonts"
if (-not (Test-Path $fontDir)) {
    Write-Error "build\fonts directory not found. Fonts must be present for offline typography."
    exit 1
}

$fontCount = (Get-ChildItem $fontDir -Filter "*.woff2").Count
Write-Host "[OK] Found $fontCount bundled offline font files in build\fonts." -ForegroundColor Green

# 2. Build Vite bundle
Write-Host "`n[Step 1/2] Compiling application with electron-vite..." -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Error "Vite build failed."
    exit $LASTEXITCODE
}

# 3. Package with electron-builder
Write-Host "`n[Step 2/2] Packaging Windows binaries (NSIS + Portable)..." -ForegroundColor Cyan
npx electron-builder --win --x64
if ($LASTEXITCODE -ne 0) {
    Write-Error "electron-builder failed."
    exit $LASTEXITCODE
}

Write-Host "`n=============================================" -ForegroundColor Cyan
Write-Host " Build Finished Successfully!                " -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan

$distDir = Join-Path $projectRoot "dist"
if (Test-Path $distDir) {
    Write-Host "Generated artifacts in dist\:" -ForegroundColor Yellow
    Get-ChildItem -Path $distDir -File | Where-Object { $_.Extension -in @(".exe", ".blockmap") } | ForEach-Object {
        $sizeMb = [Math]::Round($_.Length / 1MB, 2)
        Write-Host "  - $($_.Name) ($sizeMb MB)" -ForegroundColor White
    }
}
Write-Host "`nDistribute these files to client workstations along with deploy\client\deployment.json.example" -ForegroundColor Green

