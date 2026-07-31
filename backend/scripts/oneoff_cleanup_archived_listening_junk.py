"""One-off cleanup (ĐÃ CHẠY 2026-07-17): hard-delete 5 archived listening test
0-attempt + draft render 'Untitled listening'. Dry-run mặc định; chạy lại vô
hại (guard đếm attempts + rows đã xóa không còn match).

Run dry-run:  cd backend && venv/bin/python scripts/oneoff_cleanup_archived_listening_junk.py
Commit:       ... --commit
"""
import json
import os
import sys
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[1])
os.chdir(BACKEND)  # config.py đọc .env theo cwd
sys.path.insert(0, BACKEND)
from database import supabase_admin as sb  # noqa: E402
from config import settings  # noqa: E402

COMMIT = "--commit" in sys.argv
TARGET_TEST_IDS = [
    "ILR-LIS-LSN-L06", "ILR-LIS-LSN-L07", "ILR-LIS-LSN-L11",
    "ILR-LIS-LSN-L12", "ILR-LIS-LSN-L13",
]
BUCKET = settings.LISTENING_AUDIO_BUCKET

for tid in TARGET_TEST_IDS:
    rows = (
        sb.table("listening_tests").select("id,test_id,status,full_audio_storage_path")
        .eq("test_id", tid).eq("status", "archived").execute().data
    )
    for t in rows:
        uuid = t["id"]
        n_att = sb.table("listening_test_attempts").select("id", count="exact", head=True).eq("test_id", uuid).execute().count
        if n_att:
            print(f"SKIP {tid} ({uuid}): {n_att} attempts appeared — not deleting")
            continue
        contents = sb.table("listening_content").select("id,audio_storage_path").eq("test_id", uuid).execute().data
        cids = [c["id"] for c in contents]
        ex_count = (
            sb.table("listening_exercises").select("id", count="exact", head=True).in_("content_id", cids).execute().count
            if cids else 0
        )
        paths = [c["audio_storage_path"] for c in contents if c.get("audio_storage_path")]
        if t.get("full_audio_storage_path"):
            paths.append(t["full_audio_storage_path"])
        print(f"{'DELETE' if COMMIT else 'DRY-RUN'} {tid} ({uuid}): "
              f"{len(cids)} content, {ex_count} exercises, {len(paths)} audio files")
        if not COMMIT:
            continue
        try:
            if cids:
                sb.table("listening_exercises").delete().in_("content_id", cids).execute()
                sb.table("listening_content").delete().eq("test_id", uuid).execute()
            sb.table("listening_tests").delete().eq("id", uuid).execute()
            if paths:
                sb.storage.from_(BUCKET).remove(paths)
            print(f"  done ({len(paths)} storage files removed)")
        except Exception as e:
            print(f"  FAILED: {e} — investigate FK references before retrying")

# Optional: the May test-render draft ("Untitled listening", ai_elevenlabs)
drafts = (
    sb.table("listening_content")
    .select("id,title,audio_storage_path,created_at")
    .eq("source_type", "ai_elevenlabs").eq("status", "draft").execute().data
)
for d in drafts:
    ex = sb.table("listening_exercises").select("id", count="exact", head=True).eq("content_id", d["id"]).execute().count
    if ex:
        print(f"SKIP draft render {d['id']} ('{d['title']}'): has {ex} exercises")
        continue
    print(f"{'DELETE' if COMMIT else 'DRY-RUN'} draft render {d['id']} ('{d['title']}', {d['created_at'][:10]})")
    if COMMIT:
        sb.table("listening_content").delete().eq("id", d["id"]).execute()
        if d.get("audio_storage_path"):
            sb.storage.from_(BUCKET).remove([d["audio_storage_path"]])
        print("  done")
print("\nNOTE: 14 archived tests with student attempts + 4 exercise_snippet drafts of ILR-LIS-001 were intentionally kept.")
