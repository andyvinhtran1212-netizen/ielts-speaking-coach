"""reading_solution — the canonical "stepper" contract for a reading question's
detailed solution (chữa bài từng bước), Phase 0.3.

Two solution sources exist in the repo and this module RECONCILES them into ONE
view-model the frontend stepper consumes:

  * v2-flat authored questions (content_import_service) — a per-question
    `solution:` dict (optional) plus a top-level `explanation:` string.
  * prose-imported L3 tests (reading_prose_import) — `payload.solution` with
    prose fields {steps, source_excerpt, vocab, paraphrase, trap_analysis, tips}.

The stepper adds STRUCTURED, KP-aware fields on top of those prose fields —
authored optionally, all backward-compatible (a question with only the old prose
`steps` / `explanation` still renders as a one-step stepper, so nothing must be
re-authored):

  solution:
    solution_steps:                 # NEW — ordered micro-steps
      - action: decode_vocab        #   one of ACTION_TYPES
        instruction_vi: "..."
        kp_refs: [{type, slug, anchor?}]      # points at knowledge_points
        microcheck: {...}           #   optional, Phase 3 (not built here)
    distractor_analysis:            # NEW — why each wrong option is wrong
      - option: "A"
        why_wrong_vi: "..."
        kp_refs: [{type, slug, anchor?}]
    kp_tags: [{type, slug, anchor?}]           # NEW — denormalized union
    # prose fallbacks (unchanged): steps, source_excerpt, vocab, trap_analysis, tips…

This module is PURE (no DB, no kp_registry import) so the importer stays
import-safe and its validation stays a pure function. Asset-resolution of the
kp_refs (do the slugs/anchors exist?) is done by the gates:
tests/test_kp_ref_drift.py (grammar/skill, offline) + scripts/
verify_kp_asset_drift.py (vocab, DB). Here we validate only STRUCTURE.
"""
from __future__ import annotations

from typing import Iterator, Optional

# The step verbs a solution walks through (plan §2.2). Ordered roughly as a
# reader would: find it → decode words → parse the clause → eliminate traps →
# infer → confirm.
ACTION_TYPES: tuple[str, ...] = (
    "locate", "decode_vocab", "parse_syntax", "eliminate", "infer", "confirm",
)

_VALID_KP_TYPES: frozenset[str] = frozenset(("grammar", "vocab", "skill"))


# ── kp_ref shape ─────────────────────────────────────────────────────────────

def norm_kp_ref(item) -> Optional[dict]:
    """A raw kp_ref → {type, slug, anchor} (anchor defaults to ''), or None if it
    is not a well-formed ref. Skill/vocab refs carrying an anchor keep it here;
    that cross-field rule is enforced in validate_kp_ref, not silently dropped."""
    if not isinstance(item, dict):
        return None
    kp_type = item.get("type")
    slug = item.get("slug")
    if not isinstance(kp_type, str) or not isinstance(slug, str) or not slug.strip():
        return None
    return {"type": kp_type, "slug": slug.strip(), "anchor": (item.get("anchor") or "").strip()}


def validate_kp_ref(item, label: str) -> list[str]:
    """Structural (no asset lookup): type ∈ valid set, slug present, and only
    grammar refs may carry an anchor."""
    ref = norm_kp_ref(item)
    if ref is None:
        return [f"{label}: kp_ref phải là {{type, slug}} với slug không rỗng."]
    errs: list[str] = []
    if ref["type"] not in _VALID_KP_TYPES:
        errs.append(f"{label}: kp_ref.type '{ref['type']}' phải là một trong "
                    f"{sorted(_VALID_KP_TYPES)}.")
    if ref["anchor"] and ref["type"] != "grammar":
        errs.append(f"{label}: chỉ kp_ref type 'grammar' được mang 'anchor' "
                    f"(gặp type '{ref['type']}').")
    return errs


def iter_kp_refs(solution: Optional[dict]) -> Iterator[dict]:
    """Every normalized kp_ref anywhere in a solution (steps + distractors +
    explicit kp_tags). De-dup is the caller's job (see collect_kp_tags)."""
    if not isinstance(solution, dict):
        return
    for step in solution.get("solution_steps") or []:
        if isinstance(step, dict):
            for raw in step.get("kp_refs") or []:
                ref = norm_kp_ref(raw)
                if ref:
                    yield ref
    for d in solution.get("distractor_analysis") or []:
        if isinstance(d, dict):
            for raw in d.get("kp_refs") or []:
                ref = norm_kp_ref(raw)
                if ref:
                    yield ref
    for raw in solution.get("kp_tags") or []:
        ref = norm_kp_ref(raw)
        if ref:
            yield ref


def collect_kp_tags(solution: Optional[dict]) -> list[dict]:
    """Deduped union of every kp_ref in the solution — the `kp_tags` denormal-
    ization used for fast per-question diagnosis (plan §2.3 Tier-1)."""
    seen: dict[tuple, dict] = {}
    for ref in iter_kp_refs(solution):
        seen[(ref["type"], ref["slug"], ref["anchor"])] = ref
    return list(seen.values())


# ── structural validation (pure; called by the importer) ─────────────────────

def validate_solution_structure(solution, label: str) -> list[str]:
    """Validate the OPTIONAL stepper fields of a solution dict. Prose-only
    solutions (no solution_steps/distractor_analysis/kp_tags) are valid — they
    fall back to a one-step stepper. Empty/absent → no errors."""
    if solution in (None, {}, ""):
        return []
    if not isinstance(solution, dict):
        return [f"{label}: 'solution' phải là dict."]
    errs: list[str] = []

    steps = solution.get("solution_steps")
    if steps is not None:
        if not isinstance(steps, list):
            errs.append(f"{label}: 'solution_steps' phải là danh sách.")
        else:
            for i, step in enumerate(steps):
                slab = f"{label}.solution_steps[{i}]"
                if not isinstance(step, dict):
                    errs.append(f"{slab}: mỗi bước phải là dict.")
                    continue
                action = step.get("action")
                if action not in ACTION_TYPES:
                    errs.append(f"{slab}: 'action' phải là một trong "
                                f"{', '.join(ACTION_TYPES)} (gặp {action!r}).")
                if not str(step.get("instruction_vi") or "").strip():
                    errs.append(f"{slab}: thiếu 'instruction_vi'.")
                for raw in step.get("kp_refs") or []:
                    errs += validate_kp_ref(raw, f"{slab}.kp_refs")

    distractors = solution.get("distractor_analysis")
    if distractors is not None:
        if not isinstance(distractors, list):
            errs.append(f"{label}: 'distractor_analysis' phải là danh sách.")
        else:
            for i, d in enumerate(distractors):
                dlab = f"{label}.distractor_analysis[{i}]"
                if not isinstance(d, dict):
                    errs.append(f"{dlab}: mỗi mục phải là dict.")
                    continue
                if not str(d.get("why_wrong_vi") or "").strip():
                    errs.append(f"{dlab}: thiếu 'why_wrong_vi'.")
                for raw in d.get("kp_refs") or []:
                    errs += validate_kp_ref(raw, f"{dlab}.kp_refs")

    for raw in solution.get("kp_tags") or []:
        errs += validate_kp_ref(raw, f"{label}.kp_tags")

    return errs


# ── reconcile → stepper view-model (pure; called by the review endpoint) ─────

def build_stepper(solution: Optional[dict], explanation: Optional[str] = None) -> Optional[dict]:
    """Normalize any question's solution (+ its top-level explanation fallback)
    into the stepper view-model the frontend renders. Returns None only when
    there is nothing to show (no solution and no explanation).

    Reconcile rules (backward-compatible):
      * steps      ← solution.solution_steps if present; else ONE synthesized
                     'confirm' step from prose `steps` / `explanation`.
      * distractors← solution.distractor_analysis if present; else ONE entry
                     from prose `trap_analysis` (option unknown).
      * kp_tags    ← explicit solution.kp_tags if present; else the deduped
                     union of every kp_ref found in steps + distractors.
    """
    sol = solution if isinstance(solution, dict) else {}

    # Steps.
    steps: list[dict] = []
    authored = sol.get("solution_steps")
    if isinstance(authored, list) and authored:
        for step in authored:
            if not isinstance(step, dict):
                continue
            steps.append({
                "action":         step.get("action") or "confirm",
                "instruction_vi": str(step.get("instruction_vi") or "").strip(),
                "kp_refs":        [r for r in
                                   (norm_kp_ref(x) for x in step.get("kp_refs") or [])
                                   if r],
                "microcheck":     step.get("microcheck") if isinstance(step.get("microcheck"), dict) else None,
            })
    else:
        prose = str(sol.get("steps") or explanation or "").strip()
        if prose:
            steps.append({"action": "confirm", "instruction_vi": prose,
                          "kp_refs": [], "microcheck": None})

    # Distractors.
    distractors: list[dict] = []
    authored_d = sol.get("distractor_analysis")
    if isinstance(authored_d, list) and authored_d:
        for d in authored_d:
            if not isinstance(d, dict):
                continue
            distractors.append({
                "option":       str(d.get("option") or "").strip(),
                "why_wrong_vi": str(d.get("why_wrong_vi") or "").strip(),
                "kp_refs":      [r for r in
                                 (norm_kp_ref(x) for x in d.get("kp_refs") or [])
                                 if r],
            })
    elif str(sol.get("trap_analysis") or "").strip():
        distractors.append({"option": "", "why_wrong_vi": str(sol["trap_analysis"]).strip(),
                            "kp_refs": []})

    if not steps and not distractors:
        return None

    # kp_tags: explicit union wins, else derive.
    explicit_tags = [r for r in (norm_kp_ref(x) for x in sol.get("kp_tags") or []) if r]
    kp_tags = explicit_tags or collect_kp_tags(sol)

    return {
        "steps":          steps,
        "distractors":    distractors,
        "kp_tags":        kp_tags,
        # Passthrough context the stepper shows alongside (all optional).
        "source_excerpt": sol.get("source_excerpt"),
        "vocab":          sol.get("vocab") or [],
        "tips":           sol.get("tips"),
        "paraphrase":     sol.get("paraphrase"),
        "band":           sol.get("band"),
        "skill_code":     sol.get("skill_code"),
        "skill_name":     sol.get("skill_name"),
    }
