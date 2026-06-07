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
$shortTempRoot = "C:\t"
$shortInstallTemp = Join-Path $shortTempRoot "pip-temp"
$shortCache = Join-Path $shortTempRoot "pip-cache"
if (!(Test-Path $shortTempRoot)) {
	New-Item -ItemType Directory -Force -Path $shortTempRoot | Out-Null
}
if (!(Test-Path $shortInstallTemp)) {
	New-Item -ItemType Directory -Force -Path $shortInstallTemp | Out-Null
}
if (!(Test-Path $shortCache)) {
	New-Item -ItemType Directory -Force -Path $shortCache | Out-Null
}
$originalTemp = $env:TEMP
$originalTmp = $env:TMP
$originalPipCache = $env:PIP_CACHE_DIR
$substDrive = "Z:"
$substCreated = $false

if ((Get-PSDrive -Name Z -ErrorAction SilentlyContinue) -ne $null) {
	subst Z: /D | Out-Null
}
subst $substDrive $shortInstallTemp | Out-Null
$substCreated = $true
$env:TEMP = "Z:\"
$env:TMP = "Z:\"
$env:PIP_CACHE_DIR = $shortCache

try {
	if (Test-Path "..\venv\Scripts\python.exe") {
		& "..\venv\Scripts\python.exe" -m pip install -r requirements.txt
		if ($LASTEXITCODE -ne 0) { Write-Host "Failed to install backend requirements" -ForegroundColor Red; exit $LASTEXITCODE }
		& "..\venv\Scripts\python.exe" -m pip install pyinstaller
		if ($LASTEXITCODE -ne 0) { Write-Host "Failed to install PyInstaller" -ForegroundColor Red; exit $LASTEXITCODE }
		& "..\venv\Scripts\python.exe" -m PyInstaller --clean intellifile_engine.spec
		$pyinstallerExit = $LASTEXITCODE
		if ($pyinstallerExit -ne 0) { Write-Host "Failed to build engine" -ForegroundColor Red; exit $pyinstallerExit }
	} else {
		Write-Host "Python executable not found in ..\venv\Scripts" -ForegroundColor Red
		exit 1
	}
} finally {
	if ($substCreated -and (Get-PSDrive -Name Z -ErrorAction SilentlyContinue) -ne $null) {
		subst $substDrive /D | Out-Null
	}
	if ($null -ne $originalTemp) { $env:TEMP = $originalTemp } else { Remove-Item Env:\TEMP -ErrorAction SilentlyContinue }
	if ($null -ne $originalTmp) { $env:TMP = $originalTmp } else { Remove-Item Env:\TMP -ErrorAction SilentlyContinue }
	if ($null -ne $originalPipCache) { $env:PIP_CACHE_DIR = $originalPipCache } else { Remove-Item Env:\PIP_CACHE_DIR -ErrorAction SilentlyContinue }
}

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
