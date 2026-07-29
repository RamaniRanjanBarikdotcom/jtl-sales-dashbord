$ErrorActionPreference = "Stop"
Start-Service -Name "JtlSyncEngine"
(Get-Service -Name "JtlSyncEngine").WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
Get-Service -Name "JtlSyncEngine"
