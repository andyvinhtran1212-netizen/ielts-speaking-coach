"""Idempotent STAGING import of a reviewed Writing prompt batch.

Source of truth: ``backend/content/writing_prompts/<batch>.json`` plus the
Task 1 Academic images next to it. The manifest is built from the approved
drafts (team content plan 2026-10-27, B3); this script only reconciles the
staging ``writing_prompts`` table with it.

Per item (matched by ``task_type`` + ``title``, then ``legacy_titles``, among
ACTIVE rows):
  • missing  → INSERT. New rows are held from the learner bank
               (``exam_only = true``) unless ``--visible`` is given; the
               Content Manager releases them with "Trả về thư viện".
  • present  → PATCH only the fields that differ (title, prompt_text,
               difficulty, tags). ``is_active`` / ``exam_only`` are never
               changed on an existing row: visibility belongs to the admin.
  • image    → compared by sha256 of the live object. A differing or missing
               image is uploaded through ``services.writing_prompt_image`` and
               the answer key is cleared exactly as the admin PATCH does, so it
               must be re-analysed and re-approved. Published objects are never
               deleted (essays snapshot their URL).
  • archived → an inactive row with the same title is reported and skipped,
               never resurrected or duplicated.
Task 2 items with ``replaces_seed`` retire (``is_active = false``) any ACTIVE
task2 row whose prompt_text is byte-identical to the 035 seed text. Such seed
rows never count as a title match for their replacement (the replacements keep
the 035 titles). Nothing is deleted or overwritten in place.

DRY RUN by default. ``--execute`` applies the plan and then re-plans from a
fresh read; anything left over is a failure (non-zero exit).

The target must be the staging project. Any other SUPABASE_URL is refused:
a production run needs its own approved change.

Usage
-----
    cd backend
    python -m scripts.import_writing_prompts                 # dry run
    python -m scripts.import_writing_prompts --execute       # apply on staging
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlparse

STAGING_PROJECT_REF = "zjphffoujxkpltixsbzj"
CONTENT_DIR = Path(__file__).resolve().parent.parent / "content" / "writing_prompts"
DEFAULT_MANIFEST = CONTENT_DIR / "2026-10-batch.json"

TASK_TYPES = ("task1_academic", "task1_general", "task2")
DIFFICULTIES = ("beginner", "intermediate", "advanced")
MAX_TAGS = 20
SYNCED_FIELDS = ("title", "prompt_text", "difficulty", "tags")
MIN_WORDS_LINE = {
    "task1_academic": "Write at least 150 words.",
    "task1_general": "Write at least 150 words.",
    "task2": "Write at least 250 words.",
}
REVIEW_STATUSES = ("approved", "needs_review")
_CJK_RE = re.compile(r"[぀-ヿ㐀-䶿一-鿿가-힯]")
# Same reset the admin PATCH applies when the chart identity changes.
ANALYSIS_CLEAR = {
    "prompt_image_analysis": None,
    "prompt_image_analysis_status": None,
    "prompt_image_analysis_reviewed": False,
    "prompt_image_analysis_model": None,
    "prompt_image_analysis_public_id": None,
    "prompt_image_analysis_error": None,
    "prompt_image_analysis_at": None,
}
LIVE_COLUMNS = (
    "id, task_type, title, prompt_text, difficulty, tags, is_active, "
    "exam_only, prompt_image_url, prompt_image_public_id"
)


# ── Manifest ──────────────────────────────────────────────────────────

def load_manifest(path: Path = DEFAULT_MANIFEST) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def validate_manifest(manifest: dict, root: Path = CONTENT_DIR) -> list[str]:
    """Every rule the admin API enforces, plus the batch's content checklist
    (team plan C3). Returns human-readable errors; empty means valid."""
    errors: list[str] = []
    if manifest.get("schema_version") != 1:
        errors.append("schema_version must be 1")
    items = manifest.get("items") or []
    if not items:
        errors.append("manifest has no items")
    seen_keys: set[str] = set()
    seen_titles: set[tuple[str, str]] = set()
    for item in items:
        key = item.get("key", "?")
        err = lambda msg: errors.append(f"{key}: {msg}")  # noqa: E731
        if key in seen_keys:
            err("duplicate key")
        seen_keys.add(key)
        task_type = item.get("task_type")
        if task_type not in TASK_TYPES:
            err(f"unknown task_type {task_type!r}")
            continue
        title = item.get("title") or ""
        if not 2 <= len(title) <= 200:
            err("title must be 2–200 characters")
        for t in [title, *item.get("legacy_titles", [])]:
            if (task_type, t) in seen_titles:
                err(f"title {t!r} is not unique within the batch")
            seen_titles.add((task_type, t))
        text = item.get("prompt_text") or ""
        if not 10 <= len(text) <= 5000:
            err("prompt_text must be 10–5000 characters")
        if MIN_WORDS_LINE[task_type] not in text:
            err(f"prompt_text lacks {MIN_WORDS_LINE[task_type]!r}")
        if text != text.strip() or "\r" in text:
            err("prompt_text has surrounding whitespace or CR line endings")
        if _CJK_RE.search(title + text):
            err("CJK characters in title or prompt_text")
        if item.get("difficulty") not in DIFFICULTIES:
            err(f"unknown difficulty {item.get('difficulty')!r}")
        tags = item.get("tags")
        if not isinstance(tags, list) or not all(isinstance(t, str) and t for t in tags):
            err("tags must be a list of non-empty strings")
        elif len(tags) > MAX_TAGS or len(set(tags)) != len(tags):
            err(f"tags must be unique and at most {MAX_TAGS}")
        review = item.get("review") or {}
        if review.get("status") not in REVIEW_STATUSES:
            err("review.status must be approved or needs_review")
        if task_type == "task1_academic":
            image = item.get("image")
            path = root / image if image else None
            if not path or not path.is_file():
                err(f"image file missing: {image!r}")
            elif hashlib.sha256(path.read_bytes()).hexdigest() != item.get("image_sha256"):
                err("image_sha256 does not match the file")
            elif not path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n"):
                err("image must be a PNG")
            data = item.get("source_data") or {}
            if not data.get("columns") or not data.get("rows"):
                err("source_data table is required for Task 1 Academic")
            elif any(len(r) != len(data["columns"]) for r in data["rows"]):
                err("source_data rows do not match the column count")
            if not item.get("answer_key_draft"):
                err("answer_key_draft is required for Task 1 Academic")
        elif item.get("image"):
            err("only task1_academic may carry an image")
        seed = item.get("replaces_seed")
        if seed is not None and (task_type != "task2" or not seed.get("prompt_text")):
            err("replaces_seed is only valid on task2 items and needs the seed prompt_text")
    return errors


# ── Planning (pure) ───────────────────────────────────────────────────

@dataclass
class Action:
    key: str
    kind: str                       # create | update | unchanged | skip_archived | retire_seed | error
    prompt_id: Optional[str] = None
    changes: dict = field(default_factory=dict)
    upload_image: bool = False
    detail: str = ""


def _image_sha(row: dict, fetch_bytes: Callable[[str], Optional[bytes]]) -> Optional[str]:
    url = row.get("prompt_image_url")
    if not url:
        return None
    data = fetch_bytes(url)
    return hashlib.sha256(data).hexdigest() if data is not None else None


def plan_import(manifest: dict, live_rows: list[dict],
                fetch_bytes: Callable[[str], Optional[bytes]]) -> list[Action]:
    """Diff the manifest against the live table. Does not write."""
    # The replacements keep their 035 titles. A row still holding the original
    # seed text is the seed itself, never the replacement: matching it by title
    # would rewrite it and then retire it below, leaving no active prompt.
    seed_texts = {i["replaces_seed"]["prompt_text"]
                  for i in manifest["items"] if i.get("replaces_seed")}
    active: dict[tuple[str, str], list[dict]] = {}
    inactive: dict[tuple[str, str], list[dict]] = {}
    for row in live_rows:
        if row["task_type"] == "task2" and row.get("prompt_text") in seed_texts:
            continue
        bucket = active if row.get("is_active") else inactive
        bucket.setdefault((row["task_type"], row["title"]), []).append(row)

    actions: list[Action] = []
    for item in manifest["items"]:
        key, task_type = item["key"], item["task_type"]
        titles = [item["title"], *item.get("legacy_titles", [])]
        matches = [r for t in titles for r in active.get((task_type, t), [])]
        if len(matches) > 1:
            actions.append(Action(key, "error", detail=(
                f"{len(matches)} active rows match {titles!r}: "
                + ", ".join(r["id"] for r in matches))))
            continue
        if not matches:
            archived = [r for t in titles for r in inactive.get((task_type, t), [])]
            if archived:
                actions.append(Action(key, "skip_archived", archived[0]["id"],
                                      detail="an archived row has this title; restore it in admin if intended"))
            else:
                actions.append(Action(key, "create", upload_image=bool(item.get("image"))))
        else:
            row = matches[0]
            changes = {f: item[f] for f in SYNCED_FIELDS if row.get(f) != item[f]}
            upload = bool(item.get("image")) and _image_sha(row, fetch_bytes) != item["image_sha256"]
            kind = "update" if changes or upload else "unchanged"
            actions.append(Action(key, kind, row["id"], changes, upload))

        # Retire the old seed only once its replacement exists or is being created.
        seed = item.get("replaces_seed")
        if seed and actions[-1].kind in ("create", "update", "unchanged"):
            for row in live_rows:
                if (row.get("is_active") and row["task_type"] == "task2"
                        and row.get("prompt_text") == seed["prompt_text"]):
                    actions.append(Action(key, "retire_seed", row["id"],
                                          {"is_active": False},
                                          detail=f"035 seed #{seed.get('position')}"))
    return actions


def summarize(actions: list[Action]) -> dict[str, int]:
    out: dict[str, int] = {}
    for a in actions:
        out[a.kind] = out.get(a.kind, 0) + 1
    return out


# ── Apply ─────────────────────────────────────────────────────────────

class Store:
    """Thin seam over the service-role client so the plan/apply logic is testable."""

    def list_prompts(self) -> list[dict]:
        from database import supabase_admin
        rows: list[dict] = []
        start = 0
        while True:
            page = (supabase_admin.table("writing_prompts").select(LIVE_COLUMNS)
                    .order("created_at").range(start, start + 999).execute()).data or []
            rows.extend(page)
            if len(page) < 1000:
                return rows
            start += 1000

    def insert(self, row: dict) -> dict:
        from database import supabase_admin
        return supabase_admin.table("writing_prompts").insert(row).execute().data[0]

    def update(self, prompt_id: str, patch: dict) -> dict:
        from database import supabase_admin
        r = supabase_admin.table("writing_prompts").update(patch).eq("id", prompt_id).execute()
        if not r.data:
            raise RuntimeError(f"update matched no row: {prompt_id}")
        return r.data[0]

    def upload_image(self, data: bytes, name: str) -> dict:
        from services.writing_prompt_image import upload_prompt_image
        return upload_prompt_image(data, name)

    def fetch_bytes(self, url: str) -> Optional[bytes]:
        import httpx
        r = httpx.get(url, timeout=30, follow_redirects=True)
        return r.content if r.status_code == 200 else None


def apply_plan(store, manifest: dict, actions: list[Action], *, visible: bool = False,
               root: Path = CONTENT_DIR, progress=print) -> None:
    items = {i["key"]: i for i in manifest["items"]}
    for a in actions:
        item = items[a.key]
        if a.kind in ("unchanged", "skip_archived"):
            continue
        if a.kind == "retire_seed":
            store.update(a.prompt_id, {"is_active": False})
            progress(f"RETIRED {a.prompt_id} ({a.detail}) for {a.key}")
            continue
        image_patch: dict = {}
        if a.upload_image:
            uploaded = store.upload_image((root / item["image"]).read_bytes(),
                                          Path(item["image"]).name)
            image_patch = {"prompt_image_url": uploaded["url"],
                           "prompt_image_public_id": uploaded["public_id"],
                           **ANALYSIS_CLEAR}
        if a.kind == "create":
            row = store.insert({
                **{f: item[f] for f in SYNCED_FIELDS},
                "task_type": item["task_type"],
                "is_active": True,
                "exam_only": not visible,
                **image_patch,
            })
            progress(f"CREATED {a.key} → {row['id']}"
                     + ("" if visible else " (held: exam_only=true)"))
        elif a.kind == "update":
            store.update(a.prompt_id, {**a.changes, **image_patch})
            progress(f"UPDATED {a.key} {a.prompt_id}: "
                     + ", ".join([*a.changes, *(["image"] if image_patch else [])]))


def run(store, manifest: dict, *, execute: bool, visible: bool = False,
        root: Path = CONTENT_DIR, progress=print) -> int:
    errors = validate_manifest(manifest, root)
    if errors:
        for e in errors:
            progress(f"INVALID {e}")
        return 2
    actions = plan_import(manifest, store.list_prompts(), store.fetch_bytes)
    for a in actions:
        what = ", ".join([*a.changes, *(["image"] if a.upload_image else [])])
        progress(f"PLAN {a.key}: {a.kind}"
                 + (f" {a.prompt_id}" if a.prompt_id else "")
                 + (f" [{what}]" if what else "")
                 + (f" — {a.detail}" if a.detail else ""))
    progress(f"SUMMARY {json.dumps(summarize(actions), sort_keys=True)}")
    if any(a.kind == "error" for a in actions):
        progress("ABORT: ambiguous matches; nothing written")
        return 3
    if not execute:
        progress("DRY RUN: nothing written (pass --execute to apply)")
        return 0
    apply_plan(store, manifest, actions, visible=visible, root=root, progress=progress)
    leftover = [a for a in plan_import(manifest, store.list_prompts(), store.fetch_bytes)
                if a.kind not in ("unchanged", "skip_archived")]
    if leftover:
        for a in leftover:
            progress(f"READBACK MISMATCH {a.key}: {a.kind}")
        return 4
    progress("READBACK OK: every item matches the manifest")
    return 0


def assert_staging(url: str) -> None:
    host = urlparse(url or "").netloc
    if host != f"{STAGING_PROJECT_REF}.supabase.co":
        raise SystemExit(f"Refusing to run: SUPABASE_URL host {host or '(unset)'!r} is not staging")


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--execute", action="store_true", help="apply the plan (default: dry run)")
    parser.add_argument("--visible", action="store_true",
                        help="create new rows visible in the learner bank (default: held)")
    args = parser.parse_args(argv)

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    from scripts._script_env import load_env
    load_env()
    import os
    assert_staging(os.getenv("SUPABASE_URL", ""))
    from config import settings
    assert_staging(settings.SUPABASE_URL)
    manifest = load_manifest(args.manifest)
    return run(Store(), manifest, execute=args.execute, visible=args.visible,
               root=args.manifest.parent)


if __name__ == "__main__":
    raise SystemExit(main())
