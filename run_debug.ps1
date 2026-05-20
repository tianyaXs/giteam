$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DesktopDir = Join-Path $ScriptDir "apps\desktop"
$CliDir = Join-Path $ScriptDir "apps\cli"
$DistDir = Join-Path $DesktopDir "dist-web"
$GiteamExe = Join-Path $CliDir "target\release\giteam.exe"
$VcVarsPath = $null

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ""
    Write-Host "=== $Message ==="
    & $Action
}

function Find-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required command not found: $Name"
    }
    return $command.Source
}

function Add-ToPathIfExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathEntry
    )

    if (-not (Test-Path $PathEntry)) {
        return
    }

    $pathParts = $env:Path -split ";"
    if ($pathParts -notcontains $PathEntry) {
        $env:Path = "$PathEntry;$env:Path"
    }
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = @($machinePath, $userPath) -join ";"

    Add-ToPathIfExists (Join-Path $env:USERPROFILE ".cargo\bin")
}

function Ensure-WindowsUserEnv {
    if (-not $env:USERPROFILE) {
        $homeDrive = [Environment]::GetEnvironmentVariable("HOMEDRIVE", "Process")
        $homePath = [Environment]::GetEnvironmentVariable("HOMEPATH", "Process")
        if ($homeDrive -and $homePath) {
            $env:USERPROFILE = "$homeDrive$homePath"
        }
    }

    if (-not $env:APPDATA -and $env:USERPROFILE) {
        $env:APPDATA = Join-Path $env:USERPROFILE "AppData\Roaming"
    }

    if (-not $env:LOCALAPPDATA -and $env:USERPROFILE) {
        $env:LOCALAPPDATA = Join-Path $env:USERPROFILE "AppData\Local"
    }

    if (-not $env:HOME -and $env:USERPROFILE) {
        $env:HOME = $env:USERPROFILE
    }
}

function Ensure-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$DisplayName,
        [scriptblock]$Installer
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    if (-not $Installer) {
        throw "Required command not found: $DisplayName"
    }

    Write-Host ""
    Write-Host "=== Installing missing dependency: $DisplayName ==="
    & $Installer
    Refresh-ProcessPath

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Installed $DisplayName, but the command is still unavailable in the current session."
    }

    return $command.Source
}

function Install-RustToolchain {
    $rustup = Get-Command "rustup.exe" -ErrorAction SilentlyContinue

    if (-not $rustup) {
        $choco = Get-Command "choco.exe" -ErrorAction SilentlyContinue
        if ($choco) {
            & $choco.Source install rustup.install -y
        }
        else {
            $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
            if (-not $winget) {
                throw "Neither choco nor winget is available to install Rust."
            }
            & $winget.Source install --id Rustlang.Rustup -e --accept-package-agreements --accept-source-agreements --silent
        }

        Refresh-ProcessPath
        $rustup = Get-Command "rustup.exe" -ErrorAction SilentlyContinue
        if (-not $rustup) {
            throw "rustup installation finished, but rustup.exe is still unavailable."
        }
    }

    & $rustup.Source toolchain install stable
    & $rustup.Source default stable
}

function Find-VcVars {
    $candidates = @(
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat",
        "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Ensure-WindowsCppToolchain {
    $vcVars = Find-VcVars
    if ($vcVars) {
        return $vcVars
    }

    $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Visual Studio Build Tools are required, and winget is unavailable to install them."
    }

    Write-Host ""
    Write-Host "=== Installing missing dependency: Visual Studio Build Tools ==="
    & $winget.Source install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --silent --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

    $vcVars = Find-VcVars
    if (-not $vcVars) {
        throw "Visual Studio Build Tools installation finished, but vcvars64.bat is still unavailable."
    }

    return $vcVars
}

function Invoke-CargoBuildRelease {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CliDirectory,
        [Parameter(Mandatory = $true)]
        [string]$ToolchainCargo,
        [Parameter(Mandatory = $true)]
        [string]$VcVarsFile
    )

    $toolchainBin = Split-Path -Parent $ToolchainCargo
    $cmd = ('""{0}" >nul && set "PATH={1};%PATH%" && "{2}" build --release"' -f $VcVarsFile, $toolchainBin, $ToolchainCargo)
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/d", "/s", "/c", $cmd -WorkingDirectory $CliDirectory -Wait -PassThru -NoNewWindow
    if ($process.ExitCode -ne 0) {
        throw "cargo build --release failed with exit code $($process.ExitCode)"
    }
}

function Stop-ProcessOnPort {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique

    foreach ($processId in $connections) {
        if ($processId -and $processId -ne $PID) {
            Write-Host "Killing process on port $Port (PID: $processId)"
            Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Wait-HttpReady {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSeconds = 20
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $resp = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 3 -UseBasicParsing
            if ($resp.StatusCode -ge 200) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    } while ((Get-Date) -lt $deadline)

    throw "Timed out waiting for $Url"
}

Refresh-ProcessPath
Ensure-WindowsUserEnv

$npm = Ensure-Command -Name "npm.cmd" -DisplayName "npm"
$cargo = Ensure-Command -Name "cargo.exe" -DisplayName "cargo" -Installer { Install-RustToolchain }
$VcVarsPath = Ensure-WindowsCppToolchain
$backendProcess = $null
$BackendLog = Join-Path $ScriptDir "giteam-web.stdout.log"
$BackendErrLog = Join-Path $ScriptDir "giteam-web.stderr.log"

Invoke-Step "Killing remaining process on port 5100" {
    Stop-ProcessOnPort -Port 5100
}

Invoke-Step "Killing stale giteam processes" {
    Get-Process giteam -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

Invoke-Step "Installing frontend dependencies" {
    Push-Location $DesktopDir
    try {
        & $npm install
    }
    finally {
        Pop-Location
    }
}

Invoke-Step "Building web frontend (fallback for giteam)" {
    Push-Location $DesktopDir
    try {
        & $npm exec -- tsc -p tsconfig.json
        $env:BUILD_TARGET = "web"
        & $npm exec -- vite build
        Copy-Item (Join-Path $DistDir "web.html") (Join-Path $DistDir "index.html") -Force
    }
    finally {
        Remove-Item Env:BUILD_TARGET -ErrorAction SilentlyContinue
        Pop-Location
    }
}

Invoke-Step "Building Rust CLI" {
    Invoke-CargoBuildRelease -CliDirectory $CliDir -ToolchainCargo $cargo -VcVarsFile $VcVarsPath
}

Invoke-Step "Starting giteam web server (API backend)" {
    if (-not (Test-Path $GiteamExe)) {
        throw "Built executable not found: $GiteamExe"
    }

    Remove-Item $BackendLog, $BackendErrLog -ErrorAction SilentlyContinue

    $backendProcess = Start-Process `
        -FilePath $GiteamExe `
        -ArgumentList @("web", "--dist", $DistDir) `
        -WorkingDirectory $CliDir `
        -PassThru `
        -RedirectStandardOutput $BackendLog `
        -RedirectStandardError $BackendErrLog `
        -WindowStyle Hidden

    try {
        Wait-HttpReady -Url "http://127.0.0.1:5100/" -TimeoutSeconds 20
    }
    catch {
        if ($backendProcess -and -not $backendProcess.HasExited) {
            Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path $BackendErrLog) {
            Write-Host ""
            Write-Host "=== Backend stderr ==="
            Get-Content $BackendErrLog
        }
        if (Test-Path $BackendLog) {
            Write-Host ""
            Write-Host "=== Backend stdout ==="
            Get-Content $BackendLog
        }
        throw
    }
}

try {
    Write-Host ""
    Write-Host "=== Starting Vite dev server (frontend with HMR) ==="
    Write-Host "Open http://localhost:1420 in your browser"

    Push-Location $DesktopDir
    try {
        & $npm run dev
    }
    finally {
        Pop-Location
    }
}
finally {
    if ($backendProcess -and -not $backendProcess.HasExited) {
        Write-Host ""
        Write-Host "=== Stopping giteam web server ==="
        Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
