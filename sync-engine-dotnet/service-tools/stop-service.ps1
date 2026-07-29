$ErrorActionPreference = "Stop"
Stop-Service -Name "JtlSyncEngine"
(Get-Service -Name "JtlSyncEngine").WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
Get-Service -Name "JtlSyncEngine"
