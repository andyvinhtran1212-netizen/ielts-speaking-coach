# Local flow repeats

From `frontend`, install with `npm ci` and build once with synthetic fixture settings: `AVER_ENVIRONMENT=test VERCEL_ENV=development AVER_API_BASE=http://127.0.0.1:3999 AVER_SUPABASE_URL=https://example.supabase.co AVER_SUPABASE_ANON_KEY=test-anon-key npm run build`.
Run `node tooling/run-flow-repeat.mjs --flow tooling/verify-vocabulary-class-sets-flow.mjs --runs 5` (default `--mode start`; use `--mode dev` without a build).
Each round owns fresh loopback ports, fixture, Next and flow process groups; TERM gets 5 seconds before KILL, followed by a process-table audit. Failures and interruptions exit nonzero.
Add `--isolate-net` on Linux to run everything in a new network namespace with loopback only (`unshare` and `ip` required; missing permissions fail closed).

If a job must use a shell, use this fallback from `frontend` after the same build. Send SIGINT/SIGTERM to this shell, whose EXIT trap cleans the **setsid PGID**, including fixture and Next workers. Use unused ports; repeat the entire script for each round.

```bash
# Shell fallback (bash + Linux setsid + ps)
export NEXT_NATIVE_FIXTURE_PORT=${NEXT_NATIVE_FIXTURE_PORT:-3999}
export TEST_PORT=${TEST_PORT:-3017}
export AVER_API_BASE=http://127.0.0.1:$NEXT_NATIVE_FIXTURE_PORT
export AVER_ENVIRONMENT=test
setsid bash -c '
  trap "wait; exit" TERM HUP
  node tooling/next-native-fixture-api.mjs &
  node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port "$TEST_PORT" &
  wait
' &
PGID=$!
group_alive() {
  ps -A -o pgid= | awk -v group="$PGID" '$1 == group { found=1 } END { exit !found }'
}
cleanup() {
  trap '' INT TERM HUP
  kill -TERM -- "-$PGID" 2>/dev/null || true
  for ((i=0; i<50; i++)); do
    group_alive || { wait "$PGID" 2>/dev/null || true; return; }
    sleep 0.1
  done
  kill -KILL -- "-$PGID" 2>/dev/null || true
  wait "$PGID" 2>/dev/null || true
  for ((i=0; i<10; i++)); do
    group_alive || return
    sleep 0.1
  done
  echo "ERROR: process group $PGID survived cleanup" >&2
  exit 1
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
# Wait for fixture /health and Next's Ready line before running any flow here.
# node tooling/verify-vocabulary-class-sets-flow.mjs "http://127.0.0.1:$TEST_PORT"
wait "$PGID"
```
