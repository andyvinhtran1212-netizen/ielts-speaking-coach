"""
services/lemmatizer.py — Sprint 10.1 server-side lemmatization.

Public surface:

    lemma, pos = lemmatize("running")        # ("run", "VERB")
    lemma, pos = lemmatize("ran")            # ("run", "VERB")
    lemma, pos = lemmatize("data")           # ("data", "NOUN")
    lemma, pos = lemmatize("kick the bucket")  # ("kick the bucket", "VERB")

    v = lemma_version()                        # current rule-set version

Implementation notes:

  - **Lazy singleton.** spaCy `en_core_web_sm` is ~12 MB on disk and
    ~30 MB in memory. Loading at module-import would pay the cost on
    every uvicorn worker start, including workers that never see a
    vocab capture (e.g. admin-only requests). The first call to
    `lemmatize()` loads the model; subsequent calls reuse the
    singleton. A threading.Lock guards the double-checked init so two
    concurrent first-callers don't race.

  - **Disabled pipeline components.** We only need lemma + POS, so
    parser and NER are disabled at load time — saves ~15 MB RAM and
    cuts per-call latency roughly in half.

  - **Multi-word handling.** spaCy lemmatizes per-token. Idioms like
    "kick the bucket" lose their semantic identity if we collapse to
    "kick" / "bucket" — so for any input with whitespace we return
    the **surface form unchanged** as the lemma and the POS of the
    first content-bearing token. This is intentional: multi-word
    expressions are treated as their own lemma; Guard 6's existing
    semantic-cluster + Levenshtein fallbacks still catch
    paraphrase-level near-duplicates.

  - **POS taxonomy.** Returns spaCy's universal-POS tag (`VERB`,
    `NOUN`, `ADJ`, `ADV`, …). The DB column is just TEXT — no CHECK
    constraint — so future tag-set changes are forward-compatible.

  - **Failure mode.** If spaCy can't load the model (e.g. CI image
    lacks `en_core_web_sm`), we surface the ImportError up to the
    caller rather than silently returning the surface form. Capture
    pipeline catches and logs; backfill aborts loudly so the operator
    fixes the install instead of populating every row with NULL
    lemma.

  - **Versioning.** `lemma_version()` returns the integer that gets
    stored on each row at insert time. Bump this when the lemmatizer
    semantics change in a way that warrants re-walking existing rows
    (spaCy upgrade, custom rule additions, idiom-handling tweaks).
    The backfill script (scripts/backfill_lemma.py) compares stored
    `lemma_version` against the current value and re-processes any
    row whose version is older.
"""

from __future__ import annotations

import logging
import threading
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Double-checked singleton.
_nlp = None
_lock = threading.Lock()

# Sprint 12.6 — manual overrides. Loaded lazily on first lemmatize() call
# and refreshed via reload_overrides() when admins mutate the table. The
# default empty dict means "no overrides" so unit tests that don't touch
# Supabase keep working as-is.
_overrides: dict[str, Tuple[str, Optional[str]]] = {}
_overrides_loaded = False
_overrides_lock = threading.Lock()

# Sprint 10.1 fix — built-in irregular NOUN lemmas that spaCy's small model
# (`en_core_web_sm`) fails to reduce. These are unambiguous Greek/Latin
# plurals; the sm model returns the plural surface form unchanged
# (e.g. "phenomena" → "phenomena" instead of "phenomenon"). Applied AFTER
# the admin DB overrides (those still win) but BEFORE spaCy, so the result
# is deterministic and independent of the installed model version. Keep this
# list conservative — only forms whose singular is unambiguous (NOT mass-ish
# nouns like "data"/"media" which the codebase intentionally leaves as-is).
_IRREGULAR_LEMMAS: dict[str, str] = {
    "phenomena": "phenomenon",
    "criteria": "criterion",
}


def _load_overrides() -> None:
    """Populate `_overrides` from the lemma_overrides table.

    Called lazily on the first lemmatize() invocation, and explicitly
    via reload_overrides() after an admin mutation. Read failures
    (table missing in a fresh test env, Supabase outage) degrade
    silently to "no overrides" — the spaCy fallback still works.
    """
    global _overrides, _overrides_loaded
    try:
        from supabase_client import supabase_admin
    except ImportError:
        _overrides_loaded = True
        return

    try:
        res = (
            supabase_admin.table("lemma_overrides")
            .select("original_word, lemma, pos_tag")
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        logger.warning("[lemmatizer] could not load overrides: %s", exc)
        _overrides_loaded = True
        return

    fresh: dict[str, Tuple[str, Optional[str]]] = {}
    for row in rows:
        word = (row.get("original_word") or "").strip().lower()
        lemma = row.get("lemma")
        if not word or not lemma:
            continue
        fresh[word] = (lemma, row.get("pos_tag"))
    _overrides = fresh
    _overrides_loaded = True
    logger.info("[lemmatizer] loaded %d manual overrides", len(fresh))


def reload_overrides() -> None:
    """Force-refresh the override cache.

    Admin endpoints call this after INSERT/DELETE on lemma_overrides so
    the running worker honours the change without a restart.
    """
    global _overrides_loaded
    with _overrides_lock:
        _overrides_loaded = False
        _load_overrides()


def _lookup_override(surface_lower: str) -> Optional[Tuple[str, Optional[str]]]:
    """Return the override tuple for `surface_lower`, or None."""
    global _overrides_loaded
    if not _overrides_loaded:
        with _overrides_lock:
            if not _overrides_loaded:
                _load_overrides()
    return _overrides.get(surface_lower)


def _get_nlp():
    """Return the loaded spaCy pipeline, loading it lazily on first call.

    Imports `spacy` only when the function is invoked so a stripped
    test environment without spaCy installed can still import the
    rest of the codebase (tests that exercise the loader use
    monkeypatch to inject a stub).
    """
    global _nlp
    if _nlp is None:
        with _lock:
            if _nlp is None:
                import spacy  # lazy import — Railway cold-start mitigation
                _nlp = spacy.load(
                    "en_core_web_sm",
                    disable=["parser", "ner"],
                )
                logger.info("[lemmatizer] loaded en_core_web_sm (parser+ner disabled)")
    return _nlp


def lemmatize(surface_form: str) -> Tuple[str, str]:
    """Return (lemma, pos) for a single headword.

    Whitespace-trimmed and lowercased before tokenisation. Multi-word
    inputs are returned as-is with the POS of the first content token.
    Empty inputs fall through to ("", "NOUN") — caller should validate
    upstream but we won't raise.
    """
    if not surface_form:
        return "", "NOUN"

    cleaned = surface_form.strip().lower()
    if not cleaned:
        return "", "NOUN"

    # Sprint 12.6 — manual overrides take precedence over spaCy. POS may
    # be NULL in the override row, in which case we still run spaCy to
    # classify (lemma stays overridden, POS comes from the model).
    override = _lookup_override(cleaned)
    if override is not None:
        lemma_override, pos_override = override
        if pos_override:
            return lemma_override, pos_override
        # Fall through to spaCy just for POS classification.
        try:
            nlp = _get_nlp()
            doc = nlp(cleaned)
            if len(doc) > 0:
                first = next(
                    (t for t in doc if not t.is_stop and not t.is_punct),
                    doc[0],
                )
                return lemma_override, first.pos_
        except Exception:
            pass
        return lemma_override, "NOUN"

    # Built-in irregular NOUN lemmas (Greek/Latin plurals spaCy sm misses).
    # Single-word only — multi-word inputs never key into this map. Admin
    # overrides above take precedence; this runs before spaCy so the output
    # is deterministic regardless of the installed model version.
    irregular = _IRREGULAR_LEMMAS.get(cleaned)
    if irregular is not None:
        return irregular, "NOUN"

    nlp = _get_nlp()
    doc = nlp(cleaned)

    if len(doc) == 0:
        return cleaned, "NOUN"

    # Multi-word expression: preserve the surface form as the lemma.
    # See module docstring — idioms must not be split per-token.
    if " " in cleaned:
        first_content = next(
            (t for t in doc if not t.is_stop and not t.is_punct),
            doc[0],
        )
        return cleaned, first_content.pos_

    # Single-word path — return spaCy's lemma + POS for the only token.
    token = doc[0]
    return token.lemma_, token.pos_


def lemma_version() -> int:
    """Schema-side rule-set version for the lemmatizer.

    Bump when:
      - spaCy model upgrades to a new major version
      - we add custom token rules that change historical output
      - idiom / multi-word handling changes meaningfully

    The backfill script (scripts/backfill_lemma.py) re-walks any row
    whose stored `lemma_version` is below this value. Bumping is
    expensive (re-processes every alive row) so do it deliberately.

    v2 — added `_IRREGULAR_LEMMAS` (phenomena→phenomenon, criteria→
    criterion). Rows lemmatized under v1 that stored the plural surface
    form get corrected on the next backfill run.
    """
    return 2
