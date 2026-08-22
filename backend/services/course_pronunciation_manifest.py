"""Canonical identity for a course pronunciation requirement and registered set."""

from __future__ import annotations

import hashlib
import json


def pronunciation_content_hash(
    *, sentences: list[str], locale: str, voice_engine: str, voice: str,
) -> str:
    """Hash only fields that determine the learner's reference-audio content."""
    canonical = {
        "locale": str(locale or "").strip(),
        "voice": str(voice or "").strip(),
        "voice_engine": str(voice_engine or "").strip(),
        "sentences": [str(text or "").strip() for text in sentences],
    }
    payload = json.dumps(
        canonical, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
