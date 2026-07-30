"""Archive the smoke/sample rows sitting in the student-facing Kho bài nghe.

Three of the four published `listening_content` rows are test artifacts:

    Smoke US Female                              15s   topic_tags ["smoke_test"]
    Sample UK Female — Urban Green Spaces        98s   topic_tags [… "sample"]
    IELTS Section 4 — Coastal Erosion Management 284s  topic_tags [… "scale_test"]

They were never meant for learners. Archiving them leaves the library with the
one real row, and the landing badge then reports 1 instead of 4 — which is the
honest number.

Writes to PROD. Run it yourself:
    python3 scripts/archive_smoke_listening_content.py --dry-run
    python3 scripts/archive_smoke_listening_content.py --commit

Safety:
  • --dry-run (default) does NO writes; prints exactly what would change.
  • Only rows whose topic_tags carry a test marker AND that are currently
    published are touched — the title is shown for confirmation but never used
    as the selector, so a real lesson that happens to be called "Sample …"
    cannot be archived by accident.
  • Refuses to run if it would archive EVERY published row: that would empty
    the library, which is a bigger decision than this script should make.
  • `status` is the only column written. Nothing is deleted.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from database import supabase_admin          # noqa: E402

# The marker lives in topic_tags, put there by whoever created the fixture.
# Selecting on it (not on the title) is what makes this safe to re-run.
_TEST_MARKERS = {"smoke_test", "sample", "scale_test"}


def find_targets() -> tuple[list[dict], int]:
    res = (
        supabase_admin.table("listening_content")
        .select("id,title,status,topic_tags,audio_duration_seconds")
        .eq("status", "published")
        .execute()
    )
    published = res.data or []
    targets = [
        r for r in published
        if _TEST_MARKERS & {str(t).lower() for t in (r.get("topic_tags") or [])}
    ]
    return targets, len(published)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--commit", action="store_true", help="actually write (default: dry-run)")
    args = ap.parse_args()

    targets, total = find_targets()
    print(f"listening_content đã publish: {total}")
    if not targets:
        print("Không có dòng nào mang nhãn kiểm thử — không cần làm gì.")
        return

    for r in targets:
        secs = r.get("audio_duration_seconds") or 0
        tags = ", ".join(str(t) for t in (r.get("topic_tags") or []))
        print(f"  - {(r.get('title') or '')[:52]:<52} {secs:>4}s  [{tags}]")
    print(f"\nSẽ archive {len(targets)}/{total} dòng · còn lại {total - len(targets)}")

    if len(targets) == total:
        sys.exit("DỪNG: sẽ archive TOÀN BỘ kho, làm trống thư viện. "
                 "Đây là quyết định lớn hơn phạm vi script này — kiểm lại nhãn.")

    if not args.commit:
        print("\n(chạy thử — chưa ghi gì. Thêm --commit để thực hiện.)")
        return

    for r in targets:
        supabase_admin.table("listening_content") \
            .update({"status": "archived"}).eq("id", r["id"]).execute()
        print(f"  archived {r['id']}")

    left, total_after = find_targets()
    print(f"\nXong. Kho còn {total_after} bài publish; nhãn kiểm thử còn lại: {len(left)}")
    print("Thẻ 'Kho bài nghe' trên trang Listening sẽ tự cập nhật (đếm từ /overview).")


if __name__ == "__main__":
    main()
