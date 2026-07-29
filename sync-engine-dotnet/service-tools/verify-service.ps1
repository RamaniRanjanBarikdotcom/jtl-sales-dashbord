$ErrorActionPreference = "Stop"
$service = Get-Service -Name "JtlSyncEngine"
if ($service.Status -ne "Running") {
    throw "JtlSyncEngine is not running."
}

$root = Join-Path $env:ProgramData "JTL-Sync"
foreach ($directory in @("config", "secrets", "watermarks", "logs", "diagnostics", "failed-batches", "state", "backups")) {
    if (-not (Test-Path (Join-Path $root $directory))) {
        throw "Missing runtime directory: $directory"
    }
}

sc.exe qc "JtlSyncEngine" | Select-String "DELAYED_AUTO_START"
sc.exe qfailure "JtlSyncEngine"
Write-Host "Local service verification passed. Complete reboot-without-login and live heartbeat checks separately."
