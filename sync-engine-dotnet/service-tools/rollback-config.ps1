param([Parameter(Mandatory = $true)][string]$BackupDirectory)

$ErrorActionPreference = "Stop"
$target = Join-Path $env:ProgramData "JTL-Sync"

if ((Get-Service -Name "JtlSyncEngine" -ErrorAction SilentlyContinue).Status -eq "Running") {
    throw "Stop JtlSyncEngine before rollback."
}
if (-not (Test-Path $BackupDirectory)) {
    throw "Backup directory not found: $BackupDirectory"
}

$rollbackSnapshot = Join-Path $target "backups\pre-rollback-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $rollbackSnapshot | Out-Null
Copy-Item (Join-Path $target "config") $rollbackSnapshot -Recurse -ErrorAction SilentlyContinue
Copy-Item (Join-Path $target "secrets") $rollbackSnapshot -Recurse -ErrorAction SilentlyContinue
Copy-Item (Join-Path $target "watermarks") $rollbackSnapshot -Recurse -ErrorAction SilentlyContinue
Copy-Item (Join-Path $target "failed-batches") $rollbackSnapshot -Recurse -ErrorAction SilentlyContinue

$settingsSource = Join-Path $BackupDirectory "settings.json"
if (Test-Path $settingsSource) {
    Copy-Item $settingsSource (Join-Path $target "config\settings.json") -Force
}

foreach ($directory in @("watermarks", "failed-batches")) {
    $sourceDirectory = Join-Path $BackupDirectory $directory
    if (Test-Path $sourceDirectory) {
        Copy-Item "$sourceDirectory\*" (Join-Path $target $directory) -Recurse -Force
    }
}

$legacySecrets = Join-Path $BackupDirectory "secrets.dat"
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
                throw "Rolled-back service secret verification failed."
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

$marker = Join-Path $target "state\migration-v1.complete"
Set-Content -Path $marker -Value "migrationVersion=1`nrolledBackAt=$([DateTime]::UtcNow.ToString('O'))`nsource=$BackupDirectory`npreRollback=$rollbackSnapshot"
Write-Host "Rollback restored from $BackupDirectory."
Write-Host "Previous service state retained at $rollbackSnapshot."
