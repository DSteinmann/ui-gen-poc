param(
    [ValidateSet("start", "stop", "restart", "status")]
    [string]$Command = "start"
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    return (Resolve-Path (Join-Path $scriptDir ".."))
}

$RootDir = Get-RepoRoot
$PidDir = Join-Path $RootDir "scripts/.pids"
$LogDir = Join-Path $RootDir "scripts/logs"

if (!(Test-Path $PidDir)) { New-Item -ItemType Directory -Path $PidDir | Out-Null }
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

$Services = @(
    @{ Name = "core-system"; Path = "packages/core-system"; Command = "npm start" }
    @{ Name = "knowledge-base"; Path = "packages/knowledge-base"; Command = "npm start" }
    @{ Name = "activity-recognition"; Path = "packages/activity-recognition"; Command = "npm start" }
    @{ Name = "device-api"; Path = "packages/device"; Command = "node server.js" }
    @{ Name = "device-ui"; Path = "packages/device"; Command = "npm run dev" }
    @{ Name = "tablet-device-api"; Path = "packages/tablet-device"; Command = "node server.js" }
    @{ Name = "tablet-device-ui"; Path = "packages/tablet-device"; Command = "npm run dev" }
)

function Get-PidFile($name) {
    return Join-Path $PidDir "$name.pid"
}

function Get-LogFile($name) {
    return Join-Path $LogDir "$name.log"
}

function Start-ServiceProcess($svc) {
    $pidFile = Get-PidFile $svc.Name
    if (Test-Path $pidFile) {
        try {
            $existingPid = Get-Content $pidFile | Select-Object -First 1
            if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) {
                Write-Output "[skip] $($svc.Name) already running (PID $existingPid)"
                return
            } else {
                Remove-Item -ErrorAction SilentlyContinue $pidFile
            }
        } catch {
            Remove-Item -ErrorAction SilentlyContinue $pidFile
        }
    }

    $logFile = Get-LogFile $svc.Name
    if (Test-Path $logFile) { Remove-Item $logFile -ErrorAction SilentlyContinue }
    $serviceDir = Join-Path $RootDir $svc.Path
    Write-Output "[start] $($svc.Name) -> $($svc.Command)"

    $escapedLog = $logFile.Replace('`', '``').Replace('"', '`"')
    $commandText = "$($svc.Command) 2>&1 | Tee-Object -FilePath `\"$escapedLog`\" -Append"
    $arguments = "-NoLogo -NoProfile -Command `$ErrorActionPreference='Stop'; $commandText"

    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $serviceDir -WindowStyle Hidden -PassThru
    Set-Content -Path $pidFile -Value $process.Id
}

function Stop-ServiceProcess($svc) {
    $pidFile = Get-PidFile $svc.Name
    if (!(Test-Path $pidFile)) {
        Write-Output "[stop] $($svc.Name) not running (no pid file)"
        return
    }

    $pid = Get-Content $pidFile | Select-Object -First 1
    if (-not $pid) {
        Write-Output "[stop] $($svc.Name) pid file empty"
        Remove-Item $pidFile -ErrorAction SilentlyContinue
        return
    }

    $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
    if ($process) {
        Write-Output "[stop] $($svc.Name) (PID $pid)"
        try {
            Stop-Process -Id $pid -ErrorAction SilentlyContinue
            $waited = $false
            for ($i = 0; $i -lt 10; $i++) {
                Start-Sleep -Milliseconds 500
                if (-not (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
                    $waited = $true
                    break
                }
            }
            if (Get-Process -Id $pid -ErrorAction SilentlyContinue) {
                Write-Output "[stop] $($svc.Name) still running; forcing termination"
                Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
        } catch {
            Write-Verbose $_
        }
    } else {
        Write-Output "[stop] $($svc.Name) already stopped"
    }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
}

function Status-ServiceProcess($svc) {
    $pidFile = Get-PidFile $svc.Name
    if (!(Test-Path $pidFile)) {
        Write-Output "[status] $($svc.Name): stopped"
        return
    }

    $pid = Get-Content $pidFile | Select-Object -First 1
    if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
        Write-Output "[status] $($svc.Name): running (PID $pid)"
    } else {
        Write-Output "[status] $($svc.Name): stopped (stale pid file)"
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
}

switch ($Command) {
    "start" {
        Get-ChildItem -Path $LogDir -Filter *.log -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
        foreach ($svc in $Services) { Start-ServiceProcess $svc }
        Write-Output "Logs live in $LogDir."
    }
    "stop" {
        foreach ($svc in $Services) { Stop-ServiceProcess $svc }
    }
    "restart" {
        foreach ($svc in $Services) { Stop-ServiceProcess $svc }
        Get-ChildItem -Path $LogDir -Filter *.log -ErrorAction SilentlyContinue | Remove-Item -ErrorAction SilentlyContinue
        foreach ($svc in $Services) { Start-ServiceProcess $svc }
        Write-Output "Logs live in $LogDir."
    }
    "status" {
        foreach ($svc in $Services) { Status-ServiceProcess $svc }
    }
}
