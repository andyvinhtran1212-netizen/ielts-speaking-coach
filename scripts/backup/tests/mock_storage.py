#!/usr/bin/env python3
"""Minimal Supabase Storage API double for the offsite-backup self-test.

Serves the endpoints storage_tool.py uses, backed by a directory:
  ROOT/_buckets.json        [{"id", "name", "public", ...}]
  ROOT/<bucket>/<name>      object bytes

  --page-cap N   return at most N entries per list call (exercises paging)
  --ghost B/N    list B/N until its first download, which answers 404 and
                 removes it (an object deleted between listing and download)
  --truncate B/N:K  the first K downloads of B/N advertise the full
                 Content-Length, send half the body and close the connection
"""
from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def build(root: Path, key: str, page_cap: int, ghosts: set[tuple[str, str]], truncate: dict):
    lock = threading.Lock()
    ghost_deleted: set[tuple[str, str]] = set()

    def buckets() -> list[dict]:
        path = root / "_buckets.json"
        return json.loads(path.read_text()) if path.exists() else []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep the test log quiet
            pass

        def _send(self, code: int, payload=None, body: bytes | None = None, ctype="application/json"):
            data = body if body is not None else json.dumps(payload).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _auth(self) -> bool:
            if self.headers.get("apikey") != key:
                self._send(401, {"statusCode": "401", "error": "unauthorized"})
                return False
            return True

        def _parts(self):
            path = urllib.parse.urlsplit(self.path).path
            assert path.startswith("/storage/v1/")
            return [urllib.parse.unquote(p) for p in path[len("/storage/v1/"):].split("/")]

        def _not_found(self):
            self._send(400, {"statusCode": "404", "error": "not_found", "message": "Object not found"})

        def do_GET(self):
            if not self._auth():
                return
            parts = self._parts()
            if parts == ["bucket"]:
                return self._send(200, buckets())
            if parts[0] == "object" and len(parts) >= 3:
                bucket, name = parts[1], "/".join(parts[2:])
                if (bucket, name) in ghosts:
                    with lock:
                        ghost_deleted.add((bucket, name))
                    return self._not_found()
                f = root / bucket / name
                if not f.is_file():
                    return self._not_found()
                ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
                data = f.read_bytes()
                with lock:
                    cut = truncate.get((bucket, name), 0) > 0
                    if cut:
                        truncate[(bucket, name)] -= 1
                if cut:
                    self.send_response(200)
                    self.send_header("Content-Type", ctype)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data[: len(data) // 2])
                    self.wfile.flush()
                    self.close_connection = True
                    return
                return self._send(200, body=data, ctype=ctype)
            self._send(404, {"error": "route"})

        def do_POST(self):
            if not self._auth():
                return
            parts = self._parts()
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length)
            if parts == ["bucket"]:
                spec = json.loads(body)
                with lock:
                    current = buckets()
                    if any(b["id"] == spec["id"] for b in current):
                        return self._send(409, {"error": "Duplicate"})
                    current.append(spec)
                    (root / "_buckets.json").write_text(json.dumps(current))
                    (root / spec["id"]).mkdir(parents=True, exist_ok=True)
                return self._send(200, {"name": spec["id"]})
            if parts[:2] == ["object", "list"] and len(parts) == 3:
                bucket = parts[2]
                req = json.loads(body)
                prefix = req.get("prefix", "").strip("/")
                folder = root / bucket / prefix if prefix else root / bucket
                entries = []
                if folder.is_dir():
                    for child in sorted(folder.iterdir(), key=lambda p: p.name):
                        if child.is_dir():
                            entries.append({"name": child.name, "id": None, "metadata": None})
                        else:
                            data = child.read_bytes()
                            entries.append({
                                "name": child.name,
                                "id": hashlib.md5(str(child).encode()).hexdigest(),
                                "created_at": "2026-10-27T00:00:00Z",
                                "updated_at": "2026-10-27T00:00:00Z",
                                "metadata": {
                                    "size": len(data),
                                    "mimetype": mimetypes.guess_type(child.name)[0] or "application/octet-stream",
                                    "cacheControl": "max-age=3600",
                                },
                            })
                for g_bucket, g_name in ghosts:
                    g_folder, _, g_leaf = g_name.rpartition("/")
                    if g_bucket == bucket and g_folder == prefix and (g_bucket, g_name) not in ghost_deleted:
                        entries.append({"name": g_leaf, "id": "ghost", "metadata": {"size": 1}})
                offset = int(req.get("offset", 0))
                limit = min(int(req.get("limit", 100)), page_cap)
                return self._send(200, entries[offset : offset + limit])
            if parts[0] == "object" and len(parts) >= 3:
                bucket, name = parts[1], "/".join(parts[2:])
                if not (root / bucket).is_dir():
                    return self._send(400, {"statusCode": "404", "error": "Bucket not found"})
                f = root / bucket / name
                if f.exists() and self.headers.get("x-upsert") != "true":
                    return self._send(400, {"statusCode": "409", "error": "Duplicate"})
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(body)
                return self._send(200, {"Key": f"{bucket}/{name}"})
            self._send(404, {"error": "route"})

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--page-cap", type=int, default=1000)
    parser.add_argument("--ghost", action="append", default=[])
    parser.add_argument("--truncate", action="append", default=[])
    args = parser.parse_args()
    ghosts = {tuple(g.split("/", 1)) for g in args.ghost}
    truncate = {}
    for t in args.truncate:
        target, _, times = t.rpartition(":")
        truncate[tuple(target.split("/", 1))] = int(times)
    server = ThreadingHTTPServer(
        ("127.0.0.1", args.port), build(Path(args.root), args.key, args.page_cap, ghosts, truncate)
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
