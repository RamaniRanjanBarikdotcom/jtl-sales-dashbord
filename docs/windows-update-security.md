# Windows Update Security

## Threat Model

The system defends against a malicious dashboard request, cross-tenant request, compromised download path, redirect, tampered archive, wrong publisher, path traversal, downgrade, unsafe service interruption, transaction editing, and repeated bad release.

## Controls

- **Authorization:** `sync.agent.update` for company requests; release publication and failed-release retry have separate permissions. Agent endpoints require the existing sync API key and required tenant ID.
- **Tenant isolation:** backend queries bind `tenant_id + agent_id`; the agent cannot provide a trusted tenant body value.
- **Manifest:** deterministic canonical JSON, RSA-SHA256 signature, protocol/application/version validation. Private key is environment-only.
- **Transport:** HTTPS except explicit loopback development, backend/allowlisted host only, redirects rejected, timeout and maximum size.
- **Package:** streamed SHA-256, atomic `.partial` rename, safe ZIP extraction, restricted file classes, x64/identity/version validation.
- **Publisher:** `WinVerifyTrust`, certificate validity, signed thumbprint allowlist, and PE machine validation.
- **Transactions:** UUID only, atomic state, HMAC-SHA256 integrity key protected with current-user DPAPI.
- **Privilege:** the app runs from a normal user-owned extracted folder. Updates require no administrator, service-control, or Program Files permission.
- **Helper surface:** no URL, path, executable, service, shell, PowerShell, or arbitrary argument input.
- **Secrets/state:** remain in `%AppData%\JTL-Sync`; packages and backups do not copy secret files from AppData.
- **JTL:** updater adds no JTL SQL and does not alter credentials. Existing read-only SQL guards remain in effect.

## Prohibited Capabilities

No arbitrary command execution, executable upload endpoint, filesystem browser, dashboard URL, unvalidated redirect, side-by-side service, second scheduler, or Windows security bypass exists.

## Production Key Policy

Use separate keys for Authenticode and manifest signing. Keep private keys in GitHub/production secret storage, rotate under change control, distribute the public key in the signed portable package, and revoke affected releases immediately after suspected compromise.

## Windows Security Verification

Run signed/unsigned/tampered/wrong-publisher fixtures on a Windows pilot. Attempt an update from a normal user account and verify the helper can change only the extracted app folder through an approved transaction. Confirm root, Program Files, ProgramData, update-staging, and arbitrary paths are rejected.
