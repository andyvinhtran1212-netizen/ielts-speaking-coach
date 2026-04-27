#!/usr/bin/env bash
# Phase D page-parity check.
# Verifies new Phase D pages load Supabase + api.js + initSupabase, matching the
# pattern used by dashboard.html.  Run from project root.
#
# Wave 1 ships exercises.html + d1-exercise.html.
# Wave 2 ships flashcards.html + flashcard-study.html.  D3 (d3-exercise.html)
# was deferred to Phase E and is tolerated as missing here.
set -euo pipefail

PAGES=(
  "frontend/pages/exercises.html"
  "frontend/pages/d1-exercise.html"
  "frontend/pages/d3-exercise.html"
  "frontend/pages/flashcards.html"
  "frontend/pages/flashcard-study.html"
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
    # d3-exercise.html is deferred to Phase E — don't fail the build over it.
    if [[ "$page" == *"d3-exercise.html" ]]; then
      echo "SKIP: $page (deferred to Phase E)"
      continue
    fi
    # flashcards*.html land in Phase D Wave 2 steps 5-6; tolerate their
    # absence during steps 1-4 the same way Wave 1 tolerated d3.  Once the
    # pages are committed, the parity grep below kicks in and enforces the
    # init-script trio just like every other page.
    if [[ "$page" == *"flashcards.html" || "$page" == *"flashcard-study.html" ]]; then
      echo "SKIP: $page (Phase D Wave 2 steps 5-6 — not yet authored)"
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
