"""M3 Slice-1 — MIGRATE-IN the markdown vocab words into the vocab_cards table.

Reads every backend/content_vocab/**/*.md file, parses + validates it with the
SAME importer the admin upload uses (services.vocab_import) and matches it to a
vocab_cards row by (category, slug). The content body's first paragraph becomes
gloss_vi (stored, not re-derived).

DRY RUN by default: it only reads vocab_cards and prints, per file, what a
commit would do. Nothing is written without --commit.

    cd backend && python -m scripts.migrate_vocab_to_cards            # dry run
    cd backend && python -m scripts.migrate_vocab_to_cards --commit   # write

Per file the plan is one of:
  * insert    — no row for (category, slug): the full importer payload is
                inserted (topic_id resolved from the category at commit time).
  * update    — the row exists: ONLY the columns listed are written.
                  fill    = the row's column is empty and the file has a value;
                  replace = both have a value and the file's differs.
                A column the file leaves empty (absent key → "" or []) is NEVER
                written over a value the row already has — those are listed as
                kept, so enriched definition_en / example / collocations… (V-FILL,
                CM edits) survive a re-run. A lesson `source` stamp ("L## …") is
                kept against a non-lesson value (same rule as upsert_vocab_card),
                and an existing topic_id is kept (filled only when empty).
  * unchanged — nothing to write.
A summary with per-column counts closes the run. Review the dry run before
--commit: "replace" columns overwrite the row's current value with the file's.

The commit UPDATE also matches the row's updated_at as read for the plan, so a
row edited between the read and the write is reported as a conflict and left
untouched (re-run to re-plan it). Audio columns are never in the payload; a
changed example may still need its audio re-prepared. The script does not
reload the deployed vocab cache — use a no-op admin PATCH or restart the
backend after a commit.

Failure modes:
  * supabase_admin not configured (env missing) → aborts on the first read with
    the underlying client error. Fix the env and re-run.
  * A single file fails to parse/validate → logged + skipped (action="error"); the
    loop continues so one bad file doesn't block the rest. Re-run after fixing it.
"""

from __future__ import annotations

import argparse
import logging
from collections import Counter

from database import supabase_admin
from services.content_import_service import FrontmatterError
from services.topic_service import resolve_topic_id_for_category
from services.vocab_content import CONTENT_DIR
from services.vocab_import import (
    _is_lesson_source,
    build_vocab_payload,
    parse_vocab_markdown,
    validate_vocab,
)

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("migrate_vocab")

# Match keys — never part of an UPDATE.
_IDENTITY = ("slug", "category")


def _is_empty(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict)):
        return len(value) == 0
    return False


def plan_update(payload: dict, row: dict) -> dict:
    """Columns to write for an existing row, never blanking a value it has.

    Returns {changes: {col: value}, fill: [col], replace: [col], kept: [col]}."""
    changes: dict = {}
    fill: list[str] = []
    replace: list[str] = []
    kept: list[str] = []
    for col, new in payload.items():
        if col in _IDENTITY:
            continue
        old = row.get(col)
        if _is_empty(new):
            if not _is_empty(old):
                kept.append(col)
            continue
        if new == old:
            continue
        if col == "source" and _is_lesson_source(old) and not _is_lesson_source(new):
            kept.append(col)
            continue
        changes[col] = new
        (fill if _is_empty(old) else replace).append(col)
    return {"changes": changes, "fill": fill, "replace": replace, "kept": kept}


def _fetch_row(category: str, slug: str) -> dict | None:
    rows = (
        supabase_admin.table("vocab_cards").select("*")
        .eq("slug", slug).eq("category", category).limit(1).execute()
    ).data
    return rows[0] if rows else None


def migrate_file(text: str, *, commit: bool) -> dict:
    """Plan (and with commit=True apply) one markdown file. Returns
    {action, slug, category, fill, replace, kept, errors}; action is one of
    insert / update / unchanged / conflict / error."""
    out = {"action": "error", "slug": "", "category": "",
           "fill": [], "replace": [], "kept": [], "errors": []}
    try:
        parsed = parse_vocab_markdown(text)
    except FrontmatterError as exc:
        out["errors"] = [{"field": "frontmatter", "message": str(exc)}]
        return out
    out["slug"], out["category"] = parsed.slug, parsed.category
    errs = validate_vocab(parsed)
    if errs:
        out["errors"] = errs
        return out

    payload = build_vocab_payload(parsed)
    row = _fetch_row(parsed.category, parsed.slug)

    if row is None:
        out["action"] = "insert"
        if commit:
            tid = resolve_topic_id_for_category(parsed.category)
            if tid:
                payload["topic_id"] = tid
            supabase_admin.table("vocab_cards").insert(payload).execute()
        return out

    if _is_empty(row.get("topic_id")):
        # Resolving may create the topic, so the dry run only forecasts it.
        payload["topic_id"] = "(resolved at commit)"
    plan = plan_update(payload, row)
    out.update(fill=plan["fill"], replace=plan["replace"], kept=plan["kept"])
    if not plan["changes"]:
        out["action"] = "unchanged"
        return out

    out["action"] = "update"
    if commit:
        changes = plan["changes"]
        if "topic_id" in changes:
            tid = resolve_topic_id_for_category(parsed.category)
            if tid:
                changes["topic_id"] = tid
            else:
                changes.pop("topic_id")
                out["fill"] = [c for c in out["fill"] if c != "topic_id"]
        if changes:
            written = (
                supabase_admin.table("vocab_cards").update(changes)
                .eq("id", row["id"]).eq("updated_at", row["updated_at"]).execute()
            ).data
            if not written:
                out["action"] = "conflict"
    return out


def _cols(label: str, cols: list[str]) -> str:
    return f" {label}=[{', '.join(cols)}]" if cols else ""


def main(argv: list[str] | None = None) -> dict:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    ap.add_argument("--commit", action="store_true",
                    help="write to vocab_cards (default: dry run, read only)")
    args = ap.parse_args(argv)
    mode = "COMMIT" if args.commit else "DRY RUN"

    if not CONTENT_DIR.exists():
        logger.error("content_vocab dir not found: %s", CONTENT_DIR)
        return {}

    files = sorted(CONTENT_DIR.rglob("*.md"))
    logger.info("[%s] Found %d markdown vocab files under %s", mode, len(files), CONTENT_DIR)

    actions: Counter = Counter()
    col_counts = {"fill": Counter(), "replace": Counter(), "kept": Counter()}
    for md in files:
        res = migrate_file(md.read_text(encoding="utf-8"), commit=args.commit)
        actions[res["action"]] += 1
        if res["action"] == "error":
            logger.warning("  ✗ %s — %s", md.name,
                           "; ".join(f"{e['field']}: {e['message']}" for e in res["errors"]))
            continue
        for key in col_counts:
            col_counts[key].update(res[key])
        logger.info("  %-9s %s/%s%s%s%s", res["action"], res["category"], res["slug"],
                    _cols("fill", res["fill"]), _cols("replace", res["replace"]),
                    _cols("kept", res["kept"]))

    logger.info("[%s] Done. insert=%d update=%d unchanged=%d conflict=%d errors=%d",
                mode, actions["insert"], actions["update"], actions["unchanged"],
                actions["conflict"], actions["error"])
    for key, counts in col_counts.items():
        if counts:
            logger.info("  %s columns: %s", key,
                        ", ".join(f"{c}={n}" for c, n in sorted(counts.items())))
    if not args.commit:
        logger.info("Dry run — nothing written. Re-run with --commit to apply.")
    return {"actions": dict(actions), **{k: dict(v) for k, v in col_counts.items()}}


if __name__ == "__main__":
    main()
