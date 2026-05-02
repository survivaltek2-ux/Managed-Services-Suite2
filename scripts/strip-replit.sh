#!/usr/bin/env sh
# Remove Replit-only files from the project so it can be deployed anywhere.
# Run this AFTER you have a working .env and verified the app builds.
# Idempotent — safe to run multiple times.

set -eu

ROOT=${1:-$(pwd)}
cd "$ROOT"

if [ ! -f "package.json" ]; then
  echo "Error: package.json not found in $ROOT" >&2
  echo "Pass the project root as the first argument, or run from the project root." >&2
  exit 1
fi

echo "Stripping Replit-only files from $ROOT ..."

# Top-level Replit config files
rm -f .replit .replitignore replit.md replit.nix

# Replit artifact descriptors (ports/base paths are set via PORT / BASE_PATH env vars)
find artifacts -type d -name ".replit-artifact" -exec rm -rf {} + 2>/dev/null || true

# Replit cache + config directories
rm -rf .cache .config .upm

# Replit task-merge and post-merge hooks
rm -f scripts/post-merge.sh

# Replit local agent state (skills, plans, etc.)
rm -rf .local .agents skills-lock.json

# Semgrep config injected by Replit
rm -f .semgrepignore

echo ""
echo "Done — repo is now Replit-free."
echo ""
echo "Next steps:"
echo "  1. cp .env.example .env  (then fill in your production values)"
echo "  2. pnpm install && pnpm run build:deploy"
echo "  3. See deploy/README.md for full deployment instructions."
