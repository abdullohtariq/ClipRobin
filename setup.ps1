$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$processPathEntries = @($env:PATH -split ";" | Where-Object { $_ })
foreach ($entry in ($userPath -split ";")) {
    if ($entry -and $processPathEntries -notcontains $entry) {
        $env:PATH = "$entry;$env:PATH"
        $processPathEntries += $entry
    }
}

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$pythonPath = if ($pythonCommand -and $pythonCommand.Source -notlike "*\Microsoft\WindowsApps\*") {
    $pythonCommand.Source
} else {
    $null
}

if (-not $pythonPath) {
    $python312 = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
    if (Test-Path $python312) {
        $pythonPath = $python312
    }
}

if (-not $pythonPath) {
    throw "Python 3.10 or newer is required. Install Python and enable its PATH option, then rerun .\setup.ps1."
}

& $pythonPath -c "import sys; print('Python', sys.version.split()[0]); raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"
if ($LASTEXITCODE -ne 0) {
    throw "Python 3.10 or newer is required."
}

$nodeCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
$npmPath = if ($nodeCommand) { $nodeCommand.Source } else { $null }
if (-not $npmPath) {
    $nodeNpm = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
    if (Test-Path $nodeNpm) {
        $npmPath = $nodeNpm
        $env:PATH = "$(Split-Path $nodeNpm);$env:PATH"
    }
}

if (-not $npmPath) {
    $nodeNpm = Join-Path $env:LOCALAPPDATA "Programs\nodejs\npm.cmd"
    if (Test-Path $nodeNpm) {
        $npmPath = $nodeNpm
        $env:PATH = "$(Split-Path $nodeNpm);$env:PATH"
    }
}

if (-not $npmPath) {
    throw "Node.js 20.9 or newer is required. Install Node.js and enable its PATH option, then rerun .\setup.ps1."
}

$nodeVersion = (& node --version).Trim().TrimStart("v")
if ($LASTEXITCODE -ne 0) {
    throw "Node.js could not be started. Check that Node.js is installed and available on PATH."
}
if ([version]$nodeVersion -lt [version]"20.9") {
    throw "Node.js 20.9 or newer is required. Found $nodeVersion."
}
Write-Host "Node.js $nodeVersion"

$venvPython = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    & $pythonPath -m venv (Join-Path $root ".venv")
    if ($LASTEXITCODE -ne 0) {
        throw "Creating the Python virtual environment failed with exit code $LASTEXITCODE."
    }
}

& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "Upgrading pip failed with exit code $LASTEXITCODE."
}

& $venvPython -m pip install -r (Join-Path $root "requirements\backend.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Installing backend requirements failed with exit code $LASTEXITCODE."
}

Push-Location (Join-Path $root "frontend")
try {
    & $npmPath ci
    if ($LASTEXITCODE -ne 0) {
        throw "Installing frontend dependencies failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "FFmpeg was not found on PATH. Install FFmpeg before generating clips."
}

Write-Host "Setup complete. See README.md for starting the backend and frontend."
