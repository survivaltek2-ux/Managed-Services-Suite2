#!/usr/bin/env sh
# Remove Replit-only files from the project so it can be transferred to
# another host. Run this AFTER you have a working .env and verified the app
# builds with `pnpm run build:deploy` outside Replit.
#
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

# Top-level Replit config
rm -f .replit .replitignore replit.md

# Replit artifact descriptors (one per artifact). The application code does
# not read these at runtime; ports/base paths are now defaulted in each
# vite.config.ts and overridable via PORT / BASE_PATH env vars.
find artifacts -type d -name ".replit-artifact" -prune -exec rm -rf {} +

# Replit cache + config dirs
rm -rf .cache/replit .config/replit .config/.semgrep

# Replit task-merge hook
rm -f scripts/post-merge.sh

# Replit local agent state (skills, plans, etc.)
rm -rf .local .agents skills-lock.json

# Misc Replit-injected files
rm -f .semgrepignore

echo "Done. The repo is now Replit-free."
echo
echo "Next steps:"
echo "  1. Review git status and commit the deletions."
echo "  2. Build and run the app on your new host: pnpm install && pnpm run build:deploy"
echo "  3. See README.md and DEPLOYMENT_GUIDE.md for production setup."
