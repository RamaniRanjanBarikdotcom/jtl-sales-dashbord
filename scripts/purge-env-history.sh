#!/usr/bin/env bash
set -euo pipefail

if ! command -v git-filter-repo >/dev/null 2>&1; then
  echo "git-filter-repo is required. Install: brew install git-filter-repo"
  exit 1
fi

if [[ "${1:-}" != "--yes" ]]; then
  echo "This rewrites git history to remove .env files."
  echo "Run from repo root after backup:"
  echo "  ./scripts/purge-env-history.sh --yes"
  exit 1
fi

echo "Rewriting history (removing .env / .env.local / .env.production)..."
git filter-repo \
  --path-glob '**/.env' \
  --path-glob '**/.env.*' \
  --invert-paths

echo "Done. Force-push all branches/tags:"
echo "  git push --force --all"
echo "  git push --force --tags"
