param(
    [string]$InstallDirectory = "$env:ProgramFiles\JTL Sync Engine",
    [string]$ServiceAccount = "NT AUTHORITY\LocalService"
)

$ErrorActionPreference = "Stop"
$serviceName = "JtlSyncEngine"
$serviceExe = Join-Path $InstallDirectory "JtlSyncEngine.Service.exe"

if (-not (Test-Path $serviceExe)) {
    throw "Service executable not found: $serviceExe"
}

if (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) {
    & (Join-Path $PSScriptRoot "install-service.ps1") -InstallDirectory $InstallDirectory -ServiceAccount $ServiceAccount
    exit $LASTEXITCODE
}

sc.exe config $serviceName binPath= "`"$serviceExe`"" start= delayed-auto obj= $ServiceAccount | Out-Null
sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/120000/restart/300000 | Out-Null
sc.exe failureflag $serviceName 1 | Out-Null
Write-Host "Repaired $serviceName configuration without changing sync data."
