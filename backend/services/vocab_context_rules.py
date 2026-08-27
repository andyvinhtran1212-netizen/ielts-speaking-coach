"""Pure identity rules for curated links from authored learning surfaces."""

from __future__ import annotations

import re
import unicodedata

_WHITESPACE = re.compile(r"\s+")


def normalize_context_term(value: str) -> str:
    """Return the exact-match identity used by seed validation and lookup.

    NFKC collapses compatibility variants, casefold removes case differences,
    and whitespace collapse handles harmless authoring differences. Punctuation
    and word order remain significant: this function never performs fuzzy or
    lexical expansion.
    """
    if not isinstance(value, str):
        return ""
    folded = unicodedata.normalize("NFKC", value).casefold()
    return _WHITESPACE.sub(" ", folded).strip()
