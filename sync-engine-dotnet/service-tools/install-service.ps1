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

if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
    throw "$serviceName is already installed. Use repair-service.ps1."
}

$runtimeRoot = "$env:ProgramData\JTL-Sync"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
icacls.exe $runtimeRoot /inheritance:r | Out-Null
icacls.exe $runtimeRoot /grant:r `
    "*S-1-5-18:(OI)(CI)F" `
    "*S-1-5-32-544:(OI)(CI)F" `
    "${ServiceAccount}:(OI)(CI)M" | Out-Null

sc.exe create $serviceName binPath= "`"$serviceExe`"" start= delayed-auto obj= $ServiceAccount DisplayName= "JTL Sync Engine" | Out-Null
sc.exe description $serviceName "Runs tenant-scoped, read-only JTL synchronization without an interactive login." | Out-Null
sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/120000/restart/300000 | Out-Null
sc.exe failureflag $serviceName 1 | Out-Null

Write-Host "Installed $serviceName with Automatic (Delayed Start)."
