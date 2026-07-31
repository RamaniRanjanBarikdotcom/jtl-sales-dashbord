param(
    # Defaults to the folder holding this script's parent, i.e. the extracted
    # portable folder. There is no installer, so the binaries stay where the user
    # unzipped them and the service binPath must point there.
    [string]$InstallDirectory = (Split-Path -Parent $PSScriptRoot),
    [string]$ServiceAccount = "NT AUTHORITY\LocalService",
    # Legacy per-user data root. Passed by the app because this script runs
    # elevated, where $env:APPDATA resolves to the administrator's profile
    # rather than the operator's.
    [string]$LegacyDataPath = (Join-Path $env:APPDATA "JTL-Sync")
)

$ErrorActionPreference = "Stop"
$serviceName = "JtlSyncEngine"

$InstallDirectory = (Resolve-Path -LiteralPath $InstallDirectory).Path
$serviceExe = Join-Path $InstallDirectory "JtlSyncEngine.Service.exe"

if (-not (Test-Path $serviceExe)) {
    throw "Service executable not found: $serviceExe"
}

# A service binPath pointing inside a temp folder breaks the next time Windows
# cleans up, leaving a service that can never start again.
foreach ($volatile in @($env:TEMP, $env:TMP, (Join-Path $env:SystemRoot "Temp"))) {
    if ([string]::IsNullOrWhiteSpace($volatile)) { continue }
    $resolved = [IO.Path]::GetFullPath($volatile).TrimEnd('\')
    if ($InstallDirectory.TrimEnd('\') -eq $resolved -or
        $InstallDirectory.StartsWith("$resolved\", [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to install from a temporary folder ($InstallDirectory). Extract the ZIP to a permanent folder first."
    }
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

# Publish the operator's credentials into the machine-wide service store.
#
# The service runs as LocalService: it cannot read the operator's profile and cannot
# decrypt CurrentUser-protected secrets. If this is skipped the service starts, finds
# no credentials of its own, logs "migration required" and never syncs.
#
# This runs elevated but still inside the OPERATOR's logon session, which is the only
# context that can decrypt their CurrentUser secrets. A scheduled task or a service
# could not do this.
$legacySecrets = Join-Path $LegacyDataPath "secrets.dat"
$serviceSecrets = Join-Path $runtimeRoot "secrets\secrets.dat"

if ((Test-Path $legacySecrets) -and -not (Test-Path $serviceSecrets)) {
    try {
        & (Join-Path $PSScriptRoot "migrate-config.ps1") -LegacyDataPath $LegacyDataPath
    }
    catch {
        # Starting anyway would leave a service that runs but can decrypt nothing.
        throw "Configuration migration failed, so the service was not started: $($_.Exception.Message)"
    }
}

if (-not (Test-Path $serviceSecrets)) {
    Write-Warning @"
No service credentials were published to $serviceSecrets.
The service will start but stay idle until they exist.
Open JTL Sync Engine, enter the settings and press Save, then run:
    .\repair-service.ps1
"@
}

Start-Service -Name $serviceName
(Get-Service -Name $serviceName).WaitForStatus("Running", [TimeSpan]::FromSeconds(30))
Write-Host "Installed and started $serviceName with Automatic (Delayed Start) from '$InstallDirectory', preserving account '$ServiceAccount'."
