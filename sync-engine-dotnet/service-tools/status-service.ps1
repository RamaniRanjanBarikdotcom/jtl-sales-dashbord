$service = Get-Service -Name "JtlSyncEngine" -ErrorAction SilentlyContinue
if (-not $service) {
    Write-Host "Not installed"
    exit 1
}
$service | Format-List Name, DisplayName, Status, StartType
sc.exe qc "JtlSyncEngine"
sc.exe qfailure "JtlSyncEngine"
