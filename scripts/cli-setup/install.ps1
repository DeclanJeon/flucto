#requires -Version 5.1
<#
.SYNOPSIS
  One-shot user-scope Flucto CLI installer for Windows.

.DESCRIPTION
  Installs a private Node.js 24 LTS runtime (downloaded from nodejs.org and
  verified against its official SHASUMS256.txt) directly into the install
  prefix, installs the bundled Flucto npm tarball under that prefix, registers
  the user PATH without admin rights, and runs `flucto setup` + `flucto doctor`
  to provision yt-dlp and FFmpeg into a prefix-private bin directory. No system
  Node.js or npm is required.

.PARAMETER InstallDir
  Installation prefix (default: %LOCALAPPDATA%\Flucto\cli).

.PARAMETER NoProfile
  Skip user PATH registration; usable for isolated CI smoke tests.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -InstallDir D:\tools\flucto -NoProfile
#>
[CmdletBinding()]
param(
    [string]$InstallDir,
    [switch]$NoProfile
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Info([string]$Message) { Write-Host "[flucto] $Message" }
function Fail([string]$Message) {
    Write-Host "[flucto] ERROR: $Message" -ForegroundColor Red
    exit 1
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$tarball = Get-ChildItem -Path $scriptDir -Filter '*.tgz' | Select-Object -First 1
if (-not $tarball) { Fail "No npm package tarball (*.tgz) found next to install.ps1 - this archive is incomplete." }

if (-not $InstallDir) {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = Join-Path $env:USERPROFILE 'AppData\Local' }
    $InstallDir = Join-Path $base 'Flucto\cli'
}
$InstallDir = [System.IO.Path]::GetFullPath($InstallDir)
# Node extracts straight into the prefix: InstallDir\node.exe + InstallDir\node_modules.
$nodeDir = $InstallDir
$nodeExe = Join-Path $InstallDir 'node.exe'
$binDir = Join-Path $InstallDir 'bin'
$markerPath = Join-Path $InstallDir 'flucto-cli-install.json'

# Only x64 and ARM64 Windows hosts are supported.
$hostArch = $env:PROCESSOR_ARCHITEW6432
if (-not $hostArch) { $hostArch = $env:PROCESSOR_ARCHITECTURE }
$nodeArch = switch -Regex ($hostArch) {
    'ARM64' { 'arm64'; break }
    'AMD64' { 'x64'; break }
    default { Fail "Unsupported CPU architecture '$hostArch' - Flucto CLI requires x64 or ARM64." }
}

Write-Info "Installing Flucto CLI into $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

# --- Private Node.js 24 LTS runtime ------------------------------------------
if (Test-Path $nodeExe) {
    Write-Info "Private Node.js already present: $(& $nodeExe --version)"
} else {
    $indexUrl = 'https://nodejs.org/dist/latest-v24.x/'
    Write-Info "Resolving Node.js 24 LTS from $indexUrl"
    $shasums = (Invoke-WebRequest -Uri "${indexUrl}SHASUMS256.txt" -UseBasicParsing).Content
    $line = $shasums -split "`n" | Where-Object { $_ -match [regex]::Escape("-win-$nodeArch.zip") } | Select-Object -First 1
    if (-not $line) { Fail "No win-$nodeArch zip listed in $indexUrl SHASUMS256.txt" }
    if ($line -match '^([0-9a-fA-F]{64})\s+(.+)$') {
        $expectedHash = $Matches[1].ToLower()
        $fileName = $Matches[2].Trim()
    } else {
        Fail "Could not parse SHASUMS256.txt entry: $line"
    }
    if ($fileName -notlike "node-v24.*-win-$nodeArch.zip") { Fail "Unexpected Node artifact name: $fileName" }

    $downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) ("flucto-node-" + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null
    try {
        $zipPath = Join-Path $downloadDir $fileName
        Write-Info "Downloading $fileName"
        Invoke-WebRequest -Uri "$indexUrl$fileName" -OutFile $zipPath -UseBasicParsing
        $actualHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $expectedHash) {
            Fail "SHA256 mismatch for $fileName (expected $expectedHash, got $actualHash) - download aborted."
        }
        Write-Info "Checksum verified; extracting private runtime into $InstallDir"
        $stage = Join-Path $downloadDir 'extract'
        Expand-Archive -Path $zipPath -DestinationPath $stage -Force
        $unpacked = Get-ChildItem -Path $stage -Directory | Select-Object -First 1
        if (-not $unpacked) { Fail "Node archive did not contain a top-level directory" }
        Copy-Item -Path (Join-Path $unpacked.FullName '*') -Destination $InstallDir -Recurse -Force
    } finally {
        Remove-Item -Recurse -Force $downloadDir -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path $nodeExe)) { Fail "Node.js extraction failed - node.exe not found under $InstallDir." }
    Write-Info "Installed private Node.js $(& $nodeExe --version)"
}

$npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path $npmCli)) { Fail "npm CLI missing from private Node runtime: $npmCli" }

# --- Flucto CLI under the same user prefix ------------------------------------
Write-Info "Installing $($tarball.Name) with the private npm"
& $nodeExe $npmCli install -g --prefix $InstallDir --loglevel warn $tarball.FullName
if ($LASTEXITCODE -ne 0) { Fail "npm install of $($tarball.Name) failed (exit $LASTEXITCODE)." }
# The CMD launchers work in restricted PowerShell without changing execution policy.
Remove-Item -LiteralPath (Join-Path $InstallDir 'flucto.ps1'), (Join-Path $InstallDir 'fl.ps1') -Force -ErrorAction SilentlyContinue

$flucto = Join-Path $InstallDir 'flucto.cmd'
if (-not (Test-Path $flucto)) { Fail "npm install did not produce $flucto" }

$marker = @{
    fluctoCliPrivateInstall = $true
    version                 = $tarball.Name -replace '\.tgz$', '' -replace '^flucto-', ''
    prefix                  = $InstallDir
    binDir                  = $binDir
    nodeDir                 = $nodeDir
    platform                = 'win32'
    installedAt             = (Get-Date).ToUniversalTime().ToString('o')
}
$marker | ConvertTo-Json | Set-Content -Path $markerPath -Encoding UTF8

# --- User-scope PATH (no admin) -----------------------------------------------
$env:PATH = "$InstallDir;$binDir;$env:PATH"
$env:FLUCTO_BIN_DIR = $binDir
if (-not $NoProfile) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    foreach ($entry in @($InstallDir, $binDir)) {
        if (($userPath -split ';') -notcontains $entry) {
            $userPath = if ($userPath) { "$entry;$userPath" } else { $entry }
        }
    }
    [Environment]::SetEnvironmentVariable('Path', $userPath, 'User')
    Write-Info "Registered user PATH entries: $InstallDir, $binDir"
} else {
    Write-Info "NoProfile set - user PATH, profile and existing bin dirs left untouched."
}

# --- Provision and verify media binaries (prefix-private bin dir) -------------
Write-Info 'Provisioning yt-dlp and FFmpeg (flucto setup)'
& $flucto setup
if ($LASTEXITCODE -ne 0) { Fail "flucto setup failed (exit $LASTEXITCODE) - binaries were not provisioned." }

Write-Info 'Verifying install (flucto doctor --json)'
& $flucto doctor --json
if ($LASTEXITCODE -ne 0) { Fail "flucto doctor reported an unhealthy install (exit $LASTEXITCODE)." }

Write-Info "Done. Installed command: $flucto"
if (-not $NoProfile) {
    Write-Info 'Open a new terminal (or refresh PATH) and run: flucto doctor'
} else {
    Write-Info "For this shell only: `$env:PATH = `"$InstallDir;$binDir;`$env:PATH`""
}
