param(
    # The caller passes this explicitly: when the script runs elevated,
    # $env:APPDATA is the administrator's profile, not the operator's, so the
    # legacy data would silently appear to be missing.
    [string]$LegacyDataPath = (Join-Path $env:APPDATA "JTL-Sync")
)

$ErrorActionPreference = "Stop"

$source = $LegacyDataPath
$target = Join-Path $env:ProgramData "JTL-Sync"
$marker = Join-Path $target "state\migration-v1.complete"

if (Test-Path $marker) {
    Write-Host "Configuration migration is already complete."
    exit 0
}
if (-not (Test-Path $source)) {
    throw "Legacy configuration not found at $source"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = Join-Path $target "backups\legacy-$timestamp"
@("config", "secrets", "watermarks", "logs", "diagnostics", "failed-batches", "state", "backups") |
    ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $target $_) | Out-Null }
Copy-Item -Path $source -Destination $backup -Recurse

$legacySettings = Join-Path $source "settings.json"
if (Test-Path $legacySettings) {
    Copy-Item $legacySettings (Join-Path $target "config\settings.json") -Force
}

$legacySecrets = Join-Path $source "secrets.dat"
if (Test-Path $legacySecrets) {
    $encrypted = [IO.File]::ReadAllBytes($legacySecrets)
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
        $encrypted,
        $null,
        [Security.Cryptography.DataProtectionScope]::CurrentUser)
    try {
        $serviceEncrypted = [Security.Cryptography.ProtectedData]::Protect(
            $plain,
            $null,
            [Security.Cryptography.DataProtectionScope]::LocalMachine)
        [IO.File]::WriteAllBytes((Join-Path $target "secrets\secrets.dat"), $serviceEncrypted)
        $verified = [Security.Cryptography.ProtectedData]::Unprotect(
            $serviceEncrypted,
            $null,
            [Security.Cryptography.DataProtectionScope]::LocalMachine)
        try {
            if (-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($plain, $verified)) {
                throw "Service secret verification failed."
            }
        }
        finally {
            [Array]::Clear($verified, 0, $verified.Length)
        }
    }
    finally {
        [Array]::Clear($plain, 0, $plain.Length)
    }
}

foreach ($directory in @("watermarks", "failed-batches")) {
    $legacyDirectory = Join-Path $source $directory
    if (Test-Path $legacyDirectory) {
        Copy-Item "$legacyDirectory\*" (Join-Path $target $directory) -Recurse -Force
    }
}

Set-Content -Path $marker -Value "migrationVersion=1`ncompletedAt=$([DateTime]::UtcNow.ToString('O'))`nbackup=$backup"
Write-Host "Migration completed. Backup retained at $backup"
