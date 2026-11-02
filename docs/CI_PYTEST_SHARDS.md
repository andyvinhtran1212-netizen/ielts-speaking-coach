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

## Snapshot provenance (PC-J515)

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
and remains a separate follow-up.

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
