# Tech debt: content backfill for the depth/quality gates

*Audit Giai đoạn 3 (#6 reading, #7a quiz, #7 vocab). **PARKED / tech debt** —
gate + generator merged (PRs #702/#705); backfill RAN partially (2026-07-11) then
**stopped on the Gemini monthly spending cap**. Resume when the cap is raised.*

## CURRENT STATE (2026-07-11)

| Area | State | PR |
|------|-------|----|
| **#6 reading** | ✅ DONE — L3-T1 40/40, L3-T2 40/40 (~90% draft-accept; adversarial verify caught real bugs, hand-fixed) | #708, #710 |
| **#7a quiz** | ⚠️ PARTIAL — **409/1575** why_wrong injected (41 banks, all gate+adversarial clean). **BLOCKED: Gemini monthly spend cap (429 ResourceExhausted).** | #711 |
| **#7 vocab** | ✅ Reviewed — item-stats fixed (#709) but data too sparse; distractor review found **65/128 ambiguous distractors (synonyms) + 4 structural = 69 flagged** → admin curation | #709 |

Real content-rejection rate is only ~3% — the quiz stall was the spend cap, not quality.

## RESUME the quiz backfill (the only blocked piece)

1. Raise the Gemini spend cap at <https://ai.studio/spend> (that's the hard blocker).
2. Merge #711 first (so the 409 already-done are on `main`), then:
   ```
   export GEMINI_API_KEY=...
   cd backend
   python -m scripts.backfill_quiz_why_wrong --out drafts/quiz-flagged.yaml --workers 6
   ```
   It's **resumable** — skips questions that already have `why_wrong`, so it
   continues from 409. Keep `--workers` ≈ 6 (12 blew past the per-minute quota).
   It injects the clean ones in-place; commit the modified banks + open a PR
   (PR review = the human spot-check tier).
3. Verify: `python -m scripts.check_quiz_why_wrong` (coverage) → when full, enable
   `--strict` in content-CI.

Note: pushing content trips the pre-push hook (it runs the live-Gemini smoke test
`tests/smoke/test_gemini_smoke.py`, which fails on the cap). Confirm
`pytest tests/ -m "not smoke"` is green, then `git push --no-verify`.

## FINISH the vocab fixes (needs admin / a regen pass)

69 flagged D1 exercises (report was `scratchpad/d1-flagged-actionable.md`; regenerate
with `scripts.gen_d1_distractor_review --status published`). These are LIVE DB
content edited via the admin tool — fix or retire the ambiguous ones there, OR
generate replacement distractors (draft) for admin review. NOT a file injection.

## FLIP the strict gates (after coverage lands)

- Reading: after #708 + #710 merge → `check_reading_solution_depth --strict` in content-CI.
- Quiz: after the resume completes → `check_quiz_why_wrong --strict`.
(Enabling early reds the build at the current partial coverage.)

## Process reference (draft → gate máy → adversarial LLM → spot-check người)

Run all of these from `cd backend` (the `scripts` package lives under `backend/`;
`docs/...` paths are then `../docs/...`):
- Reading: `python -m scripts.gen_reading_solutions content/reading/<test>.md --out drafts/x.yaml [--dry-run]`
  → review ⚠ → paste `solution:` into the .md. (reading content is under `backend/content/`)
- Quiz: `python -m scripts.backfill_quiz_why_wrong --out drafts/q.yaml --workers 6` (batch,
  above) or per-bank `python -m scripts.gen_quiz_why_wrong ../docs/grammar-quiz-banks/<bank>.md --out …`;
  pick banks with `python -m scripts.check_quiz_why_wrong --rank`.
- Vocab: `python -m scripts.gen_d1_distractor_review` + `python -m scripts.check_d1_item_stats --flagged-only`.

Gates: `backend/services/{reading_solution_depth,quiz_why_wrong,d1_quality}.py`.
Gold-set job (separate): `docs/TECH_DEBT_gold_set_A1.md`.
