# Grading-quality regression harness (`backend/eval`)

Audit Giai đoạn 2, finding **#4**. The audit's thesis: the repo isn't short on
engineering, it's short on **calibration evidence** — "con số này, lấy gì chứng
minh nó đúng?". This harness scores the Speaking (`claude_grader`) and Writing
(`gemini_writing_grader`) graders against a **human-graded gold set** so any
prompt/model change can be measured instead of guessed.

## What it is / isn't

- **Is:** an ops tool — run it nightly and before any prompt/model change.
- **Isn't:** part of the request path or normal CI. It makes real, paid LLM
  calls, so it is **not** wired into `pytest` (only the pure-math
  `tests/test_eval_metrics.py` is).

## Pieces

| File | Role |
|------|------|
| `eval/metrics.py` | Pure-Python: MAE, bias, ±0.5 rate, quadratic-weighted kappa (QWK), 6/7-boundary confusion. Fully unit-tested. |
| `eval/gold_loader.py` | Load gold set from Supabase (`--source db`) or a JSON fixture (`--source fixture`). |
| `eval/run.py` | CLI runner → metrics report (stdout + optional JSON). |
| `eval/sampling.sql` | Stratified candidate picker from prod. |
| `eval/fixtures/*.sample.json` | Tiny offline corpus for smoke tests. |
| `migrations/144_gold_set_eval.sql` | `gold_speaking` / `gold_writing` tables. |

## Metrics — how to read them

- **QWK** (headline) — ordinal rater agreement. 1.0 perfect, 0 chance-level. Bands
  are ordinal, so this is the right measure, not accuracy.
- **MAE** — average band error. **bias** — signed (positive = grader too generous).
- **±0.5 rate** — the human-facing "agrees within half a band" number.
- **6/7 boundary confusion** — how often the grader lands on the opposite side
  of band 6.5 from the human (the line students care about most).
- **human-QWK** — inter-rater agreement between the two human raters = the
  **ceiling**. Judge the grader relative to this, not against 1.0: if two
  teachers only reach QWK 0.85 on GRA, the grader hitting 0.80 is near-human.

## Building the gold set (the part that needs teachers)

MVP target: **20 Speaking + 20 Writing**, growing to 50+50. Storage is Supabase
(migration 144); audio lives in a private `gold-audio` bucket (create it in the
dashboard — Storage → New bucket → `gold-audio`, **not** public). Nothing goes
in git (PII + size).

1. **Sample candidates** — run `eval/sampling.sql` in the Supabase SQL editor.
   It returns a **balanced** slate across `low` / `mid` / `high` band buckets
   plus edge-case flags (zero-mistake-low, off-topic, short). Deliberately keep
   the low band and 6/7 boundary well-represented; include the incident essay
   `0caf5e59`.
2. **Grade independently, 2+ raters.** Each rater fills a per-criterion band for
   every item (Speaking FC/LR/GRA/P/overall; Writing TR/CC/LR/GRA/overall)
   without seeing the AI grade or each other's. This gives the inter-rater
   ceiling. Where two raters differ by > 0.5, adjudicate (discuss → agreed band)
   and flag the item as "hard".
3. **Load into `gold_*`.** `rater_bands` = the JSON array of each rater's grades;
   `ref_*` = the adjudicated/mean value the harness scores against. Set
   `band_bucket` + `tags`.

## Running

```bash
cd backend

# Offline smoke test — no DB, no API keys (inter-rater + composition only):
python -m eval.run --module writing  --source fixture --no-grade
python -m eval.run --module speaking --source fixture --no-grade

# Real run against the gold set (makes paid LLM calls):
python -m eval.run --module writing  --source db --out reports/writing_$(date +%F).json
python -m eval.run --module speaking --source db --out reports/speaking_$(date +%F).json
```

Freeze each JSON report as the baseline; a later run that regresses MAE/QWK past
your threshold is the signal to hold a prompt/model change. (A nightly cron +
pre-change checklist is the realistic gate — full-corpus LLM calls per PR are
too costly/flaky for CI.)

## What this unblocks

- **#2 Azure→P** — with the audio subset, fit an empirical (isotonic) mapping to
  replace the invented `1 + score/100×8`.
- **#8 word-timestamp FC** — verify the change improves FC MAE before shipping.
- **#10 cross-calibration** — check "band 6.5" means the same across modules.

Speaking **P** is intentionally absent from the transcript-grader run (it needs
Azure + audio); it enters via the #2 calibration step.
