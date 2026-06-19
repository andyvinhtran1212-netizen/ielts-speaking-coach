"""GV-1c one-off backfill — convert legacy admin_edits_json overlays into
composed versions (single source of truth = current_version).

⚠ RUN ONCE against prod BEFORE merging the GV-1c PR (while the old code — the
:783 admin_edits_json render overlay — is still deployed). Running it first means
the 4 legacy essays already have a composed current_version by the time the
overlay is dropped, so there is NO window where they lose their human edit.

Idempotent: skips essays whose current version is already 'composed'.

    cd backend && PYTHONPATH=. python scripts/gv1c_backfill_admin_edits.py
"""

from database import supabase_admin
from models.writing_feedback import WritingFeedback
from services import essay_service


def main():
    rows = (
        supabase_admin.table("writing_essays")
        .select("id, admin_edits_json, current_version, last_edited_by")
        .filter("admin_edits_json", "not.is", "null")
        .is_("deleted_at", "null")
        .execute()
    ).data or []
    print(f"essays with admin_edits_json: {len(rows)}")

    converted = skipped = failed = 0
    for e in rows:
        eid = e["id"]
        cur = e.get("current_version") or 1
        cur_row = (
            supabase_admin.table("writing_feedback")
            .select("source").eq("essay_id", eid).eq("version", cur)
            .limit(1).execute()
        ).data
        if cur_row and cur_row[0].get("source") == "composed":
            skipped += 1
            print(f"  skip {eid} — current v{cur} already composed")
            continue
        try:
            fb = WritingFeedback(**e["admin_edits_json"])
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  FAIL parse {eid}: {exc}")
            continue
        try:
            v = essay_service.upsert_composed_version(
                eid, fb, edited_by=e.get("last_edited_by") or "gv1c-backfill")
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"  FAIL convert {eid}: {exc}")
            continue
        converted += 1
        print(f"  converted {eid} → composed v{v}")

    print(f"\nconverted={converted} skipped={skipped} failed={failed}")


if __name__ == "__main__":
    main()
