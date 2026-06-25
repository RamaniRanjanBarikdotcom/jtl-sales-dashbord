# Security Credential Rotation Runbook

Use this after any real database/PgBouncer credential has been exposed in Git history.

## 1. Rotate Live Credentials

Do this in the database provider/admin console, not in this repository.

- Rotate the PostgreSQL application user password.
- Rotate the PgBouncer auth password/hash if PgBouncer is deployed.
- Update production runtime secrets on the server or hosting platform.
- Restart the API/PgBouncer services and verify `/api/healthz`.

## 2. Purge Git History

Run only after the new credentials are already live.

```bash
brew install git-filter-repo

git filter-repo \
  --path pgbouncer/pgbouncer.ini \
  --path pgbouncer/userlist.txt \
  --invert-paths

git push --force-with-lease --all
git push --force-with-lease --tags
```

After force-push:

- Re-clone deployment servers and developer worktrees.
- Recreate protected branches if required by GitHub settings.
- Re-run the GitHub secret scan.

## 3. Repository Safeguards

Already expected in this repo:

- Real `.env` files are ignored.
- Real `pgbouncer/pgbouncer.ini` and `pgbouncer/userlist.txt` are ignored.
- Safe PgBouncer templates live as `.example` files.
- CI runs Gitleaks secret scanning.
