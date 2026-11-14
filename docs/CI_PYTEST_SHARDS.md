# Backend pytest shard durations

`backend/scripts/ci_pytest_shards.py` keeps whole test files together and assigns
the longest estimated file to the least loaded shard (LPT). Equal durations
sort by path; equal shard loads sort by shard index. New files use the median
duration of measured files still in the suite, or one second if none is known.
All four runners read the same committed
`backend/scripts/ci_pytest_shard_weights.json`. Weights affect placement only;
the `verify` gate still requires every collected test to run exactly once.

The snapshot is the sum of pytest setup, call and teardown seconds per file.
It excludes collection, dependency installation, service startup and runner
cleanup. CI prints estimated seconds before pytest, the 20 slowest test phases
afterward, and actual per-shard test seconds plus longest/mean in the aggregate
job summary. The balance target is longest <= 1.3 times the mean; compare job
wall times too, since setup can vary independently.

## Snapshot provenance (CI-SHARD4-TIMEOUT, 2026-11-10)

Source: [Tests run 42447937193](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/42447937193),
attempt 1, head `cf87f7292013c4d91b3dbd8d5f2208b2e9bf689d`. All four shards
passed in that single attempt and their reports passed parity: 20,339
collected ids, 20,339 in the union, none missing or extra. The snapshot covers
all 789 test files on staging `7243b3364` (none missing, none stale).

| Shard | Job wall time (minutes) | Test phases (seconds) |
| --- | ---: | ---: |
| 1/4 | 9.48 | 468 |
| 2/4 | 11.15 | 569 |
| 3/4 | 11.52 | 586 |
| 4/4 | 21.28 | 1160 |

The PC-J515 snapshot had no weight for the migration suites added after it
(`test_migration_341`…`369`, each 70–274 seconds); they got the old median
(0.04 seconds) and LPT put 365, 369, 361 and 341 together on shard 4. Shard 4
reached 21.8 minutes on green `9e5083469` (run 42642548055, 1,174 s of tests).
On `7243b3364` (run 42737006241) a slow Ubuntu mirror added 6.5 and 12 minutes
to `apt-get install ffmpeg`, and both attempts hit the 25-minute timeout at
about 63% while running `test_migration_369_grammar_quiz_definer_search_path.py`.
The refreshed weights predict 696 seconds of test phases per shard on this
run's timings. Run 42642548055 (green `9e5083469`, slower timings) predicts at
most 863 seconds per shard with this snapshot.

## Previous snapshot provenance (PC-J515)

Source: [Tests run 41373304720](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/41373304720),
head `bfd9ba8148f3882a214a5fb069a50b23997f8280`. Its four shard reports passed
parity: 17,431 collected ids, 17,431 in the union, none missing or extra.

| Shard | Job wall time (minutes) | Test phases (seconds) |
| --- | ---: | ---: |
| 1/4 | 5.45 | 250.07 |
| 2/4 | 3.63 | 135.44 |
| 3/4 | 21.17 | 1089.45 |
| 4/4 | 4.40 | 169.33 |

The original snapshot covered 615 files; these reports measure 746. Expensive
new files such as `test_async_auth_fail_closed_http.py` (49.01s),
`test_migration_332_staff_security_audit.py` (48.34s) and
`test_migration_333_ai_budget.py` (47.35s) had been assigned the old median
(zero seconds). They accumulated on shard 3. The refreshed weights predict
about 411 seconds of test phases per shard on the PC-J515 base suite; the PR
records the measured result. The separate PG17 advisory job took 13.30 minutes
then; see the PC-J582 section below.

## Manual refresh

Run from the repository root with GitHub CLI authenticated. Choose one complete,
successful **Tests** run for the revision being evaluated. Use a fresh directory
outside the checkout; do not mix artifacts from different runs or attempts.

```bash
run_id=41373304720 # replace with the run being measured
reports_dir=$(mktemp -d)
gh run download "$run_id" --pattern 'backend-pytest-shard-*' --dir "$reports_dir"
gh run download "$run_id" --name backend-pytest-collected --dir "$reports_dir"
for shard in 1 2 3 4; do
  cp "$reports_dir/backend-pytest-shard-$shard/shard-$shard.json" "$reports_dir/"
done
python3 backend/scripts/ci_pytest_shards.py verify --dir "$reports_dir" --total 4 \
  --weights-out "$reports_dir/weights.json"
# Only after verify succeeds and all four source jobs passed:
cp "$reports_dir/weights.json" backend/scripts/ci_pytest_shard_weights.json
rm -r "$reports_dir"
```

`verify` refuses to write a candidate when parity fails. CI also uploads
`backend-pytest-weights` for inspection, but never changes the committed file.
Review the snapshot diff, update provenance, run `tests/test_ci_pytest_shards.py`,
then check all four shard wall times and parity on the PR's exact head. Keep
the four required check names and 25-minute shard timeout unchanged. Do not
skip tests or alter the PG17 advisory suite to improve the reported balance.

## PostgreSQL 17 advisory shards (PC-J582)

The PG17 advisory suite (workflow env `PG17_TEST_FILES`) ran serially and grew
to about 18.5 minutes of test phases plus about one minute of setup. Its job
hit the 20-minute `timeout-minutes`; a timed-out job is `cancelled`, which
`continue-on-error` does not absorb, so the staging Tests runs for `f68136d03`
and `9891da738` were cancelled and failed the promotion gate. The job now runs
as three shards (`backend-pg17`, matrix 1–3) with
`ci_pytest_shards.py run --files ... --weights scripts/ci_pytest_pg17_shard_weights.json`.
`backend-pg17-verify` collects the same files and runs `verify --total 3`.
Both jobs stay advisory: `continue-on-error`, not in `backend.needs`, branch
protection or `staging-promotion-gate.yml`, 20-minute timeout per shard.

Snapshot source: [Tests run 41603286450](https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/actions/runs/41603286450),
attempt 2, head `9891da738`, 1,999 tests in 99 files, all passed. That serial
run uploaded no shard report, so each file's seconds are the gaps between
consecutive `PASSED` log timestamps (1,109 seconds in total), which include
setup and teardown. The snapshot predicts 370 seconds per shard.

Refresh it like the main snapshot, from a complete successful run, using the
`backend-pg17-shard-*` artifacts, `backend-pg17-verify`'s collection (or
`collect --files` on the same head) and `verify --total 3 --weights-out`; CI
uploads the candidate as `backend-pg17-weights`. Copy the result to
`backend/scripts/ci_pytest_pg17_shard_weights.json` and update this provenance.
