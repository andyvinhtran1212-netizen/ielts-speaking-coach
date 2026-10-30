# Staging load test (PC-J409)

`student_exam_load.py` simulates N students opening the same quiz bank at the
same time, in the course-runner call order, while a probe polls `/health`,
`/health/ready` (1 s) and `/health/async-db` (event-loop lag, 5 s). It was written
to reproduce the 2026-10-30 18:10 prod stall on **staging** and to compare
before/after a hotfix.

## Safety

- **Staging/local only.** The base URL and every request (httpx request hook,
  redirects off) must be one of `ielts-speaking-coach-staging.up.railway.app`,
  `staging.averlearning.com`, `localhost`, `127.0.0.1`. Production hosts and
  every other host are refused with exit code 2 before the first request. A
  `LOADTEST_*` env value that mentions a production host is refused too.
- Real grading calls are opt-in and capped in code: at most 20 Speaking
  uploads (`--max-speaking-grades`) and 10 Writing submits
  (`--max-writing-grades`) per process. Both default to 0.
- Tokens are read from `LOADTEST_ACCOUNTS_FILE` (one access token per line,
  or a JSON list of strings / `{"token": ...}`) or `LOADTEST_TOKEN_1..n`.
  They are never printed; reports name accounts `user#k`. Supabase access
  tokens expire after about 1 h, so mint them just before a run.

## Run

```bash
pip install -r loadtest/requirements.txt
LOADTEST_ACCOUNTS_FILE=/path/outside/git/tokens.txt \
python loadtest/student_exam_load.py \
  --base-url https://ielts-speaking-coach-staging.up.railway.app \
  --bank-id <bank uuid> --class-item <assignment item uuid> \
  --users 30 --sessions-per-user 3 --label before \
  --out-dir /workspace/cc-jobs/loadtest
```

- `--users` is the number of concurrent virtual students. With fewer accounts,
  `--sessions-per-user` lets several virtual students share one account
  (accounts × sessions-per-user must cover `--users`). Shared accounts are a
  limitation: per-user caches/rate limits and single-session rules differ
  from a real class.
- `--ladder 10,30,50,100,200` runs capacity steps with a cooldown and stops
  early when a step exceeds `--ladder-max-error-rate` (5%) or
  `--ladder-max-p95-ms` (10 s).
- `--abort-on-health-p95-ms` (default 5000) stops the run when the rolling
  `/health` p95 passes the limit. The results are still written.
- `--mix exam=3,speaking=1,writing=1` adds the Speaking/Writing flows.

Outputs (default `loadtest/results/`, git-ignored): `<label>-<ts>.json`,
`<label>-<ts>.md` (p50/p95/p99, errors, timeouts, statuses per endpoint,
`/health` and loop lag) and `<label>-<ts>-sessions.json`. That last file lists
every quiz/speaking session id and writing submit the run created, so the
data can be cleaned up afterwards on staging.

## Test

```bash
python -m pytest loadtest/test_student_exam_load.py
```
