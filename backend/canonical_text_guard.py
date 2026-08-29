"""Fail-fast guards for idempotent canonical text verification."""

from __future__ import annotations

import re


def replace_expected(text: str, legacy: str, canonical: str, label: str) -> str:
    """Replace one known legacy fragment or accept one canonical fragment.

    Any other state is unknown content drift and must be reviewed manually rather
    than silently passing an idempotent verifier.
    """
    legacy_count = text.count(legacy)
    canonical_count = text.count(canonical)
    if legacy_count == 1 and canonical_count == 0:
        result = text.replace(legacy, canonical)
    elif legacy_count == 0 and canonical_count == 1:
        result = text
    else:
        raise RuntimeError(
            f"{label}: expected exactly one legacy or canonical fragment; "
            f"found legacy={legacy_count}, canonical={canonical_count}"
        )

    if legacy in result or result.count(canonical) != 1:
        raise RuntimeError(f"{label}: canonical replacement verification failed")
    return result


def strip_known_note(text: str, pattern: str, marker: str, label: str) -> str:
    """Remove one known generated note, accept its absence, reject malformed drift."""
    matches = re.findall(pattern, text)
    if len(matches) > 1:
        raise RuntimeError(f"{label}: found duplicate generated notes")
    result = re.sub(pattern, "", text).strip()
    if marker in result:
        raise RuntimeError(f"{label}: found an unrecognised generated-note fragment")
    if not result:
        raise RuntimeError(f"{label}: canonical text is empty")
    return result
