#!/usr/bin/env bash
# Phase D Wave 1 page-parity check.
# Verifies new Phase D pages load Supabase + api.js + initSupabase, matching the
# pattern used by dashboard.html.  Run from project root.
#
# Wave 1 ships exercises.html + d1-exercise.html.  d3-exercise.html is added in
# Wave 2 — this script tolerates its absence so Wave 1 PRs still pass.
set -euo pipefail

PAGES=(
  "frontend/pages/exercises.html"
  "frontend/pages/d1-exercise.html"
  "frontend/pages/d3-exercise.html"
)

CHECKS=(
  'supabase-js'
  'api.js'
  'initSupabase'
)

fail=0
checked=0

for page in "${PAGES[@]}"; do
  if [[ ! -f "$page" ]]; then
    # d3-exercise.html is Wave 2 — don't fail the Wave 1 build over it.
    if [[ "$page" == *"d3-exercise.html" ]]; then
      echo "SKIP: $page (Wave 2)"
      continue
    fi
    echo "FAIL: $page is missing."
    fail=1
    continue
  fi

  for needle in "${CHECKS[@]}"; do
    if ! grep -q "$needle" "$page"; then
      echo "FAIL: $page is missing required snippet '$needle'."
      fail=1
    fi
  done
  checked=$((checked+1))
done

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Page parity check FAILED."
  exit 1
fi

echo "Page parity OK ($checked page(s) checked)."
