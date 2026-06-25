#!/usr/bin/env bash
set -euo pipefail

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo is required. Install: brew install git-filter-repo"
  exit 1
fi

if [[ "${1:-}" != "--yes" ]]; then
  echo "This rewrites git history to remove .env and PgBouncer secret files."
  echo "Run from repo root after backup:"
  echo "  ./scripts/purge-env-history.sh --yes"
  exit 1
fi

echo "Rewriting history (removing .env files and PgBouncer runtime secrets)..."
git filter-repo \
  --path-glob '**/.env' \
  --path-glob '**/.env.*' \
  --path pgbouncer/pgbouncer.ini \
  --path pgbouncer/userlist.txt \
  --invert-paths

echo "Done. Force-push all branches/tags:"
echo "  git push --force --all"
echo "  git push --force --tags"
