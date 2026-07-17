"""Đối soát Storage ↔ DB — liệt kê file mồ côi trong các bucket listening/reading.

Audit 2026-07-17: các flow upload cũ ghi Storage trước / insert DB sau, nên
insert fail giữa chừng để lại file không row nào tham chiếu; hard-delete
exercise cũng không cascade xoá map image. Script này là công cụ đối soát
đầu tiên (trước đây chưa có).

Bucket ↔ nguồn tham chiếu:
  listening-audio   ← listening_content.audio_storage_path
                      + listening_tests.full_audio_storage_path
                      + listening_tests.assembled_audio_storage_path
  listening-images  ← listening_exercises.payload->>map_image_storage_path
  reading-images    ← reading_questions.payload->template->>image_storage_path

Mặc định CHỈ BÁO CÁO (read-only). Xoá thật: thêm --delete (xoá đúng danh
sách mồ côi vừa liệt kê, theo batch 100).

Run:  cd backend && venv/bin/python scripts/reconcile_storage_orphans.py [--delete]
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[1])
os.chdir(BACKEND)  # config.py đọc .env theo cwd
sys.path.insert(0, BACKEND)


def find_orphans(storage_paths: set[str], referenced: set[str]) -> list[str]:
    """Pure: file có trong bucket nhưng không row DB nào tham chiếu."""
    return sorted(storage_paths - {p for p in referenced if p})


def _walk_bucket(storage, bucket: str, prefix: str = "") -> list[dict]:
    """Duyệt đệ quy 1 bucket → list {path, size}. Folder trong Supabase
    Storage list() là entry không có metadata/id."""
    out: list[dict] = []
    offset = 0
    while True:
        page = storage.from_(bucket).list(
            prefix, {"limit": 100, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}
        )
        if not page:
            break
        for item in page:
            name = item.get("name")
            full = f"{prefix}/{name}" if prefix else name
            if item.get("id") is None and not item.get("metadata"):
                out.extend(_walk_bucket(storage, bucket, full))
            else:
                out.append({"path": full, "size": (item.get("metadata") or {}).get("size") or 0})
        if len(page) < 100:
            break
        offset += 100
    return out


def _fetch_all(sb, table: str, cols: str, extra=None):
    rows, start, page = [], 0, 1000
    while True:
        q = sb.table(table).select(cols)
        if extra:
            q = extra(q)
        batch = q.range(start, start + page - 1).execute().data
        rows.extend(batch)
        if len(batch) < page:
            return rows
        start += page


def _referenced_paths(sb) -> dict[str, set[str]]:
    refs: dict[str, set[str]] = {"listening-audio": set(), "listening-images": set(), "reading-images": set()}
    for r in _fetch_all(sb, "listening_content", "audio_storage_path"):
        refs["listening-audio"].add(r.get("audio_storage_path"))
    for r in _fetch_all(sb, "listening_tests", "full_audio_storage_path,assembled_audio_storage_path"):
        refs["listening-audio"].add(r.get("full_audio_storage_path"))
        refs["listening-audio"].add(r.get("assembled_audio_storage_path"))
    for r in _fetch_all(
        sb, "listening_exercises", "id,p:payload->>map_image_storage_path",
        extra=lambda q: q.filter("payload->>map_image_storage_path", "not.is", "null"),
    ):
        refs["listening-images"].add(r.get("p"))
    for r in _fetch_all(
        sb, "reading_questions", "id,p:payload->template->>image_storage_path",
        extra=lambda q: q.filter("payload->template->>image_storage_path", "not.is", "null"),
    ):
        refs["reading-images"].add(r.get("p"))
    refs = {b: {p for p in s if p} for b, s in refs.items()}
    return refs


def main() -> int:
    from database import supabase_admin as sb  # noqa: PLC0415 — cần .env

    delete = "--delete" in sys.argv
    refs = _referenced_paths(sb)
    total_orphans = 0
    for bucket, referenced in refs.items():
        try:
            files = _walk_bucket(sb.storage, bucket)
        except Exception as exc:  # noqa: BLE001
            print(f"[{bucket}] KHÔNG LIỆT KÊ ĐƯỢC: {exc}")
            continue
        by_path = {f["path"]: f for f in files}
        orphans = find_orphans(set(by_path), referenced)
        size = sum(by_path[p]["size"] for p in orphans)
        print(f"[{bucket}] {len(files)} file · {len(referenced)} được tham chiếu · "
              f"{len(orphans)} MỒ CÔI ({size/1024/1024:.1f} MB)")
        for p in orphans:
            print(f"  - {p} ({by_path[p]['size']/1024:.0f} KB)")
        total_orphans += len(orphans)
        if delete and orphans:
            for i in range(0, len(orphans), 100):
                sb.storage.from_(bucket).remove(orphans[i:i + 100])
            print(f"  → đã xoá {len(orphans)} file")
    if not delete and total_orphans:
        print("\n(Read-only. Xoá thật: chạy lại với --delete)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
