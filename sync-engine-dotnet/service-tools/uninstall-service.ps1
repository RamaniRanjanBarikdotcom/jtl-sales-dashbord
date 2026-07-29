$ErrorActionPreference = "Stop"
$serviceName = "JtlSyncEngine"
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue

if (-not $service) {
    Write-Host "$serviceName is not installed."
    exit 0
}

if ($service.Status -ne "Stopped") {
    Stop-Service -Name $serviceName -Force
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
}

sc.exe delete $serviceName | Out-Null
Write-Host "Removed $serviceName. ProgramData configuration and sync state were preserved."
