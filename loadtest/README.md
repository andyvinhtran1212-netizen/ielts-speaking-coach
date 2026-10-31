# Staging load test (PC-J409)

`student_exam_load.py` simulates N students opening the same quiz bank at the
same time, in the course-runner call order, while a probe polls `/health`
(1 s) and `/health/async-db` (event-loop lag, 5 s). `/health/ready` is off by
default (`--ready-interval N` to enable, N ≥ 30 enforced): it runs ~15 synchronous
DB calls on the event loop, so a 1 s probe stalls the backend on its own. It was written
to reproduce the 2026-10-30 18:10 prod stall on **staging** and to compare
before/after a hotfix.

## Safety

- **Staging/local only.** The base URL and every request (httpx request hook,
  redirects off) must be one of `ielts-speaking-coach-staging.up.railway.app`,
  `staging.averlearning.com`, `localhost`, `127.0.0.1`. Production hosts and
  every other host are refused with exit code 2 before the first request. A
  `LOADTEST_*` env value that mentions a production host or the production
  Supabase ref `huwsmtubwulikhlmcirx` is refused too (token variables excluded).
- **`localhost` / `127.0.0.1` are allowlisted for local backends only.** The
  guard checks the host name, not where it leads: never point it at a tunnel
  or port-forward (`ssh -L`, `railway connect`, a proxy) that reaches
  production, because the guard cannot tell.
- Real LLM calls are opt-in and capped in code: at most 20 Speaking calls
  (`--max-speaking-grades`) and 10 Writing submits (`--max-writing-grades`)
  per process, across all ladder steps. Both default to 0. The Speaking budget
  covers `POST /sessions/{id}/questions/generate` as well as graded uploads,
  because generate calls Gemini when the topic is not in the library; without
  budget a Speaking student only reads `GET /sessions/{id}/questions`. Use a
  library topic (`--speaking-topic`) to keep generate off the LLM.
  `--max-speaking-grades > 0` also requires `--audio-file` (a clip of at least
  15 s): the built-in 3 s WAV is below the Part 1 minimum, so the driver
  refuses before any request instead of sending uploads that fail on duration.
  These cost caps count **HTTP calls**, not provider calls: one generate may
  make up to ~4 Gemini calls through internal retries, and one Speaking upload
  may call Whisper, a grader and Azure. They are not a dollar-spend ceiling.
- `POST /sessions` 403/429 (account not activated, code quota, daily cap) are
  reported as `quota 4xx`, not as load errors, and do not stop the ladder.
  Failed or non-200 `/health/async-db` probes are listed as probe failures.
- A timed quiz's normal clock expiry stops answers and submits a
  `time_cap` finalization followed by a timeout course verdict. An explicit
  server expiry 409 on an in-flight progress or normal finalization request
  follows the same path: it remains visible in HTTP status/latency metrics
  without increasing the load error rate. Other failures still count as errors.
- Tokens are read from `LOADTEST_ACCOUNTS_FILE` (one access token per line,
  or a JSON list of strings / `{"token": ...}`) or `LOADTEST_TOKEN_1..n`.
  They are never printed; reports name accounts `user#k`. Supabase access
  tokens expire after about 1 h, so mint them just before a run.

## Exclusion with staging smoke/promotion (Loại trừ với smoke/promotion)

A load step and the live staging smoke must never overlap: on 2026-10-30 a
30-user step (20:39:31–20:41:57) covered Gate A's timeout and the Grammar
boundary of smoke run 41064757555 (PC-J433). The workflow `concurrency` group
only serialises smoke runs with each other, so the rule is enforced in both
directions below. **Owner: Leader / Release Manager.**

- **Load does not start while staging is busy (enforced by the driver).**
  Before the first step and after every cooldown the driver reads GitHub
  Actions, read-only (`gh run list --workflow <file> --json
  status,databaseId,createdAt`), for the workflows in `STAGING_WORKFLOWS`:
  `staging-release-smoke.yml` (live smoke, which every staging merge and
  promotion depends on) and `offsite-backup.yml` (dumps the staging database
  and Storage). Workflows that run only on the CI runner, target production,
  or read only the GitHub API are not listed; the reason for each is in the
  code. While a run is `queued`, `in_progress`, `waiting`, `requested` or
  `pending`, the driver sends **no request** to staging, polls every
  `--busy-poll-seconds` (30), and after `--busy-wait-seconds` (900) skips the
  remaining steps. The report records `staging busy: <workflow> run <id>`
  and the process exits **4**, which is not a load failure.
- **Fail closed.** If the status cannot be read (no `gh`, not
  authenticated, timeout, unexpected output), the driver refuses to start the
  step and exits **5**. Steps that already ran are still written. Only
  `--skip-busy-check` bypasses the check, and the report then says
  `busy_check: skipped by operator`. The operator who passes it must make sure
  no smoke/promotion is running.
- **Smoke/promotion does not start while load holds staging (operator
  rule).** The repository cannot block a GitHub workflow from here, so run
  the ladder with `--busy-marker <path>` (for box runs:
  `/workspace/cc-jobs/LOADTEST_ACTIVE`). The marker is JSON (`label`, `pid`,
  `started_at`, `current_step`) and is removed when the run ends, including
  on abort and Ctrl-C. A marker that already exists makes the driver refuse
  (exit 5); remove a stale one by hand only after checking its `pid`. **While
  the marker exists: do not merge into `staging` and do not dispatch the
  staging smoke or a promotion.**
- **Do not run a ladder while a smoke/promotion is running**, even with
  `--skip-busy-check`.
- **A later green run does not erase an earlier red one.** A smoke that went
  red during a load window is still reported and investigated as red. Rerun
  it only after the load is over, and keep both results.

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
- `--beacon-seconds` must be finite and greater than zero.
- Exit codes: 0 done (including a ladder stopped by its limits), 2 refused by
  the production guard, 3 no accounts, 4 staging busy (steps skipped), 5 busy
  check unreadable or busy marker already present.
- `--mix exam=3,speaking=1,writing=1` adds the Speaking/Writing flows.
- Quiz students adopt the server's stage, open session and saved answers.
  Accounts that have completed every stage stay at the result state and send
  no new quiz sessions or answers, including when reused across ladder steps.
  A deadline or abort flushes pending answers and leaves partial stages open
  for the next run. A failed progress request stops that student without
  finalizing the session; normal finalization requires a fully answered,
  acknowledged stage. Assignment expiry finalizes the acknowledged prefix with
  `ended_by: time_cap` and requests the verdict with `timed_out: true`, without
  opening another stage. The timer is adopted from `course-resume` and refreshed
  from session creation and subsequent resume reads. The run's abort/deadline
  guards still take precedence over timeout finalization and verdict requests.
  A failed finalization PATCH (non-2xx or transport failure) stops the student,
  records the error in metrics and notes, and never opens the next stage.
  After the final stage, the journey submits one `POST /api/quiz/course/verdict`, included in the endpoint metrics table.
  Use unfinished test accounts when measuring active exam work.

Outputs (default `loadtest/results/`, git-ignored): `<label>-<ts>.json`,
`<label>-<ts>.md` (p50/p95/p99, errors, timeouts, statuses per endpoint,
`/health` and loop lag) and `<label>-<ts>-sessions.json`. That last file lists
every quiz/speaking session id and writing submit the run used. Quiz rows have
`resumed: true` for adopted sessions and `false` for newly created ones; adopted
sessions can contain work from earlier runs. Use that distinction when auditing
or cleaning up the test data afterwards on staging.

The backend identity probe is anonymous. Reports mark `git_sha` as
`unknown (anon)` and `git_sha_verified: false`; redacted deployment fields
are also unavailable. Equal unknown values never establish a deployment
match for before/after evidence. Confirm the deployed SHA separately through
the authenticated release checks when attributing measurements to a hotfix.

## Test

```bash
python -m pytest loadtest/test_student_exam_load.py
```
