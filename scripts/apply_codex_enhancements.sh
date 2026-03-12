#!/usr/bin/env bash
set -euo pipefail

PATCH_PATH="${1:-artifacts/reconcile-codex-integrity/codex-enhancements.patch}"
TARGET_BRANCH="${2:-main}"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[FAIL] Working tree is not clean. Commit or stash first." >&2
  exit 10
fi

if [[ ! -f "$PATCH_PATH" ]]; then
  echo "[FAIL] Patch file not found: $PATCH_PATH" >&2
  exit 11
fi

if ! git rev-parse --verify --quiet "$TARGET_BRANCH" >/dev/null; then
  echo "[FAIL] Target branch not found: $TARGET_BRANCH" >&2
  exit 12
fi

git checkout "$TARGET_BRANCH"
git apply --3way --index "$PATCH_PATH"

echo "[OK] Applied codex enhancement patch to $TARGET_BRANCH"
echo "[NEXT] Review: git status && git diff --cached"
