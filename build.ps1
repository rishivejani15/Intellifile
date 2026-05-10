Write-Host "Building IntelliFile..." -ForegroundColor Cyan

# 0. Clean up old builds to save space
Write-Host "0. Cleaning old build artifacts..." -ForegroundColor Yellow
if (Test-Path "backend/dist") { Remove-Item -Recurse -Force "backend/dist" }
if (Test-Path "backend/build") { Remove-Item -Recurse -Force "backend/build" }
if (Test-Path "backend-dist") { Remove-Item -Recurse -Force "backend-dist" }
if (Test-Path "frontend/dist") { Remove-Item -Recurse -Force "frontend/dist" }
if (Test-Path "frontend/build") { Remove-Item -Recurse -Force "frontend/build" }
if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }

# 1. PyInstaller Freeze
Write-Host "1. Freezing Python Backend (with UPX compression)..." -ForegroundColor Yellow
Set-Location -Path backend
if (Test-Path ".venv\Scripts\pip.exe") {
	.venv\Scripts\pip.exe install -r requirements.txt
	if ($LASTEXITCODE -ne 0) { Write-Host "Failed to install backend requirements" -ForegroundColor Red; exit $LASTEXITCODE }
}
.venv\Scripts\pyinstaller --clean intellifile_engine.spec
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build engine" -ForegroundColor Red; exit $LASTEXITCODE }

# Move dist folders to expected location
New-Item -ItemType Directory -Force -Path "../backend-dist" | Out-Null
Move-Item -Path "dist/engine" -Destination "../backend-dist/engine"
Set-Location -Path ..

# 2. React Build
Write-Host "2. Building React Frontend..." -ForegroundColor Yellow
Set-Location -Path frontend
npm install
$env:GENERATE_SOURCEMAP = "false"
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to build React app" -ForegroundColor Red; exit $LASTEXITCODE }
$env:GENERATE_SOURCEMAP = $null

# 3. Electron Builder
Write-Host "3. Creating Installer with electron-builder..." -ForegroundColor Yellow
npx --yes electron-builder@25.1.8 --win
if ($LASTEXITCODE -ne 0) { Write-Host "Failed to package Electron app" -ForegroundColor Red; exit $LASTEXITCODE }

# 3.5 Remove devDependencies after packaging to clean up workspace
Write-Host "3.5 Removing devDependencies..." -ForegroundColor Yellow
npm prune --omit=dev 2>&1 | Out-Null

Write-Host "Build complete! Installer is in the /dist folder." -ForegroundColor Green
$distSize = [math]::Round((Get-ChildItem -Path "../dist" -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum | Select-Object -ExpandProperty Sum) / 1MB, 2)
Write-Host "Final installer size: $distSize MB" -ForegroundColor Cyan
Set-Location -Path ..
