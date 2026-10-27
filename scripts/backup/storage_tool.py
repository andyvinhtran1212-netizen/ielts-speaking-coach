#!/usr/bin/env python3
"""Export or restore every Supabase Storage object through the Storage API.

  storage_tool.py export  --supabase-url URL --out DIR
  storage_tool.py restore --supabase-url URL --from DIR --confirm-target-ref REF [--dry-run]

The service key is read from the environment variable named by --key-env
(default SUPABASE_SERVICE_KEY), never from argv. Legacy service_role JWTs and
new sb_secret_ keys both work: the key always goes in `apikey`, and JWTs also
go in `Authorization`.

Export layout (inside the encrypted bundle):
  DIR/buckets.json       bucket config (public flag, size limit, MIME allow-list)
  DIR/objects.jsonl      one JSON line per object: bucket, name, size, sha256,
                         content_type, cache_control, created_at, updated_at
  DIR/objects/<bucket>/<name>   the bytes

The repository is public, so logs only carry bucket ids and counts. Object
names can contain user ids and are never printed.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CHUNK = 1 << 20
LIST_LIMIT = 1000
RETRIES = 5
TIMEOUT = 300


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


class Fatal(Exception):
    pass


class NotFound(Exception):
    pass


class StorageApi:
    def __init__(self, base_url: str, key: str):
        self.base = base_url.rstrip("/") + "/storage/v1"
        self.headers = {"apikey": key}
        if key.startswith("eyJ"):
            self.headers["Authorization"] = "Bearer " + key

    def _request(self, method: str, path: str, body: bytes | None = None, headers: dict | None = None):
        hdrs = dict(self.headers)
        hdrs.update(headers or {})
        delay = 1.0
        for attempt in range(1, RETRIES + 1):
            req = urllib.request.Request(self.base + path, data=body, method=method, headers=hdrs)
            try:
                return urllib.request.urlopen(req, timeout=TIMEOUT)
            except urllib.error.HTTPError as exc:
                text = exc.read(2048).decode("utf-8", "replace")
                # Storage answers a missing object with 400 + statusCode "404".
                if exc.code == 404 or (exc.code == 400 and ("not_found" in text or '"404"' in text)):
                    raise NotFound() from None
                if exc.code in (429, 500, 502, 503, 504) and attempt < RETRIES:
                    time.sleep(delay + random.random())
                    delay *= 2
                    continue
                raise Fatal(f"{method} {path.split('/')[1:3]} -> HTTP {exc.code}") from None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if attempt < RETRIES:
                    time.sleep(delay + random.random())
                    delay *= 2
                    continue
                raise Fatal(f"{method} {path.split('/')[1:3]} -> {type(exc).__name__}") from None
        raise Fatal("unreachable")

    def json(self, method: str, path: str, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        with self._request(method, path, body, {"Content-Type": "application/json"}) as resp:
            return json.loads(resp.read() or b"null")

    def buckets(self) -> list[dict]:
        return self.json("GET", "/bucket")

    def list_folder(self, bucket: str, prefix: str) -> list[dict]:
        entries: list[dict] = []
        offset = 0
        while True:
            page = self.json(
                "POST",
                f"/object/list/{quote(bucket)}",
                {
                    "prefix": prefix,
                    "limit": LIST_LIMIT,
                    "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                },
            )
            # Page until an empty page: a server-side cap below LIST_LIMIT must
            # not silently truncate a folder.
            if not page:
                return entries
            entries.extend(page)
            offset += len(page)

    def walk(self, bucket: str, workers: int = 8) -> list[dict]:
        """Every object entry in a bucket, with its full name. Folders are
        listed in parallel: each list call is a round trip (~0.3 s from a
        runner) and a bucket can hold hundreds of folders."""
        found: list[dict] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {pool.submit(self.list_folder, bucket, ""): ""}
            while pending:
                done, _ = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
                for fut in done:
                    prefix = pending.pop(fut)
                    for entry in fut.result():
                        full = f"{prefix}/{entry['name']}" if prefix else entry["name"]
                        if entry.get("id") is None:
                            pending[pool.submit(self.list_folder, bucket, full)] = full
                        else:
                            entry = dict(entry)
                            entry["full_name"] = full
                            found.append(entry)
        return found

    def exists(self, bucket: str, name: str) -> bool:
        folder, _, leaf = name.rpartition("/")
        return any(e.get("id") is not None and e["name"] == leaf for e in self.list_folder(bucket, folder))

    def download(self, bucket: str, name: str):
        return self._request("GET", f"/object/{quote(bucket)}/{quote(name)}")

    def upload(self, bucket: str, name: str, path: Path, content_type: str, cache_control: str | None, upsert: bool):
        headers = {"Content-Type": content_type or "application/octet-stream", "x-upsert": "true" if upsert else "false"}
        if cache_control:
            headers["cache-control"] = cache_control
        data = path.read_bytes()
        with self._request("POST", f"/object/{quote(bucket)}/{quote(name)}", data, headers) as resp:
            resp.read()


def quote(value: str) -> str:
    return urllib.parse.quote(value, safe="/")


def safe_relpath(bucket: str, name: str) -> Path:
    parts = [bucket, *name.split("/")]
    if any(p in ("", ".", "..") or "\x00" in p for p in parts) or name.startswith("/"):
        raise Fatal(f"bucket {bucket}: object name is not a safe relative path; refusing to write it")
    return Path(*parts)


# --------------------------------------------------------------------------- #
# export
# --------------------------------------------------------------------------- #
def cmd_export(api: StorageApi, args: argparse.Namespace) -> int:
    out = Path(args.out)
    objects_dir = out / "objects"
    objects_dir.mkdir(parents=True, exist_ok=True)
    buckets = api.buckets()
    keep = ("id", "name", "public", "file_size_limit", "allowed_mime_types", "type", "created_at", "updated_at")
    (out / "buckets.json").write_text(
        json.dumps([{k: b.get(k) for k in keep} for b in buckets], indent=1) + "\n", encoding="utf-8"
    )

    lock = threading.Lock()
    stats = {"objects": 0, "bytes": 0, "vanished": 0}
    manifest = open(out / "objects.jsonl", "w", encoding="utf-8")

    def fetch(bucket: str, entry: dict) -> None:
        name = entry["full_name"]
        rel = safe_relpath(bucket, name)
        dest = objects_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(1, RETRIES + 1):
            digest = hashlib.sha256()
            size = 0
            try:
                with api.download(bucket, name) as resp, open(dest, "wb") as fh:
                    content_type = resp.headers.get("Content-Type", "")
                    cache_control = resp.headers.get("Cache-Control")
                    while True:
                        chunk = resp.read(CHUNK)
                        if not chunk:
                            break
                        digest.update(chunk)
                        size += len(chunk)
                        fh.write(chunk)
                break
            except NotFound:
                dest.unlink(missing_ok=True)
                # Deleted between listing and download is fine; still listed
                # but not downloadable is a real failure.
                if api.exists(bucket, name):
                    raise Fatal(f"bucket {bucket}: a listed object returns not-found on download")
                with lock:
                    stats["vanished"] += 1
                return
            except (OSError, urllib.error.URLError, TimeoutError) as exc:
                if attempt == RETRIES:
                    raise Fatal(f"bucket {bucket}: download failed ({type(exc).__name__})") from None
                time.sleep(attempt)
        meta = entry.get("metadata") or {}
        record = {
            "bucket": bucket,
            "name": name,
            "size": size,
            "sha256": digest.hexdigest(),
            "content_type": meta.get("mimetype") or content_type,
            "cache_control": meta.get("cacheControl") or cache_control,
            "created_at": entry.get("created_at"),
            "updated_at": entry.get("updated_at"),
        }
        with lock:
            manifest.write(json.dumps(record, ensure_ascii=False) + "\n")
            stats["objects"] += 1
            stats["bytes"] += size

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            for bucket in buckets:
                bid = bucket["id"]
                entries = api.walk(bid, args.workers)
                started = time.time()
                futures = [pool.submit(fetch, bid, e) for e in entries]
                for fut in concurrent.futures.as_completed(futures):
                    fut.result()
                eprint(f"storage export: bucket {bid}: {len(entries)} listed in {time.time() - started:.0f}s")
    finally:
        manifest.close()
    stats["buckets"] = len(buckets)
    print(json.dumps(stats))
    eprint(
        f"storage export: {stats['buckets']} buckets, {stats['objects']} objects, "
        f"{stats['bytes']} bytes, {stats['vanished']} deleted during export"
    )
    return 0


# --------------------------------------------------------------------------- #
# restore
# --------------------------------------------------------------------------- #
def cmd_restore(api: StorageApi, args: argparse.Namespace) -> int:
    host = urllib.parse.urlparse(args.supabase_url).hostname or ""
    if args.confirm_target_ref and host.split(".")[0] != args.confirm_target_ref:
        raise Fatal("--confirm-target-ref does not match the --supabase-url host")
    if not args.confirm_target_ref and not args.allow_unconfirmed_target:
        raise Fatal("pass --confirm-target-ref <project ref> to restore into a project")
    src = Path(args.from_dir)
    wanted = set(args.bucket or [])
    saved = json.loads((src / "buckets.json").read_text(encoding="utf-8"))
    existing = {b["id"]: b for b in api.buckets()}
    for bucket in saved:
        if wanted and bucket["id"] not in wanted:
            continue
        if bucket["id"] in existing:
            if bool(existing[bucket["id"]].get("public")) != bool(bucket.get("public")):
                eprint(f"::warning::bucket {bucket['id']}: public flag differs from the backup; not changed")
            continue
        eprint(f"storage restore: create bucket {bucket['id']} (public={bucket.get('public')})")
        if not args.dry_run:
            api.json(
                "POST",
                "/bucket",
                {
                    "id": bucket["id"],
                    "name": bucket.get("name") or bucket["id"],
                    "public": bool(bucket.get("public")),
                    "file_size_limit": bucket.get("file_size_limit"),
                    "allowed_mime_types": bucket.get("allowed_mime_types"),
                },
            )
    records = [
        json.loads(line)
        for line in (src / "objects.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    records = [r for r in records if not wanted or r["bucket"] in wanted]
    lock = threading.Lock()
    stats = {"uploaded": 0, "bytes": 0, "verified": 0}

    def push(rec: dict) -> None:
        path = src / "objects" / safe_relpath(rec["bucket"], rec["name"])
        if args.dry_run:
            return
        api.upload(rec["bucket"], rec["name"], path, rec.get("content_type"), rec.get("cache_control"), args.upsert)
        if args.verify:
            digest = hashlib.sha256()
            with api.download(rec["bucket"], rec["name"]) as resp:
                while True:
                    chunk = resp.read(CHUNK)
                    if not chunk:
                        break
                    digest.update(chunk)
            if digest.hexdigest() != rec["sha256"]:
                raise Fatal(f"bucket {rec['bucket']}: restored object checksum mismatch")
        with lock:
            stats["uploaded"] += 1
            stats["bytes"] += rec["size"]
            stats["verified"] += 1 if args.verify else 0

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for fut in concurrent.futures.as_completed([pool.submit(push, r) for r in records]):
            fut.result()
    stats["planned"] = len(records)
    stats["dry_run"] = args.dry_run
    print(json.dumps(stats))
    eprint(f"storage restore: {json.dumps(stats)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--key-env", default="SUPABASE_SERVICE_KEY")
    parser.add_argument("--workers", type=int, default=8)
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("export")
    p.add_argument("--supabase-url", required=True)
    p.add_argument("--out", required=True)
    p = sub.add_parser("restore")
    p.add_argument("--supabase-url", required=True)
    p.add_argument("--from", dest="from_dir", required=True, help="the bundle's storage/ directory")
    p.add_argument("--confirm-target-ref", help="project ref of --supabase-url, as a typo guard")
    p.add_argument("--allow-unconfirmed-target", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--bucket", action="append", help="restore only this bucket (repeatable)")
    p.add_argument("--upsert", action="store_true", help="overwrite objects that already exist")
    p.add_argument("--no-verify", dest="verify", action="store_false", help="skip re-download checksum")
    p.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    key = os.environ.get(args.key_env, "")
    if not key:
        eprint(f"::error::{args.key_env} is not set")
        return 2
    api = StorageApi(args.supabase_url, key)
    try:
        return cmd_export(api, args) if args.cmd == "export" else cmd_restore(api, args)
    except Fatal as exc:
        eprint(f"::error::storage {args.cmd}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
