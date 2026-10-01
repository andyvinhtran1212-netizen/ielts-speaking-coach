"""Explicit lexical-v2 policy; no legacy caller is switched by importing this.

Offsets are zero-based, half-open Python Unicode code-point offsets, not UTF-16
JavaScript offsets. Exhaustive segments reconstruct the exact original text.
Only unambiguous outer shells are separated; ambiguous syntax retains its
baseline lexical text and a review signal instead of permissive stripping.
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

from services.dictation_unicode15 import is_lexical_alnum, is_word_combining


LEXICAL_POLICY_VERSION = "lexical-v2"
OFFSET_UNIT = "unicode_codepoint"
_DASHES = frozenset("\u2013\u2014")
_TERMINAL_PUNCTUATION = frozenset(".,!?;:¿¡…")
_OPEN_TO_CLOSE = {"(": ")", "[": "]", "{": "}", "“": "”", "‘": "’", '"': '"', "'": "'"}
_OPEN_MARKS = frozenset(_OPEN_TO_CLOSE)
_CLOSE_MARKS = frozenset(_OPEN_TO_CLOSE.values())
_APOSTROPHES = frozenset("'‘’")
_ELISIONS = frozenset({"cause", "em", "tis", "twas", "bout", "round", "til"})


class InvalidLexicalReference(ValueError):
    """The reference has no lexical words; it cannot produce a completed grade."""


class PolicyAlignmentError(RuntimeError):
    """Compatibility alignment no longer maps bijectively to lexical spans."""


@dataclass(frozen=True)
class Segment:
    kind: Literal["lexical", "unscored", "whitespace"]
    start: int
    end: int
    raw: str
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "start": self.start, "end": self.end,
                "raw": self.raw, "reason": self.reason}


@dataclass(frozen=True)
class Ambiguity:
    start: int
    end: int
    reason: str

    def as_dict(self) -> dict[str, Any]:
        return {"start": self.start, "end": self.end, "reason": self.reason}


@dataclass(frozen=True)
class Tokenization:
    raw: str
    segments: tuple[Segment, ...]
    ambiguities: tuple[Ambiguity, ...]

    @property
    def lexical(self) -> tuple[Segment, ...]:
        return tuple(segment for segment in self.segments if segment.kind == "lexical")

    @property
    def lexical_indices(self) -> tuple[int, ...]:
        return tuple(index for index, segment in enumerate(self.segments) if segment.kind == "lexical")


def _word_character(character: str) -> bool:
    return is_lexical_alnum(character) or is_word_combining(character)


def _opens_at_boundary(text: str, position: int) -> bool:
    return (position == 0 or text[position - 1].isspace()
            or text[position - 1] in _DASHES or text[position - 1] in _OPEN_MARKS)


def _closes_at_boundary(text: str, position: int) -> bool:
    # A comma followed by another word is not an outer token boundary:
    # '(hello),world' must not become two inferred lexical words.
    after = position + 1
    while after < len(text) and text[after] in (_CLOSE_MARKS | _TERMINAL_PUNCTUATION):
        after += 1
    return after == len(text) or text[after].isspace() or text[after] in _DASHES


def _unpaired_known_elision(text: str, position: int) -> bool:
    if text[position] not in "'’" or not _opens_at_boundary(text, position):
        return False
    end = position + 1
    while end < len(text) and _word_character(text[end]):
        end += 1
    word = text[position + 1:end].casefold()
    return word in _ELISIONS and (end == len(text) or text[end] not in "'’")


def _shell_marks(text: str) -> tuple[dict[int, str], tuple[Ambiguity, ...]]:
    """Match typed outer pairs, with conservative invalidation on ambiguity."""
    # Embedded brackets are opaque frames, not shell candidates. Tracking
    # their balanced structure prevents the ')' in “foo(bar)” from crossing
    # the outer quote while keeping foo(bar) as one unchanged lexical token.
    stack: list[tuple[str, int, bool]] = []
    pairs: list[tuple[int, int]] = []
    non_shell_ranges: list[tuple[int, int]] = []
    ambiguities: list[Ambiguity] = []
    protected_elisions: list[int] = []
    closed_single_quotes: dict[str, list[int]] = {"'": [], "’": []}
    for position, character in enumerate(text):
        if character not in _OPEN_MARKS | _CLOSE_MARKS:
            continue
        if (character in _APOSTROPHES and 0 < position < len(text) - 1
                and _word_character(text[position - 1]) and _word_character(text[position + 1])):
            continue  # don't / John's / decomposed-letter contractions
        if _unpaired_known_elision(text, position):
            protected_elisions.append(position)
            continue
        opens = character in _OPEN_MARKS and _opens_at_boundary(text, position)
        closes = character in _CLOSE_MARKS and _closes_at_boundary(text, position)
        matching_close = stack and _OPEN_TO_CLOSE[stack[-1][0]] == character
        if matching_close and (closes or character in ")]}"):
            opener, start, eligible = stack.pop()
            if eligible and closes and all(frame[2] for frame in stack):
                pairs.append((start, position))
                if opener in "'‘":
                    closed_single_quotes[character].append(start)
            else:
                non_shell_ranges.append((start, position + 1))
            continue
        if opens or character in "([{":
            # Reusing the same symmetric quote inside itself is structurally
            # ambiguous. Alternate quote types or authored escapes are needed.
            if character in "\"'" and any(frame[0] == character for frame in stack):
                ambiguities.append(Ambiguity(stack[0][1], len(text), "ambiguous_quote_nesting"))
            stack.append((character, position, opens and all(frame[2] for frame in stack)))
        elif character in ")]}":
            start = stack[0][1] if stack else position
            ambiguities.append(Ambiguity(start, position + 1, "unmatched_or_crossed_bracket"))
            stack.clear()
        elif closes and character not in _APOSTROPHES:
            ambiguities.append(Ambiguity(position, position + 1, "unmatched_quote"))
        elif closes and character in "'’" and protected_elisions:
            # 'cause we left' may be an elision plus trailing apostrophe or an
            # authored quotation spanning words. Neither interpretation is
            # safe to strip. A normal paired 'hello' after 'cause is handled
            # by its own stack frame above and does not trigger this signal.
            ambiguities.append(Ambiguity(protected_elisions[0], position + 1,
                                         "ambiguous_elision_shell"))
        elif closes and character in "'’" and closed_single_quotes[character]:
            # In 'parents' anniversary' the first apparent closing quote may
            # be a plural-possessive apostrophe inside a larger quotation.
            # Keeping a previously stripped pair would erase that lexical
            # distinction. Three same-type marks are not unambiguous shells.
            ambiguities.append(Ambiguity(closed_single_quotes[character][0], position + 1,
                                         "ambiguous_possessive_shell"))
        # An unpaired apostrophe remains lexical text (e.g. parents'). Never
        # infer a closing shell from an apostrophe belonging to another type.
    for opener, start, eligible in stack:
        ambiguities.append(Ambiguity(start, len(text), "unpaired_outer_shell"))

    # Do not strip a valid-looking inner pair inside an unresolved outer shell.
    valid_pairs = [(start, end) for start, end in pairs
                   if not any(start < ambiguity.end and end + 1 > ambiguity.start
                              for ambiguity in ambiguities)
                   and not any(start >= opaque_start and end < opaque_end
                               for opaque_start, opaque_end in non_shell_ranges)]
    marks = {position: reason for start, end in valid_pairs
             for position, reason in ((start, "paired_shell_open"), (end, "paired_shell_close"))}
    unique = {(ambiguity.start, ambiguity.end, ambiguity.reason): ambiguity for ambiguity in ambiguities}
    return marks, tuple(unique[key] for key in sorted(unique))


def tokenize_lexical(text: str) -> Tokenization:
    """Return exact text spans and its eligible lexical sequence, without I/O."""
    if not isinstance(text, str):
        raise TypeError("Dictation text must be a string")
    shell_marks, ambiguities = _shell_marks(text)
    segments: list[Segment] = []
    position = 0
    while position < len(text):
        start = position
        character = text[position]
        if character.isspace():
            position += 1
            while position < len(text) and text[position].isspace():
                position += 1
            kind, reason = "whitespace", "source_whitespace"
        elif position in shell_marks:
            position += 1
            kind, reason = "unscored", shell_marks[start]
        elif character in _DASHES:
            position += 1
            kind, reason = "unscored", "dash_separator"
        else:
            position += 1
            while (position < len(text) and not text[position].isspace()
                   and text[position] not in _DASHES and position not in shell_marks):
                position += 1
            normalized = unicodedata.normalize("NFC", text[start:position])
            kind = "lexical" if any(is_lexical_alnum(character) for character in normalized) else "unscored"
            reason = "lexical_text" if kind == "lexical" else "punctuation_or_symbol"
        segments.append(Segment(kind, start, position, text[start:position], reason))
    return Tokenization(text, tuple(segments), ambiguities)


def _span(segment: Segment, index: int) -> dict[str, int]:
    return {"segment_index": index, "start": segment.start, "end": segment.end}


def grade_lexical(*, reference_transcript: str, user_transcript: str,
                  ignore_fillers: bool = False) -> dict[str, Any]:
    """Grade only lexical segments with existing equality/LCS/filler semantics.

    Import the compatibility scorer lazily to avoid a new module-import cycle
    when an explicit version dispatcher is added. This does not change any
    default/legacy caller. Unresolved shells retain baseline text plus review
    signals; callers must honor reference ambiguities in author/release gates.
    """
    reference = tokenize_lexical(reference_transcript)
    actual = tokenize_lexical(user_transcript)
    expected_words, actual_words = reference.lexical, actual.lexical
    if not expected_words:
        raise InvalidLexicalReference("The reference contains no lexical words")
    from services.listening_grader import grade_dictation
    result = grade_dictation(
        reference_transcript=" ".join(segment.raw for segment in expected_words),
        user_transcript=" ".join(segment.raw for segment in actual_words),
        ignore_fillers=ignore_fillers,
    )
    expected_indices, actual_indices = reference.lexical_indices, actual.lexical_indices
    expected_cursor = actual_cursor = 0
    remapped = []
    for operation in result["diff"]:
        mapped = {**operation, "expected_span": None, "actual_span": None}
        if operation["expected"] is not None:
            if (expected_cursor >= len(expected_words)
                    or operation["expected"] != expected_words[expected_cursor].raw):
                raise PolicyAlignmentError("Expected lexical alignment does not match source spans")
            mapped["expected_span"] = _span(expected_words[expected_cursor], expected_indices[expected_cursor])
            expected_cursor += 1
        if operation["actual"] is not None:
            if (actual_cursor >= len(actual_words)
                    or operation["actual"] != actual_words[actual_cursor].raw):
                raise PolicyAlignmentError("Actual lexical alignment does not match source spans")
            mapped["actual_span"] = _span(actual_words[actual_cursor], actual_indices[actual_cursor])
            actual_cursor += 1
        remapped.append(mapped)
    if expected_cursor != len(expected_words) or actual_cursor != len(actual_words):
        raise PolicyAlignmentError("Lexical alignment failed to consume every source/user span")
    return {
        **result, "diff": remapped,
        "grading_version": LEXICAL_POLICY_VERSION, "offset_unit": OFFSET_UNIT,
        "reference": reference.raw, "user_text": actual.raw,
        "reference_segments": [segment.as_dict() for segment in reference.segments],
        "user_segments": [segment.as_dict() for segment in actual.segments],
        "reference_ambiguities": [item.as_dict() for item in reference.ambiguities],
        "user_ambiguities": [item.as_dict() for item in actual.ambiguities],
    }
