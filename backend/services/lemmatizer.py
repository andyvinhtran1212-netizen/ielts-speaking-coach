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
from typing import Tuple

logger = logging.getLogger(__name__)

# Double-checked singleton.
_nlp = None
_lock = threading.Lock()


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
    """
    return 1
