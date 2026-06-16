"""mistake_authenticity.py — deterministic backend enforcement of the
mistakeAnalysis authenticity rule (P-2a).

The grading prompt (output_schema_instructions §6.1) tells the model to drop any
`mistakeAnalysis` entry where `original == suggestion` after Unicode
normalisation — a "flag" whose fix is identical to the original is not a real
correction. That rule was PROMPT-ONLY; this enforces it in the backend after the
model returns, before persist (no LanguageTool, doesn't trust the prompt).

Normalisation matches the rule's intent (§6.1) and NO MORE — gate #1 is "never
nuke a real correction":
  - NFC canonicalisation
  - fold Unicode VARIANTS of the same punctuation: curly/modifier apostrophes →
    ', smart/guillemet quotes → ", en/em/minus dashes → -
  - collapse internal whitespace runs to a single space + trim

It stays CASE-SENSITIVE and does NOT strip real punctuation, so genuine
corrections survive: "teh"→"The" (case), "its"→"it's" (apostrophe ADDED),
"cat"→"cats" (word), "a ,b"→"a, b" (space-around-punctuation).
"""
import re
import unicodedata

# Unicode variants of the SAME punctuation mark → one canonical form. Folding
# these is safe (a smart-quote vs straight-quote "fix" is not a real mistake);
# it never equates two DIFFERENT characters (so an added apostrophe still differs).
_PUNCT_VARIANTS = {
    "’": "'", "‘": "'", "ʼ": "'", "′": "'",   # apostrophes
    "“": '"', "”": '"', "„": '"',                   # double quotes
    "«": '"', "»": '"',                                  # guillemets
    "–": "-", "—": "-", "―": "-", "−": "-",    # en/em/horizontal/minus dashes
}
_WS_RE = re.compile(r"\s+")


def _norm(s) -> str:
    """Normalise for authenticity comparison: NFC → fold punctuation variants →
    collapse whitespace runs → trim. Case-sensitive; no real punctuation removed."""
    s = unicodedata.normalize("NFC", s or "")
    s = s.translate(str.maketrans(_PUNCT_VARIANTS))
    return _WS_RE.sub(" ", s).strip()


def is_noncorrection(original, suggestion) -> bool:
    """True when the mistake's fix is identical to the original after
    normalisation — i.e. not a real correction → should be dropped."""
    return _norm(original) == _norm(suggestion)


def drop_noncorrection_mistakes(mistakes):
    """Return (kept, dropped_count) for a list of MistakeAnalysis entries,
    removing every entry whose `original == suggestion` after normalisation.
    Tolerant of plain dicts or Pydantic models, and of missing fields."""
    if not mistakes:
        return ([] if mistakes is None else mistakes), 0

    def _field(m, name):
        if isinstance(m, dict):
            return m.get(name)
        return getattr(m, name, None)

    kept = [m for m in mistakes
            if not is_noncorrection(_field(m, "original"), _field(m, "suggestion"))]
    return kept, len(mistakes) - len(kept)
