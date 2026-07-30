param(
    # Same as install-service.ps1: there is no installer, so the binaries live
    # wherever the portable ZIP was extracted.
    [string]$InstallDirectory = (Split-Path -Parent $PSScriptRoot),
    [string]$ServiceAccount = "NT AUTHORITY\LocalService",
    [string]$LegacyDataPath = (Join-Path $env:APPDATA "JTL-Sync")
)

$ErrorActionPreference = "Stop"
$serviceName = "JtlSyncEngine"
$InstallDirectory = (Resolve-Path -LiteralPath $InstallDirectory).Path
$serviceExe = Join-Path $InstallDirectory "JtlSyncEngine.Service.exe"

if (-not (Test-Path $serviceExe)) {
    throw "Service executable not found: $serviceExe"
}

if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    & (Join-Path $PSScriptRoot "install-service.ps1") `
        -InstallDirectory $InstallDirectory `
        -ServiceAccount $ServiceAccount `
        -LegacyDataPath $LegacyDataPath
    exit $LASTEXITCODE
}

sc.exe config $serviceName binPath= "`"$serviceExe`"" start= delayed-auto obj= $ServiceAccount | Out-Null
sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/120000/restart/300000 | Out-Null
sc.exe failureflag $serviceName 1 | Out-Null
Write-Host "Repaired $serviceName configuration without changing sync data."
