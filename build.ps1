Write-Host "Building IntelliFile..." -ForegroundColor Cyan

# 1. PyInstaller Freeze
Write-Host "1. Freezing Python Backend..." -ForegroundColor Yellow
Set-Location -Path backend
.venv\Scripts\pyinstaller --clean intellifile_engine.spec
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build engine" -ForegroundColor Red; exit $LASTEXITCODE }

.venv\Scripts\pyinstaller --clean intellifile_setup.spec
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build setup" -ForegroundColor Red; exit $LASTEXITCODE }

# Move dist folders to expected location
if (Test-Path "../backend-dist") { Remove-Item -Recurse -Force "../backend-dist" }
New-Item -ItemType Directory -Force -Path "../backend-dist" | Out-Null
Move-Item -Path "dist/engine" -Destination "../backend-dist/engine"
Move-Item -Path "dist/setup" -Destination "../backend-dist/setup"
Set-Location -Path ..

# 2. React Build
Write-Host "2. Building React Frontend..." -ForegroundColor Yellow
Set-Location -Path frontend
npm install
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build React app" -ForegroundColor Red; exit $LASTEXITCODE }

# 3. Electron Builder
Write-Host "3. Creating Installer with electron-builder..." -ForegroundColor Yellow
npm run dist
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to package Electron app" -ForegroundColor Red; exit $LASTEXITCODE }

Write-Host "Build complete! Installer is in the /dist folder." -ForegroundColor Green
Set-Location -Path ..
