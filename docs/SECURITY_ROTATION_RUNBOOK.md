# External Security Rotation Runbook

This project cannot rotate cloud/database/provider credentials from source code alone.
Use this runbook after any secret has been pasted into local `.env`, chat, screenshots, or a commit.

## Required External Actions

1. Rotate the online PostgreSQL password in the database provider console.
2. Rotate Redis password if it was shared outside the server.
3. Rotate `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, and any sync API keys.
4. Update only the private server/runtime `.env` files with the new values.
5. Restart the stack with `docker compose up -d --build --remove-orphans`.
6. Verify `GET /api/healthz` returns `200 OK`.

## Git History Purge

If a real secret was ever committed, deleting it from the current file is not enough.
Rewrite history with one of these tools, then force-push with coordination:

```bash
git filter-repo --path backend/.env --invert-paths
```

or for known secret text:

```bash
git filter-repo --replace-text replacements.txt
```

After rewriting:

```bash
git push --force-with-lease --all
git push --force-with-lease --tags
```

Every collaborator must then re-clone or hard-reset to the rewritten history.

## Local Verification

Run:

```bash
./scripts/verify-external-security.sh
```

This script checks only local repo conditions. It cannot verify provider-side credential rotation.
