$serviceName = "JtlSyncEngine"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if (-not $service) {
    Write-Host "NOT INSTALLED - automatic startup is not registered."
    Write-Host ""
    Write-Host "Syncing will only run while JtlSyncEngine.exe is open, and will NOT"
    Write-Host "resume after a server restart. To fix: open JtlSyncEngine.exe, go to"
    Write-Host "Settings, and tick 'Start automatically when Windows starts'."
    exit 1
}

$service | Format-List Name, DisplayName, Status, StartType
sc.exe qc $serviceName
sc.exe qfailure $serviceName

# Startup type and the recorded binary path are the two things that actually decide
# whether syncing comes back after a reboot, so state them in plain words.
$wmi = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
Write-Host ""
Write-Host "--- Reboot readiness ---"

if ($wmi.StartMode -eq "Auto") {
    Write-Host "Startup type       : OK ($($wmi.StartMode)) - starts without a login."
}
else {
    Write-Host "Startup type       : PROBLEM ($($wmi.StartMode)) - will NOT start on boot."
    Write-Host "                     Fix with: .\repair-service.ps1"
}

$binaryPath = $wmi.PathName.Trim('"')
if (Test-Path $binaryPath) {
    Write-Host "Service binary     : OK ($binaryPath)"
}
else {
    Write-Host "Service binary     : MISSING ($binaryPath)"
    Write-Host "                     The folder was moved, renamed or deleted after"
    Write-Host "                     registration. Re-run: .\repair-service.ps1"
}

Write-Host "Runs as            : $($wmi.StartName)"
Write-Host "Current state      : $($service.Status)"

if ($service.Status -ne "Running") {
    Write-Host ""
    Write-Host "The service is registered but not running. Recent errors:"
    Get-WinEvent -FilterHashtable @{ LogName = "Application"; StartTime = (Get-Date).AddDays(-2) } `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match $serviceName } |
        Select-Object -First 5 TimeCreated, LevelDisplayName, Message |
        Format-List
    $log = Join-Path $env:ProgramData "JTL-Sync\logs"
    if (Test-Path $log) { Write-Host "Service logs: $log" }
}
