#!/usr/bin/env sh
set -eu

echo "--- tracked env files ---"
tracked_env="$(git ls-files | grep -E '(^|/)\.env($|\.)|backend/\.env$' | grep -vE '\.env\.(example|production\.example)$' || true)"
if [ -n "$tracked_env" ]; then
  echo "$tracked_env"
  echo "FAIL: real env files are tracked"
  exit 1
fi
echo "OK: no real env files are tracked"

echo "--- generated sync engine folders ---"
generated="$(find sync-engine-dotnet/JtlSyncEngine -maxdepth 2 \( -name bin -o -name obj \) -type d -print)"
if [ -n "$generated" ]; then
  echo "$generated"
  echo "FAIL: generated bin/obj folders exist"
  exit 1
fi
echo "OK: generated folders absent"

echo "--- proxy forwarding headers ---"
if ! grep -R "X-Forwarded-Proto" apache >/dev/null; then
  echo "FAIL: Apache configs do not set X-Forwarded-Proto"
  exit 1
fi
echo "OK: Apache configs include X-Forwarded-Proto"

echo "--- external reminder ---"
echo "Provider credential rotation and remote Git history purge must be confirmed outside this script."
