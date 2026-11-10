"""Record real offline test output; no app imports, env files or DB resources."""
from datetime import datetime
from pathlib import Path
import shlex
import subprocess
import sys
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / 'tests.md'
command = [sys.executable, '-B', '-m', 'unittest', 'discover', '-s',
           'evidence/blackeye-u1-s0', '-p', 'test_*.py', '-v']
start = datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).isoformat()
result = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT, check=False)
end = datetime.now(ZoneInfo('Asia/Ho_Chi_Minh')).isoformat()
report = f'''# S0 real local test receipt

Task: aver-web/t_a7881371. Branch: blackeye-u1-s0.
Baseline: 7243b3364cfd637dc1bd0cd464c810380e27d10e.
Final exact commit is recorded outside its own contents in the card handoff.

- Interpreter: `{sys.version.split()[0]}` (`{sys.executable}`).
- Start (UTC+7): {start}
- End (UTC+7): {end}
- Working directory: `{ROOT}`
- Command: `{shlex.join(command)}`
- Exit code: **{result.returncode}**
- Expected: all S0 source-characterization tests pass; existing refusals remain
  400 (admin programme give), 422 (assigned programme start/guided/save q>40),
  409 (non-submitted review), 503 (missing source identity/frozen mismatch).
  Synthetic Black Eye is NOT recognized by 80-days-only source guard.
- Observed: actual complete runner output below; test success characterizes
  those existing boundaries/gaps, **not Black Eye feature readiness**.

```text
{result.stdout.rstrip()}
```

## Method and isolation

Stdlib only. Selected original function bodies are parsed from this checkout
and executed with injected fake collaborators. Decorators, module imports,
annotation evaluation, actual FastAPI routing, auth/DB and review assembly are
NOT exercised. Unexpected socket connect fails. Composite test is JSON-string
round-trip feasibility, not a database/Pydantic/UI codec test. No book content,
.env reads, app launch, cluster, migrations, install or live/paid requests.

First exploratory execution used host `python3` 3.9.6 and passed the earlier
13-test version (0.540s, exit 0); this receipt supersedes it with the final full
S0 suite on project-compatible Python 3.12. No failed test output is hidden.
Type-inference diagnostics during test authoring were corrected with explicit
Callable/Any annotations; they were not product failures or waived tests.

## NOT RUN / OPEN

- MV1 Black Eye identity/protected projection and MV2 assigned persisted review
  end-to-end. Existing generic submitted review is present, new boundaries absent.
- Full backend pytest, real FastAPI/Pydantic/OpenAPI and existing full Listening/
  80-days/dictation suites; no backend dependency lock discovered, no install or
  dependency re-resolution under lockfile-only scope.
- Postgres/Supabase/RLS/integration/concurrency/migration tests: no cluster/schema
  provisioned; even local migrations forbidden; local Supabase absent by card.
- Frontend typechecks/build/React/OpenAPI drift/browser/E2E: no frontend changed
  or launched. Proposed DTO/codec/cap behavior is not implemented.
- New generic-40/Black-Eye-48 positive validator/save/finalize/review tests, leakage,
  teacher/cohort negatives, stale/unavailable catalog retry and frozen revisions.
- All AC01–AC12 specialist acceptance, CI, served staging/production and real
  content/media/academic/rights verification. No source SHA presented as deploy proof.

See handoffs/LISTENING-BLACKEYE-V5-UNIT1-S0-FINDINGS-20261110.md for detailed
baseline routes, candidate DTOs, missing endpoints and conditional reuse.
'''
OUT.write_text(report, encoding='utf-8')
print(report)
sys.exit(result.returncode)
