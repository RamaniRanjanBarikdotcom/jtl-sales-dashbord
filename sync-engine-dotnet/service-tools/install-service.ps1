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

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
    $existingService = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
    if ($existingService -and $existingService.StartName) {
        $ServiceAccount = $existingService.StartName
    }
    if ($service.Status -ne "Stopped") {
        Stop-Service -Name $serviceName
        $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
    }
    sc.exe config $serviceName binPath= "`"$serviceExe`"" start= delayed-auto DisplayName= "JTL Sync Engine" | Out-Null
}
else {
    sc.exe create $serviceName binPath= "`"$serviceExe`"" start= delayed-auto obj= $ServiceAccount DisplayName= "JTL Sync Engine" | Out-Null
}

$runtimeRoot = "$env:ProgramData\JTL-Sync"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
icacls.exe $runtimeRoot /inheritance:r | Out-Null
icacls.exe $runtimeRoot /grant:r `
    "*S-1-5-18:(OI)(CI)F" `
    "*S-1-5-32-544:(OI)(CI)F" `
    "${ServiceAccount}:(OI)(CI)M" | Out-Null

sc.exe description $serviceName "Runs tenant-scoped, read-only JTL synchronization without an interactive login." | Out-Null
sc.exe failure $serviceName reset= 86400 actions= restart/60000/restart/120000/restart/300000 | Out-Null
sc.exe failureflag $serviceName 1 | Out-Null
sc.exe sidtype $serviceName unrestricted | Out-Null

$nameBytes = [Text.Encoding]::Unicode.GetBytes($serviceName.ToUpperInvariant())
$sha1 = [Security.Cryptography.SHA1]::Create()
try {
    $hash = $sha1.ComputeHash($nameBytes)
}
finally {
    $sha1.Dispose()
}
$parts = 0..4 | ForEach-Object { [BitConverter]::ToUInt32($hash, $_ * 4) }
$serviceSid = "S-1-5-80-$($parts -join '-')"

# The updater helper inherits the service token. Grant only this service SID
# modify access to the installed binaries and start/stop access to this service.
icacls.exe $InstallDirectory /grant:r "*${serviceSid}:(OI)(CI)M" | Out-Null
$sddl = (sc.exe sdshow $serviceName | Where-Object { $_ -match '^D:' } | Select-Object -Last 1).Trim()
if (-not $sddl) {
    throw "Unable to read the service security descriptor."
}
if ($sddl -notmatch [Regex]::Escape($serviceSid)) {
    $selfAce = "(A;;CCLCSWRPWPDTLOCRRC;;;$serviceSid)"
    $systemAclIndex = $sddl.IndexOf("S:")
    if ($systemAclIndex -ge 0) {
        $sddl = $sddl.Insert($systemAclIndex, $selfAce)
    }
    else {
        $sddl += $selfAce
    }
    sc.exe sdset $serviceName $sddl | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to grant narrowly scoped service self-control rights."
    }
}

Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
Write-Host "Installed and started $serviceName with Automatic (Delayed Start), preserving account '$ServiceAccount'."
