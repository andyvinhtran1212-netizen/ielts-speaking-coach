"""backend/eval/gold_loader.py — load the gold set for the eval harness.

Two sources:
  * "db"      — the gold_speaking / gold_writing tables (migration 144), via the
                service-role client. This is the real path.
  * "fixture" — a local JSON file (eval/fixtures/*.json). Lets the harness +
                run.py smoke-test offline with no DB and no LLM keys, and gives
                tests a deterministic corpus.

Both yield the same normalized dataclass, so run.py doesn't care which was used.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

_FIXTURE_DIR = Path(__file__).parent / "fixtures"


@dataclass
class GoldSpeakingItem:
    id: str
    question: str
    transcript: str
    part: int
    ref: dict            # {"fc","lr","gra","p"(opt),"overall"} — human reference
    rater_bands: list = field(default_factory=list)
    audio_path: str | None = None
    band_bucket: str | None = None
    tags: list = field(default_factory=list)


@dataclass
class GoldWritingItem:
    id: str
    task_type: str
    prompt_text: str
    essay_text: str
    ref: dict            # {"tr","cc","lr","gra","overall"}
    analysis_level: int | None = None
    prompt_image_url: str | None = None
    rater_bands: list = field(default_factory=list)
    band_bucket: str | None = None
    tags: list = field(default_factory=list)


# ── Speaking ──────────────────────────────────────────────────────────────────

def _speaking_from_row(r: dict) -> GoldSpeakingItem:
    return GoldSpeakingItem(
        id=str(r["id"]),
        question=r["question"],
        transcript=r["transcript"],
        part=int(r["part"]),
        ref={
            "fc": _f(r.get("ref_band_fc")),
            "lr": _f(r.get("ref_band_lr")),
            "gra": _f(r.get("ref_band_gra")),
            "p": _f(r.get("ref_band_p")),
            "overall": _f(r.get("ref_overall")),
        },
        rater_bands=r.get("rater_bands") or [],
        audio_path=r.get("audio_path"),
        band_bucket=r.get("band_bucket"),
        tags=r.get("tags") or [],
    )


def load_speaking_gold(source: str = "db", fixture: str | Path | None = None) -> list[GoldSpeakingItem]:
    if source == "fixture":
        path = Path(fixture) if fixture else _FIXTURE_DIR / "gold_speaking.sample.json"
        return [_speaking_from_row(r) for r in _read_json(path)]
    rows = _fetch_all("gold_speaking")
    return [_speaking_from_row(r) for r in rows]


# ── Writing ───────────────────────────────────────────────────────────────────

def _writing_from_row(r: dict) -> GoldWritingItem:
    return GoldWritingItem(
        id=str(r["id"]),
        task_type=r["task_type"],
        prompt_text=r["prompt_text"],
        essay_text=r["essay_text"],
        ref={
            "tr": _f(r.get("ref_band_tr")),
            "cc": _f(r.get("ref_band_cc")),
            "lr": _f(r.get("ref_band_lr")),
            "gra": _f(r.get("ref_band_gra")),
            "overall": _f(r.get("ref_overall")),
        },
        analysis_level=(int(r["analysis_level"]) if r.get("analysis_level") is not None else None),
        prompt_image_url=r.get("prompt_image_url"),
        rater_bands=r.get("rater_bands") or [],
        band_bucket=r.get("band_bucket"),
        tags=r.get("tags") or [],
    )


def load_writing_gold(source: str = "db", fixture: str | Path | None = None) -> list[GoldWritingItem]:
    if source == "fixture":
        path = Path(fixture) if fixture else _FIXTURE_DIR / "gold_writing.sample.json"
        return [_writing_from_row(r) for r in _read_json(path)]
    rows = _fetch_all("gold_writing")
    return [_writing_from_row(r) for r in rows]


# ── helpers ───────────────────────────────────────────────────────────────────

def _f(v) -> float | None:
    return float(v) if v is not None else None


def _read_json(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(
            f"Gold-set fixture not found: {path}. Point --fixture at a JSON list "
            f"of rows, or use --source db."
        )
    return json.loads(path.read_text(encoding="utf-8"))


def _fetch_all(table: str) -> list[dict]:
    """Service-role read of the whole gold table. Imported lazily so the module
    (and its fixture path) works with no DB / Supabase env configured."""
    from database import supabase_admin  # lazy: avoids import-time DB coupling

    rows: list[dict] = []
    page = 0
    size = 1000  # PostgREST hard cap — paginate (see vocab 1000-row-cap lesson)
    while True:
        resp = (
            supabase_admin.table(table)
            .select("*")
            .range(page * size, page * size + size - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < size:
            break
        page += 1
    return rows
