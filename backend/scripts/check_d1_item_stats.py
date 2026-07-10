#!/usr/bin/env python3
"""check_d1_item_stats.py — D1 item difficulty + discrimination report (audit #7).

Answers "does this item actually teach?" from the attempt log. Flags items to fix
or retire: too_easy / too_hard (difficulty) and weak / negative discrimination
(a broken key or ambiguous distractor lets weak students beat strong ones).

    python -m scripts.check_d1_item_stats                    # from the DB
    python -m scripts.check_d1_item_stats --file attempts.json --min-attempts 1  # offline
    python -m scripts.check_d1_item_stats --flagged-only

Pure math in services.d1_item_stats; this only loads + prints.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.d1_item_stats import item_stats  # noqa: E402


def _load_attempts(args) -> list[dict]:
    if args.file:
        return json.loads(Path(args.file).read_text(encoding="utf-8"))
    from database import supabase_admin
    rows: list[dict] = []
    page, size = 0, 1000
    while True:  # paginate past the PostgREST 1000-row cap
        resp = (
            supabase_admin.table("vocabulary_exercise_attempts")
            .select("exercise_id, user_id, is_correct")
            .range(page * size, page * size + size - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < size:
            break
        page += 1
    return rows


def _load_words(ids: list[str]) -> dict:
    """exercise_id → target word, for a readable report (DB only; best-effort)."""
    try:
        from database import supabase_admin
        out: dict = {}
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            resp = (
                supabase_admin.table("vocabulary_exercises")
                .select("id, content_payload").in_("id", chunk).execute()
            )
            for r in resp.data or []:
                out[str(r["id"])] = (r.get("content_payload") or {}).get("answer", "")
        return out
    except Exception:
        return {}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", default=None, help="JSON list of attempts (offline)")
    ap.add_argument("--min-attempts", type=int, default=5)
    ap.add_argument("--group-frac", type=float, default=0.27)
    ap.add_argument("--flagged-only", action="store_true")
    args = ap.parse_args(argv)

    attempts = _load_attempts(args)
    if not attempts:
        print("no attempts found"); return 1
    stats = item_stats(attempts, group_frac=args.group_frac, min_attempts=args.min_attempts)
    words = _load_words(list(stats)) if not args.file else {}

    rows = sorted(stats.items(), key=lambda kv: (not kv[1]["flags"], kv[1]["discrimination"] or 0))
    n_flagged = sum(1 for _, st in rows if st["flags"])

    print(f"\n{'exercise':<38} {'word':<14} {'n':>4} {'diff':>6} {'disc':>6}  flags")
    for ex, st in rows:
        if args.flagged_only and not st["flags"]:
            continue
        w = (words.get(str(ex), "") or "")[:13]
        d = "—" if st["difficulty"] is None else f"{st['difficulty']:.2f}"
        di = "—" if st["discrimination"] is None else f"{st['discrimination']:.2f}"
        print(f"{str(ex):<38} {w:<14} {st['n']:>4} {d:>6} {di:>6}  {','.join(st['flags'])}")

    print(f"\n{len(stats)} items, {n_flagged} flagged (fix/retire). "
          f"Legend: diff<{0.2}=too_hard, >{0.95}=too_easy, disc<0.2=weak, <0=broken.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
