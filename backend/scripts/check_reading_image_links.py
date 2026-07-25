"""Quét link ảnh chết trong reading_passages (audit 2026-07-17).

Ảnh L1 là Cloudinary URL dán tay vào frontmatter — app không quản lý nên
link chết không ai biết. Script này HEAD-check `image_url` + mọi ảnh nhúng
trong `body_markdown` của toàn corpus (read-only; import-time chỉ check
được bài đang import — xem _check_image_url_reachable trong admin_reading).

Run:  cd backend && venv/bin/python scripts/check_reading_image_links.py [--status published]
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[1])
os.chdir(BACKEND)  # config.py đọc .env theo cwd
sys.path.insert(0, BACKEND)

_MD_IMG_RE = re.compile(r"!\[[^\]]*\]\((https?://[^)\s]+)")
_HTML_IMG_RE = re.compile(r"<img[^>]+src=[\"'](https?://[^\"']+)[\"']", re.IGNORECASE)


def extract_image_urls(image_url: str | None, body_markdown: str | None) -> list[str]:
    """Pure: gom mọi URL ảnh ngoài của một passage (frontmatter + markdown/html)."""
    urls: list[str] = []
    if image_url and image_url.startswith(("http://", "https://")):
        urls.append(image_url)
    body = body_markdown or ""
    urls.extend(_MD_IMG_RE.findall(body))
    urls.extend(_HTML_IMG_RE.findall(body))
    seen: set[str] = set()
    return [u for u in urls if not (u in seen or seen.add(u))]


def _check(url: str, timeout_s: float = 8.0) -> str | None:
    """None = OK; string = mô tả lỗi."""
    import httpx

    try:
        resp = httpx.head(url, timeout=timeout_s, follow_redirects=True)
        if resp.status_code == 405:
            resp = httpx.get(url, timeout=timeout_s, follow_redirects=True,
                             headers={"Range": "bytes=0-0"})
        return None if resp.status_code < 400 else f"HTTP {resp.status_code}"
    except Exception as exc:  # noqa: BLE001
        return f"lỗi mạng ({type(exc).__name__})"


def main() -> int:
    from database import supabase_admin as sb  # noqa: PLC0415 — cần .env

    status = None
    if "--status" in sys.argv:
        status = sys.argv[sys.argv.index("--status") + 1]

    rows, start, page = [], 0, 1000
    while True:
        q = sb.table("reading_passages").select("slug,library,status,image_url,body_markdown")
        if status:
            q = q.eq("status", status)
        batch = q.range(start, start + page - 1).execute().data
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page

    verdict_cache: dict[str, str | None] = {}
    dead = 0
    checked_urls = 0
    for r in rows:
        urls = extract_image_urls(r.get("image_url"), r.get("body_markdown"))
        for u in urls:
            if u not in verdict_cache:
                verdict_cache[u] = _check(u)
                checked_urls += 1
            bad = verdict_cache[u]
            if bad:
                dead += 1
                print(f"DEAD [{r.get('library')}/{r.get('status')}] {r.get('slug')}: {bad} — {u}")

    print(f"\n{len(rows)} passages · {checked_urls} URL duy nhất đã check · {dead} link chết")
    return 1 if dead else 0


if __name__ == "__main__":
    raise SystemExit(main())
