# Nudgling installer for Windows. Run in PowerShell:
#   irm https://raw.githubusercontent.com/Samirius/body-double/main/install.ps1 | iex
# or, from a copy of this repo:  powershell -ExecutionPolicy Bypass -File install.ps1
#
# It installs Node.js LTS with winget if needed, puts Nudgling in
# %LOCALAPPDATA%\Nudgling, installs it, downloads the local models (~3 GB,
# SHA-256 checked), adds the Startup + Desktop shortcuts and starts it.
# Run it again to update. Uninstall: node scripts/autostart.mjs --remove, then delete the folder.
param(
  [string]$Dir = (Join-Path $env:LOCALAPPDATA 'Nudgling'),
  [string]$Source = 'https://github.com/Samirius/body-double.git',
  [switch]$SkipModels,   # install without the local models (it still works, with templates)
  [switch]$NoAutostart,
  [switch]$NoLaunch
)
$ErrorActionPreference = 'Stop'
function Say($m) { Write-Host "  > $m" -ForegroundColor Cyan }
function Has($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Write-Host "`n  NUDGLING // the body double that speaks first`n" -ForegroundColor Magenta

# 1. Node.js 22+
$major = 0
if (Has node) { $major = [int]((node -v) -replace '^v(\d+).*', '$1') }
if ($major -lt 22) {
  if (-not (Has winget)) { throw 'Node.js 22+ is needed. Install it from https://nodejs.org, then run this again.' }
  Say 'Installing Node.js LTS (winget)...'
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements | Out-Null
  RefreshPath
  if (-not (Has node)) { throw 'Node.js was installed but is not on PATH yet. Open a new PowerShell window and run this again.' }
}
Say "Node $(node -v)"

# 2. The code (git if available, otherwise the GitHub zip)
if (Test-Path (Join-Path $Dir '.git')) {
  Say "Updating $Dir"
  git -C $Dir pull --ff-only
} elseif (Has git) {
  Say "Downloading to $Dir"
  git clone --depth 1 $Source $Dir
} else {
  Say "Downloading to $Dir (zip)"
  $zip = Join-Path $env:TEMP 'nudgling.zip'
  Invoke-WebRequest ($Source -replace '\.git$', '/archive/refs/heads/main.zip') -OutFile $zip
  $tmp = Join-Path $env:TEMP 'nudgling-unzip'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  Expand-Archive $zip $tmp
  New-Item -ItemType Directory -Force $Dir | Out-Null
  Copy-Item (Join-Path (Get-ChildItem $tmp | Select-Object -First 1).FullName '*') $Dir -Recurse -Force
}
Set-Location $Dir

# 3. Install
Say 'Installing (npm)...'
npm ci --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw 'npm install failed (see above).' }

# 4. Local models (decisions + Meta Llama), checked against pinned hashes
if (-not $SkipModels) {
  Say 'Downloading local models (~3 GB, once)...'
  node scripts/setup-models.mjs
  if ($LASTEXITCODE -ne 0) { Write-Warning 'Model download failed; Nudgling still works with built-in messages. Run: npm run setup:models' }
}

# 5. Start with Windows + Desktop icon
if (-not $NoAutostart) { node scripts/autostart.mjs }

# 6. Start it
if (-not $NoLaunch) {
  Say 'Starting Nudgling...'
  Start-Process -FilePath (Join-Path $Dir 'node_modules\electron\dist\electron.exe') -ArgumentList "`"$(Join-Path $Dir 'src\pet\main.js')`"" -WorkingDirectory $Dir
}

Write-Host "`n  Done. The creature lives at the bottom of your screen; click it." -ForegroundColor Green
Write-Host "  Connect your AI agents: node `"$Dir\bin\nudgling.mjs`" connect all`n" -ForegroundColor Green
