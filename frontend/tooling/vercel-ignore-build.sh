#!/usr/bin/env bash
# Vercel Ignored Build Step (frontend/vercel.json "ignoreCommand").
#
# Vercel contract: exit 1 = BUILD, exit 0 = SKIP. Vercel also builds on any
# other non-zero exit, so a crash or a missing script fails safe to a build.
#
# Rules (Vercel Build CPU is most of the infra bill; most preview builds came
# from docs/spec/CI/backend-only bot branches):
#   1. main / staging: always build. Missing or unknown branch: build.
#   2. Any other branch builds only when BOTH hold:
#      a. it opts in: the commit message contains "[preview]" (any case) or
#         the branch name starts with "preview/";
#      b. the diff since the last deployed commit (VERCEL_GIT_PREVIOUS_SHA),
#         else since the merge-base with origin/staging, touches a
#         frontend-affecting path (see is_frontend_path).
#      If the base or the diff cannot be computed (shallow clone, fetch
#      failure), it builds.
#   3. Docs, specs, backend/, migrations, .github/ and test-only changes never
#      count as frontend-affecting.
#
# Inputs (Vercel system env): VERCEL_GIT_COMMIT_REF, VERCEL_GIT_PREVIOUS_SHA,
# VERCEL_GIT_COMMIT_MESSAGE. Opt-in for bots: docs/AGENT_WORKFLOW.md.
# Decision-table test: frontend/tests/vercel-ignore-build.test.mjs.

build() { echo "vercel-ignore-build: BUILD - $1"; exit 1; }
skip() { echo "vercel-ignore-build: SKIP - $1"; exit 0; }

# Paths are repo-root relative (git diff --name-only output).
is_frontend_path() {
  case "$1" in
    frontend/public/*) return 0 ;;                  # served as-is, .md templates too
    frontend/tests/*) return 1 ;;                   # tests + retired HTML fixtures
    frontend/*.md) return 1 ;;                      # docs ("*" also matches "/")
    frontend/playwright*.config.js) return 1 ;;     # browser-test configs
    frontend/vitest.config.mts) return 1 ;;
    frontend/tooling/verify-*.mjs) return 1 ;;      # local/CI flow verifiers
    frontend/tooling/write-flow-core.mjs | frontend/tooling/write-flows/*) return 1 ;;
    frontend/*) return 0 ;;                         # app, lib, components, public,
                                                    # package*.json, next/vercel config
    vercel.json | .vercelignore) return 0 ;;        # repo-root Vercel config, if added
    *) return 1 ;;                                  # backend/, docs/, specs/, .github/ ...
  esac
}

ref="${VERCEL_GIT_COMMIT_REF:-}"
ref="${ref#refs/heads/}"

case "$ref" in
  main | staging) build "branch $ref always deploys" ;;
  "") build "VERCEL_GIT_COMMIT_REF is empty (unknown branch)" ;;
esac

if [ -z "${VERCEL_GIT_COMMIT_MESSAGE+set}" ]; then
  build "VERCEL_GIT_COMMIT_MESSAGE is unset (unknown opt-in state)"
fi

opt_in=""
case "$ref" in
  preview/*) opt_in="branch prefix preview/" ;;
esac
if [ -z "$opt_in" ]; then
  shopt -s nocasematch
  case "$VERCEL_GIT_COMMIT_MESSAGE" in
    *"[preview]"*) opt_in="[preview] in commit message" ;;
  esac
  shopt -u nocasematch
fi
[ -n "$opt_in" ] || skip "branch $ref has no [preview] opt-in"

git rev-parse --verify --quiet HEAD^{commit} >/dev/null \
  || build "cannot resolve HEAD"

base=""
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -n "$prev" ] && git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  base="$prev"
  base_desc="previous deployment ${prev:0:12}"
else
  if ! git rev-parse --verify --quiet refs/remotes/origin/staging >/dev/null; then
    timeout 30 git fetch --quiet --no-tags --depth=50 origin \
      +refs/heads/staging:refs/remotes/origin/staging >/dev/null 2>&1 \
      || build "no previous deployment in clone and origin/staging fetch failed"
  fi
  base="$(git merge-base HEAD refs/remotes/origin/staging 2>/dev/null)" \
    || build "no merge-base with origin/staging (shallow clone?)"
  [ -n "$base" ] || build "empty merge-base with origin/staging"
  base_desc="merge-base with origin/staging ${base:0:12}"
fi

changed="$(git diff --name-only --no-renames "$base" HEAD 2>/dev/null)" \
  || build "git diff against $base_desc failed"

while IFS= read -r path; do
  [ -n "$path" ] || continue
  if is_frontend_path "$path"; then
    build "$opt_in; frontend path $path changed since $base_desc"
  fi
done <<<"$changed"

skip "$opt_in, but no frontend-affecting change since $base_desc"
