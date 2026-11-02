# WM staging API journey (PC-J542)

Python 3.11+, standard library only. Run from the repository root:

```bash
python3 scripts/e2e-staging/wm_e2e.py --dry-run --run-id wm-example
python3 scripts/e2e-staging/wm_e2e.py --run-id <fresh-id>
python3 scripts/e2e-staging/wm_e2e.py --cleanup --run-id <same-id>
```

`--dry-run` makes **zero network requests**, including when credentials are set.
Live execution is for WM after Leader/Vinh supplies dedicated accounts. This
job does not execute it.

| Exit code | Result | Meaning |
| --- | --- | --- |
| `0` | PASS | Dry-run completed (no live acceptance), or cleanup succeeded. |
| `1` | FAIL | Invalid arguments/configuration, safety guard, API failure, malformed response UUID or failed assertion. |
| `2` | PARTIAL | Journey ran, but coverage is incomplete (including the unavailable Writing/Speaking fixtures). |
| `3` | SKIP | Journey or cleanup could not start because required QA account tokens are missing; no API calls. |

There is no full live-success exit while Writing/Speaking fixture coverage is
blocked. Optional missing tokens/source IDs and unavailable fixture slices print
individual SKIP messages during a journey; the overall result remains PARTIAL/2
when other steps ran. Dry-run remains PASS/0 even when it lists missing inputs.

All inputs come from `E2E_*` environment variables. The script never loads
credential files, signs in, refreshes tokens or creates accounts. Inject tokens
using the operator's secret manager/environment; do not put values in commands,
reports or committed files.

| Variable | Requirement |
| --- | --- |
| `E2E_BASE_URL` | Defaults to `https://ielts-speaking-coach-staging.up.railway.app`. Only that exact HTTPS host, optionally port 443, is accepted. No path, query, userinfo or redirects. |
| `E2E_INSTRUCTOR_TOKEN` | Existing QA instructor JWT, for class/prompt creation, Writing give and minting class join codes. |
| `E2E_ADMIN_TOKEN` | Existing QA admin JWT with the required AAL2, for other-skill gives, ledger checks and cleanup. Required before any writes so cleanup is available. |
| `E2E_STUDENT_TOKEN` | Existing QA learner JWT, linked to one instructor-owned `students` record. |
| `E2E_LATE_STUDENT_TOKEN` | Optional second learner JWT, also already linked; missing means SKIP late join. |
| `E2E_SPEAKING_TOPIC_ID` | Optional UUID of an active Part 1 topic with eligible existing question audio. Missing means SKIP Speaking give. No questions/audio are generated. |
| `E2E_LISTENING_TEST_ID` | Optional UUID of a published public full/mini/drill paper with audio (not a programme/report-only form or per-question practice). Missing means SKIP Listening give/submit. |

Every account must have a display name beginning `QA TEST`, a distinct user ID,
and an address under `@staging-e2e.averlearning.com`. This also makes the
instructor's QA rows visible when staging enables `HIDE_TEST_DATA`. Accounts,
their student records, role grants and the active Grammar Diagnostic content/
runtime flag must be provisioned beforehand. Nothing is provisioned by this
script. Missing required tokens produce SKIP before any API call; invalid
configuration or a non-QA identity produces FAIL without printing values.

`wm_e2e.py::ALLOWED_ROUTES` lists every permitted HTTP method and complete
path/query for the journey and cleanup. UUID path parameters and the two known
Listening query forms are matched strictly. Any other method, route or query is
blocked before transport, including new paid routes. The staging host guard,
disabled environment proxies, redirect refusal and hidden token representation
remain enforced.

The journey creates a new `E2E-<runid>` class, joins the first learner using a
new instructor-minted code, then gives Writing through `/instructor` and
Speaking/Grammar/Listening through `/admin/cohorts` (these skills currently have
no instructor give API). The second learner joins **after** gives: Writing must
appear through activation's automatic backfill; other class items are explicitly
backfilled through the existing admin API and then refetched. This distinguishes
automatic enrolment behavior from an explicit teacher action.

Grammar uses the existing QUICK diagnostic with fixed choice `0`, then reads
the persisted report. Listening saves a deliberately wrong marked answer to
question 1, submits and reads the persisted result. Both use the real,
deterministic rules graders with fixture inputs and no AI. Scores need not be
high. The learner ledger is refetched twice and checked against the admin tally.
The script refuses Listening start-over when the QA user has an open attempt on
the paper, including a mock sitting; use otherwise idle dedicated accounts.

Current fixture limits, checked against backend code:

- `backend/config.py` and `services/provider_fixtures.py` expose server-only
  `GRADING_PROVIDER_MODE=fixture` for Speaking, with a startup production guard.
  There is no remotely verifiable mode endpoint. Upload to
  `/sessions/{id}/responses` performs STT/grading in the same request. The script
  gives the task but skips upload/submission/grading, even if an operator sets
  an unrelated local flag. It cannot safely establish zero paid calls.
- `routers/writing_student.py::submit_my_assignment` schedules a real grading job on
  submit; the Speaking fixture does not cover Writing. The script verifies give
  and learner visibility only, skipping start/draft/submit/grading. Saving a
  draft would also make the existing assignment-delete API reject cleanup.
- Enabling those slices requires separately approved backend fixture coverage
  and safe runtime attestation (or a submit-only server contract). This tooling
  does not add flags, mutate backend environment settings, or call paid routes.

Cleanup discovers data by the **exact** run marker and instructor ownership,
so it also works after an interrupted request without storing tokens/codes in a
manifest. All new titles/names/notes/instructions carry the marker; generated
items, reports, attempts, membership rows and audit entries are traceable through
their marked parent class/task/code (their APIs have no free-text name field).
Keep the printed run ID. Never rerun a live journey with an existing ID: there
are no automatic mutation retries. On an ambiguous failure, inspect the
run-owned state via APIs, then use cleanup; start a new journey with a fresh ID.

Cleanup archives class tasks and the class, deletes only unstarted Writing
assignments, deactivates prompts, removes class memberships and revokes the
run's codes after removing active code assignments. It refetches canonical
state and checks that `is_used`, `used_by`, `used_at` are unchanged. Submitted
Grammar/Listening evidence, give receipts, membership and audit history remain
retained by design; no SQL, account deletion or historical-score erasure occurs.
If someone starts a Writing assignment manually, the API's 409 stops cleanup;
the script never bypasses that guard. Repeat `--cleanup` after resolving errors;
an already completed cleanup is safe to repeat. A reused/prefix-colliding run ID
never broadens cleanup to another run.

Local checks (no staging calls):

```bash
cd backend
python -m pytest tests/test_wm_staging_e2e.py -q
```

WM should retain CLI output and exact backend release SHA for a future live
run, record the exit code and PASS/FAIL/PARTIAL/SKIP output, and run cleanup with
the same run ID. A dry-run or partial journey does not satisfy full live E2E
acceptance.
