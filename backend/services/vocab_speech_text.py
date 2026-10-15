"""Plain speech input for Vocabulary display text; never alter the stored text."""
from __future__ import annotations

import re

_STRONG = re.compile(r"(\*\*|__)(?=\S)(.*?\S)\1", re.DOTALL)
_EMPHASIS = re.compile(r"(?<!\w)(\*|_)(?=\S)(.*?\S)\1(?!\w)", re.DOTALL)


def vocabulary_speech_text(text: str) -> str:
    """Remove paired display emphasis, preserving literal stars and identifiers.

    Kokoro pronounces asterisks as words. Cache identity and synthesis must both
    use this same text so recordings made from raw markup are not reused.
    """
    plain = _STRONG.sub(lambda match: match[2], text.strip())
    return _EMPHASIS.sub(lambda match: match[2], plain)
