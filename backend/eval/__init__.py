"""backend/eval — grading-quality regression harness (audit Giai đoạn 2, #4).

The audit's central thesis: the repo isn't short on engineering, it's short on
*calibration evidence*. This package answers "con số này, lấy gì chứng minh nó
đúng?" for the Speaking (claude_grader) and Writing (gemini_writing_grader)
graders by scoring them against a human-graded gold set.

Layout:
  metrics.py     — pure-Python scoring math (MAE, quadratic-weighted kappa,
                   ±0.5 agreement, bias, 6/7-boundary confusion). No IO, fully
                   unit-tested (tests/test_eval_metrics.py).
  gold_loader.py — load the gold set from Supabase (or a local JSON fixture for
                   offline dev).
  run.py         — CLI: run a grader over the gold set → metrics report (JSON).
  sampling.sql   — stratified query to pull gold-set candidates from prod.

Nothing here runs in the request path or in normal CI — it's an ops tool
(nightly / pre-prompt-change), because it makes real, paid LLM calls.
"""
