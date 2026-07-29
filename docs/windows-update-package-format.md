# Windows Routine Update Package Format

## Archive

```text
payload/
  JtlSyncEngine.Service.exe
  JtlSyncEngine.Updater.exe
  required service DLLs and runtime files
  version.json
```

The routine package deliberately excludes the WPF executable so an open interactive UI cannot lock and break a service update. WPF and installer changes ship through the administrator-assisted bridge/repair installer.

The backend-signed `manifest.json` and `manifest.sig` are returned through the release API and copied into the trusted staging transaction; they are not embedded in the hashed ZIP, avoiding a circular package-hash dependency.

## `version.json`

```json
{
  "applicationId": "JtlSyncEngine",
  "version": "1.5.0",
  "gitSha": "full-immutable-git-sha",
  "architecture": "win-x64",
  "protocolVersion": 2
}
```

## Signed Manifest

The canonical camel-case manifest includes application ID, channel, semantic version, Git SHA, protocol, optional minimum version, backend-relative package path, exact size, lowercase SHA-256, approved publisher thumbprints, publish time, restart flags, health timeout, and release notes. Object keys are recursively sorted before RSA-SHA256 signing.

## Validation Rules

- ZIP entries must be under `payload/`.
- Absolute paths, `..`, symbolic links, duplicate names, unsupported architecture, wrong identity/version/SHA, oversized compressed or expanded content, and missing required binaries are rejected.
- Payload files are limited to `.dll`, `.json`, the two expected service/updater `.exe` files, and `manifest-public-key.pem`; scripts and unrelated executables/certificates are rejected.
- Downloaded ZIP SHA-256 must match the signed manifest using a fixed-time comparison.
- Every `JtlSyncEngine*.exe` and `JtlSyncEngine*.dll` in the payload must pass `WinVerifyTrust` and the signed thumbprint allowlist.
- Nothing executes from the archive. Files are extracted under `%ProgramData%\JTL-Sync\updates\staging\<transaction>\payload`.
