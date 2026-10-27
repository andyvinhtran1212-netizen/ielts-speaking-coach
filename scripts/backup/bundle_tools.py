#!/usr/bin/env python3
"""Helpers shared by offsite_backup.sh and restore_drill.sh (stdlib only).

The repository is public, so GitHub Actions logs are public too. Nothing in
this module prints object names, row values or per-table row counts: logs get
aggregate numbers and schema-level identifiers only. Full detail stays inside
the encrypted bundle or the runner's private work directory.

Subcommands:
  hashpipe        stdin -> stdout pass-through that records sha256 + byte count
  rowcounts       count COPY rows in `pg_restore --data-only -f -` output
  roles-filter    make a pg_dumpall --roles-only script safe for a drill cluster
  toc-filter      drop TOC entries the drill target cannot restore
  verify-storage  check every exported object against the bundle manifest
  db-checks       compare a restored database with the bundle manifest
  pick-latest     choose the newest complete backup from a list of meta keys
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
import sys
from pathlib import Path

CHUNK = 1 << 20
STAMP_RE = re.compile(r"/(\d{8}T\d{6}Z)-[^/]+/meta\.json$")


def eprint(*args: object) -> None:
    print(*args, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# hashpipe
# --------------------------------------------------------------------------- #
def cmd_hashpipe(args: argparse.Namespace) -> int:
    digest = hashlib.sha256()
    total = 0
    src = sys.stdin.buffer
    dst = sys.stdout.buffer
    while True:
        chunk = src.read(CHUNK)
        if not chunk:
            break
        digest.update(chunk)
        total += len(chunk)
        dst.write(chunk)
    dst.flush()
    Path(args.out).write_text(
        json.dumps({"sha256": digest.hexdigest(), "bytes": total}) + "\n", encoding="utf-8"
    )
    return 0


# --------------------------------------------------------------------------- #
# rowcounts
# --------------------------------------------------------------------------- #
COPY_RE = re.compile(rb"^COPY (.+?) (?:\(.*\) )?FROM stdin;\n$")


def cmd_rowcounts(args: argparse.Namespace) -> int:
    """Count rows per COPY block. COPY text format escapes embedded newlines,
    so one line is exactly one row."""
    counts: dict[str, int] = {}
    current: str | None = None
    n = 0
    for line in sys.stdin.buffer:
        if current is None:
            m = COPY_RE.match(line)
            if m:
                current = m.group(1).decode("utf-8")
                n = 0
            continue
        if line == b"\\.\n":
            counts[current] = counts.get(current, 0) + n
            current = None
            continue
        n += 1
    if current is not None:
        eprint("::error::rowcounts: COPY block was not terminated; the dump stream is truncated")
        return 1
    with open(args.out, "w", encoding="utf-8") as fh:
        for ident in sorted(counts):
            fh.write(f"{ident}\t{counts[ident]}\n")
    eprint(f"rowcounts: {len(counts)} tables, {sum(counts.values())} rows in the dump")
    return 0


# --------------------------------------------------------------------------- #
# roles-filter
# --------------------------------------------------------------------------- #
IDENT = r'(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)'
CREATE_ROLE_RE = re.compile(rf"^CREATE ROLE ({IDENT});\s*$")
ALTER_ROLE_RE = re.compile(rf"^ALTER ROLE ({IDENT}) ")
PRELOAD_RE = re.compile(r'\bSET "?(?:session|local|shared)_preload_libraries"? ', re.IGNORECASE)
GRANTED_BY_RE = re.compile(rf"^(GRANT .*) GRANTED BY {IDENT};\s*$")
GRANT_ROLE_RE = re.compile(rf"^GRANT ({IDENT}) TO ({IDENT})")
ALTER_ROLE_WITH_RE = re.compile(rf"^ALTER ROLE ({IDENT}) WITH ([A-Z ]+);\s*$")
SUPERUSER_ATTRS = {"SUPERUSER", "REPLICATION", "BYPASSRLS"}


def _unquote(ident: str) -> str:
    if ident.startswith('"'):
        return ident[1:-1].replace('""', '"')
    return ident.lower()


def cmd_roles_filter(args: argparse.Namespace) -> int:
    """pg_dumpall output is replayed into a throwaway cluster. Three statement
    shapes would break it, and nothing else is changed:
      * CREATE ROLE for a role that already exists (e.g. a reused cluster);
      * ALTER ROLE of the role running the drill (would demote the superuser);
      * *_preload_libraries settings naming Supabase-only libraries
        (supautils, safeupdate), which would make those roles unable to log in;
      * "GRANTED BY supabase_admin" on memberships: on PG16+ the grantor needs
        ADMIN on the role, which only the drill superuser has here. The
        membership itself is kept; only the recorded grantor changes.
    """
    existing = {
        line.strip() for line in Path(args.existing_roles).read_text(encoding="utf-8").splitlines()
    }
    current = args.current_user
    skipped = {"existing": 0, "current_user": 0, "preload": 0, "grantor": 0, "not_missing": 0}
    lines = sys.stdin.readlines()
    # --only-missing (restore into a new Supabase project, as non-superuser
    # `postgres`): Supabase-reserved roles already exist there and cannot be
    # altered, so keep only statements about roles the target lacks.
    missing = {
        _unquote(m.group(1)) for line in lines if (m := CREATE_ROLE_RE.match(line))
    } - existing
    out = []
    for line in lines:
        if args.only_missing and (line.startswith(("CREATE ROLE ", "ALTER ROLE ", "GRANT "))):
            m = CREATE_ROLE_RE.match(line) or ALTER_ROLE_RE.match(line) or GRANT_ROLE_RE.match(line)
            names = {_unquote(g) for g in (m.groups() if m else ()) if g}
            if not names & missing:
                skipped["not_missing"] += 1
                continue
        m = CREATE_ROLE_RE.match(line)
        if m and _unquote(m.group(1)) in existing:
            skipped["existing"] += 1
            continue
        m = ALTER_ROLE_RE.match(line)
        if m and _unquote(m.group(1)) == current:
            skipped["current_user"] += 1
            continue
        if PRELOAD_RE.search(line):
            skipped["preload"] += 1
            continue
        m = GRANTED_BY_RE.match(line)
        if m:
            skipped["grantor"] += 1
            line = m.group(1) + ";\n"
        if args.only_missing and (m := ALTER_ROLE_WITH_RE.match(line)):
            # A non-superuser may not even name these attributes (PG16+).
            attrs = m.group(2).split()
            kept = [a for a in attrs if a.upper().removeprefix("NO") not in SUPERUSER_ATTRS]
            needed = [a for a in attrs if a.upper() in SUPERUSER_ATTRS]
            if needed:
                eprint(f"::warning::role {_unquote(m.group(1))} needs {' '.join(needed)}; ask Supabase support")
            line = f"ALTER ROLE {m.group(1)} WITH {' '.join(kept)};\n" if kept else ""
        out.append(line)
    sys.stdout.write("".join(out))
    eprint(
        "roles-filter: skipped "
        f"{skipped['existing']} existing-role CREATE, "
        f"{skipped['current_user']} drill-superuser ALTER, "
        f"{skipped['preload']} preload-library settings; "
        f"dropped GRANTED BY on {skipped['grantor']} memberships"
        + (f"; kept only {len(missing)} missing roles" if args.only_missing else "")
    )
    return 0


# --------------------------------------------------------------------------- #
# toc-filter
# --------------------------------------------------------------------------- #
TOC_ENTRY_RE = re.compile(r"^\d+; \d+ \d+ (.*)$")
TOC_EXT_RE = re.compile(r"^\d+; \d+ \d+ EXTENSION - (\S+)")
TOC_EXT_COMMENT_RE = re.compile(r"^\d+; \d+ \d+ COMMENT - EXTENSION (\S+)")
TOC_DATA_RE = re.compile(r"^\d+; \d+ \d+ TABLE DATA (.+)$")
CREATE_EXT_RE = re.compile(r'^CREATE EXTENSION IF NOT EXISTS ("?[^" ]+"?) WITH SCHEMA ("?[^" ;]+"?);', re.MULTILINE)
# Multi-word TOC descriptions, longest first; anything else is one word.
TOC_DESCS = sorted(
    """TABLE DATA|SEQUENCE SET|SEQUENCE OWNED BY|DEFAULT ACL|FK CONSTRAINT|CHECK CONSTRAINT
    |MATERIALIZED VIEW DATA|MATERIALIZED VIEW|PUBLICATION TABLES IN SCHEMA|PUBLICATION TABLE
    |EVENT TRIGGER|ROW SECURITY|SECURITY LABEL|FOREIGN TABLE|FOREIGN DATA WRAPPER|FOREIGN SERVER
    |USER MAPPING|TEXT SEARCH CONFIGURATION|TEXT SEARCH DICTIONARY|TEXT SEARCH PARSER
    |TEXT SEARCH TEMPLATE|LARGE OBJECT|TABLE ATTACH|INDEX ATTACH|STATISTICS DATA
    |PROCEDURAL LANGUAGE|OPERATOR CLASS|OPERATOR FAMILY|ACCESS METHOD|SUBSCRIPTION TABLE""".replace("\n", "")
    .replace("    ", "")
    .split("|"),
    key=len,
    reverse=True,
)
MEMBER_ATTRIBUTE_DESCS = {"ACL", "COMMENT", "SECURITY LABEL"}
# Data entries exist for extension config tables too; they define nothing.
DATA_DESCS = {"TABLE DATA", "SEQUENCE SET", "MATERIALIZED VIEW DATA", "STATISTICS DATA"}


def _toc_parts(entry: str) -> tuple[str, str, str]:
    """(desc, namespace, tag) of a TOC entry body 'DESC NS TAG OWNER'."""
    desc = next((d for d in TOC_DESCS if entry.startswith(d + " ")), entry.split(" ", 1)[0])
    rest = entry[len(desc) + 1 :]
    ns, _, rest = rest.partition(" ")
    tag = rest.rsplit(" ", 1)[0] if " " in rest else rest
    return desc, ns, tag.strip()


def _object_base(tag: str) -> str:
    """'FUNCTION f(a int)' -> 'f', 'TABLE t' -> 't', 'COLUMN t.c' -> 't'."""
    name = tag.split(" ", 1)[1] if " " in tag else tag
    if tag.startswith("COLUMN "):
        name = name.split(".", 1)[0]
    return name.split("(", 1)[0].strip('"')


def cmd_toc_filter(args: argparse.Namespace) -> int:
    """Drop what a plain-Postgres drill target cannot restore, and nothing else:
      * EXTENSION / COMMENT ON EXTENSION for extensions the target lacks (or
        listed in --skip-extensions);
      * ACL / COMMENT entries on member objects of those extensions. Supabase
        grants on e.g. vault.secrets, so pg_dump writes GRANTs for objects that
        only CREATE EXTENSION would create. A member object is one in the
        extension's schema that the dump itself does not define;
      * with --existing-tables, TABLE DATA for tables the target lacks after
        pre-data (extension config tables such as vault.secrets).
    Every skipped entry is reported."""
    available = {
        line.strip()
        for line in Path(args.available_extensions).read_text(encoding="utf-8").splitlines()
        if line.strip()
    }
    available -= {e.strip() for e in (args.skip_extensions or "").split(",") if e.strip()}
    ext_schema: dict[str, str] = {}
    if args.extension_sql:
        for name, schema in CREATE_EXT_RE.findall(Path(args.extension_sql).read_text(encoding="utf-8")):
            ext_schema[name.strip('"')] = schema.strip('"')
    tables: list[str] | None = None
    if args.existing_tables:
        tables = [
            line.rstrip("\n")
            for line in Path(args.existing_tables).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
    lines = sys.stdin.readlines()

    entries = []
    for line in lines:
        m = TOC_ENTRY_RE.match(line.rstrip("\n"))
        entries.append(_toc_parts(m.group(1)) if m else None)
    dumped_exts = {m.group(1) for line in lines if (m := TOC_EXT_RE.match(line))}
    missing_exts = {e for e in dumped_exts if e not in available}
    member_schemas = {ext_schema[e] for e in missing_exts if e in ext_schema} - {"public", "pg_catalog"}
    defined = {
        (ns, tag.split("(", 1)[0].strip('"'))
        for parts in entries
        if parts
        for desc, ns, tag in [parts]
        if desc not in MEMBER_ATTRIBUTE_DESCS and desc not in DATA_DESCS
    }
    schemas_defined = {tag for parts in entries if parts for desc, ns, tag in [parts] if desc == "SCHEMA"}

    skipped_ext: list[str] = []
    skipped_member: list[str] = []
    skipped_data: list[str] = []
    out = []
    for line, parts in zip(lines, entries):
        stripped = line.rstrip("\n")
        if parts is None:
            out.append(line)
            continue
        desc, ns, tag = parts
        m = TOC_EXT_RE.match(stripped) or TOC_EXT_COMMENT_RE.match(stripped)
        if m and m.group(1) in missing_exts:
            if desc == "EXTENSION":
                skipped_ext.append(m.group(1))
            out.append(";" + line)
            continue
        if desc in MEMBER_ATTRIBUTE_DESCS:
            if ns in member_schemas and (ns, _object_base(tag)) not in defined:
                skipped_member.append(f"{desc} {ns}.{_object_base(tag)}")
                out.append(";" + line)
                continue
            if ns == "-" and tag.startswith("SCHEMA ") and tag[7:] in member_schemas and tag[7:] not in schemas_defined:
                skipped_member.append(f"{desc} {tag}")
                out.append(";" + line)
                continue
        m = TOC_DATA_RE.match(stripped)
        if m and tables is not None:
            rest = m.group(1)
            # "schema table owner": match on the "schema table " prefix that the
            # target actually has, instead of splitting names on spaces.
            if not any(rest == t or rest.startswith(t + " ") for t in tables):
                skipped_data.append(" ".join(rest.split(" ")[:2]))
                out.append(";" + line)
                continue
        out.append(line)
    sys.stdout.write("".join(out))
    if skipped_ext:
        eprint("toc-filter: extensions not restored in the drill target: " + ", ".join(sorted(set(skipped_ext))))
    if skipped_member:
        eprint(f"toc-filter: {len(skipped_member)} ACL/COMMENT entries on those extensions' member objects skipped")
    if skipped_data:
        eprint(
            "toc-filter: table data without a table in the drill target "
            "(extension-owned config tables; not restored): " + ", ".join(sorted(skipped_data))
        )
    if args.report:
        Path(args.report).write_text(
            json.dumps(
                {
                    "skipped_extensions": sorted(set(skipped_ext)),
                    "skipped_member_attributes": sorted(skipped_member),
                    "skipped_data": sorted(skipped_data),
                }
            )
            + "\n",
            encoding="utf-8",
        )
    return 0


# --------------------------------------------------------------------------- #
# project-toc
# --------------------------------------------------------------------------- #
PLATFORM_LEDGERS = ("auth schema_migrations", "storage migrations")


def cmd_project_toc(args: argparse.Namespace) -> int:
    """TOC lists for restore_into_project.sh (a NEW Supabase project).
      data:     TABLE DATA / SEQUENCE SET of the app schemas plus auth and
                storage rows, minus the platform's own migration ledgers.
      platform: app-defined TRIGGER / POLICY entries on auth/storage tables
                (e.g. migration 309's trigger on auth.users) that the target
                does not already have. --existing lists 'schema table name'."""
    schemas = set(args.app_schemas.split(",")) | {"auth", "storage"}
    existing = []
    if args.existing:
        existing = [l for l in Path(args.existing).read_text(encoding="utf-8").splitlines() if l.strip()]
    out = []
    picked = 0
    for line in sys.stdin:
        m = TOC_ENTRY_RE.match(line.rstrip("\n"))
        if not m:
            continue
        desc, ns, tag = _toc_parts(m.group(1))
        rest = m.group(1)[len(desc) + 1 :]
        if args.mode == "data":
            if desc in ("TABLE DATA", "SEQUENCE SET") and ns in schemas:
                if desc == "TABLE DATA" and any(rest.startswith(x + " ") for x in PLATFORM_LEDGERS):
                    continue
                out.append(line)
                picked += 1
        elif desc in ("TRIGGER", "POLICY") and ns in ("auth", "storage"):
            if not any(rest == e or rest.startswith(e + " ") for e in existing):
                out.append(line)
                picked += 1
    sys.stdout.write("".join(out))
    eprint(f"project-toc {args.mode}: {picked} entries")
    return 0


# --------------------------------------------------------------------------- #
# verify-storage
# --------------------------------------------------------------------------- #
def load_objects(storage_dir: Path) -> list[dict]:
    rows = []
    with open(storage_dir / "objects.jsonl", encoding="utf-8") as fh:
        for line in fh:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def cmd_verify_storage(args: argparse.Namespace) -> int:
    root = Path(args.dir)
    objects = load_objects(root)
    base = root / "objects"
    expected = set()
    bad_hash = missing = 0
    total = 0
    for obj in objects:
        rel = Path(obj["bucket"]) / obj["name"]
        expected.add(rel.as_posix())
        path = base / rel
        if not path.is_file():
            missing += 1
            continue
        digest = hashlib.sha256()
        size = 0
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(CHUNK)
                if not chunk:
                    break
                digest.update(chunk)
                size += len(chunk)
        total += size
        if digest.hexdigest() != obj["sha256"] or size != obj["size"]:
            bad_hash += 1
    extra = 0
    if base.exists():
        for path in base.rglob("*"):
            if path.is_file() and path.relative_to(base).as_posix() not in expected:
                extra += 1
    summary = {
        "objects": len(objects),
        "bytes": total,
        "missing": missing,
        "checksum_mismatch": bad_hash,
        "unlisted_files": extra,
    }
    print(json.dumps(summary))
    if missing or bad_hash or extra:
        eprint(
            f"::error::storage verification failed: {missing} missing, "
            f"{bad_hash} checksum/size mismatches, {extra} files not in the manifest"
        )
        return 1
    eprint(f"storage verified: {len(objects)} objects, {total} bytes, all sha256 match")
    return 0


# --------------------------------------------------------------------------- #
# db-checks
# --------------------------------------------------------------------------- #
def psql(url: str, sql: str) -> str:
    proc = subprocess.run(
        ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", "\x1f", "-d", url, "-c", sql],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        # psql errors can quote row values; keep them out of public logs.
        first = (proc.stderr.strip().splitlines() or ["(no stderr)"])[0]
        sqlstate = re.search(r"ERROR:\s+([^:]+)", first)
        raise RuntimeError("psql failed: " + (sqlstate.group(1)[:120] if sqlstate else "see local log"))
    return proc.stdout


def cmd_db_checks(args: argparse.Namespace) -> int:
    bundle = Path(args.bundle)
    url = args.target
    failures: list[str] = []
    result: dict[str, object] = {}

    skipped_data: set[str] = set()
    if args.toc_report and Path(args.toc_report).is_file():
        report = json.loads(Path(args.toc_report).read_text(encoding="utf-8"))
        skipped_data = set(report.get("skipped_data", []))

    # 1. Exact row counts for every table that had data in the dump.
    expected: dict[str, int] = {}
    for line in (bundle / "db" / "rowcounts.tsv").read_text(encoding="utf-8").splitlines():
        ident, count = line.rsplit("\t", 1)
        expected[ident] = int(count)
    checked = mismatched = 0
    not_restored_rows = 0
    mismatch_names: list[str] = []
    to_query = []
    skipped_idents = {s.replace(" ", ".", 1) for s in skipped_data}
    include = {x for x in (args.include_schemas or "").split(",") if x}
    exclude = {x for x in (args.exclude_tables or "").split(",") if x}
    for ident in list(expected):
        plain = ident.replace('"', "")
        if (include and plain.split(".", 1)[0] not in include) or plain in exclude:
            del expected[ident]
    for ident in expected:
        if ident.replace('"', "") in skipped_idents:
            not_restored_rows += expected[ident]
            continue
        to_query.append(ident)
    for start in range(0, len(to_query), 200):
        batch = to_query[start : start + 200]
        sql = " UNION ALL ".join(
            f"SELECT {i}::int, count(*) FROM {ident}" for i, ident in enumerate(batch, start)
        )
        for row in psql(url, sql).splitlines():
            idx, count = row.split("\x1f")
            ident = to_query[int(idx)]
            checked += 1
            if int(count) != expected[ident]:
                mismatched += 1
                mismatch_names.append(ident)
    result["tables_checked"] = checked
    result["rows_checked"] = sum(expected[i] for i in to_query)
    result["tables_mismatched"] = mismatched
    result["rows_in_unrestorable_extension_tables"] = not_restored_rows
    if mismatched:
        failures.append(f"row-count mismatch in {mismatched} tables: {', '.join(mismatch_names[:20])}")
    if not checked:
        failures.append("no table data was restored")

    # 2. Migration ledger present.
    ledger = psql(url, "SELECT to_regclass('public._schema_migrations') IS NOT NULL").strip()
    if ledger == "t":
        latest = psql(url, "SELECT count(*), coalesce(max(filename), '') FROM public._schema_migrations")
        n, newest = latest.strip().split("\x1f")
        result["migrations_applied"] = int(n)
        result["latest_migration"] = newest
        if int(n) == 0:
            failures.append("_schema_migrations is empty")
    else:
        failures.append("public._schema_migrations is missing")

    # 3. Auth users present (an empty auth.users means a broken or wrong dump).
    if args.expect_users:
        users = psql(url, "SELECT count(*) > 0 FROM auth.users").strip()
        result["auth_users_present"] = users == "t"
        if users != "t":
            failures.append("auth.users is empty")

    # 4. storage.objects rows vs the exported bytes. The DB is dumped before
    # Storage is listed, so a few objects created/deleted in between are normal.
    storage_dir = bundle / "storage"
    if (storage_dir / "objects.jsonl").is_file():
        exported = {(o["bucket"], o["name"]) for o in load_objects(storage_dir)}
        raw = psql(
            url, "COPY (SELECT bucket_id, name FROM storage.objects) TO STDOUT WITH (FORMAT csv)"
        )
        in_db = {(r[0], r[1]) for r in csv.reader(io.StringIO(raw)) if r}
        only_db = len(in_db - exported)
        only_storage = len(exported - in_db)
        tolerance = max(args.min_drift, int(len(in_db) * args.drift_ratio))
        result["storage_objects_in_db"] = len(in_db)
        result["storage_objects_exported"] = len(exported)
        result["db_rows_without_bytes"] = only_db
        result["bytes_without_db_row"] = only_storage
        result["drift_tolerance"] = tolerance
        if only_db + only_storage > tolerance:
            failures.append(
                f"storage drift {only_db}+{only_storage} exceeds tolerance {tolerance}"
            )

    result["failures"] = failures
    print(json.dumps(result))
    for failure in failures:
        eprint(f"::error::restore drill check failed: {failure}")
    return 1 if failures else 0


# --------------------------------------------------------------------------- #
# pick-latest
# --------------------------------------------------------------------------- #
def cmd_pick_latest(args: argparse.Namespace) -> int:
    best = None
    for key in sys.stdin.read().split():
        m = STAMP_RE.search(key)
        if m and (best is None or m.group(1) > best[0]):
            best = (m.group(1), key)
    if best is None:
        eprint("::error::no complete backup (meta.json) found under the destination prefix")
        return 1
    print(best[1])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("hashpipe")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_hashpipe)

    p = sub.add_parser("rowcounts")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_rowcounts)

    p = sub.add_parser("roles-filter")
    p.add_argument("--existing-roles", required=True)
    p.add_argument("--current-user", required=True)
    p.add_argument("--only-missing", action="store_true")
    p.set_defaults(func=cmd_roles_filter)

    p = sub.add_parser("toc-filter")
    p.add_argument("--available-extensions", required=True)
    p.add_argument("--existing-tables", help="'schema table' per line; filters TABLE DATA")
    p.add_argument("--extension-sql", help="pg_restore SQL of the EXTENSION entries (gives their schemas)")
    p.add_argument("--skip-extensions", help="comma list treated as unavailable in the target")
    p.add_argument("--report")
    p.set_defaults(func=cmd_toc_filter)

    p = sub.add_parser("project-toc")
    p.add_argument("--mode", choices=("data", "platform"), required=True)
    p.add_argument("--app-schemas", default="public")
    p.add_argument("--existing", help="'schema table name' of triggers/policies already in the target")
    p.set_defaults(func=cmd_project_toc)

    p = sub.add_parser("verify-storage")
    p.add_argument("--dir", required=True)
    p.set_defaults(func=cmd_verify_storage)

    p = sub.add_parser("db-checks")
    p.add_argument("--target", required=True)
    p.add_argument("--bundle", required=True)
    p.add_argument("--toc-report")
    p.add_argument("--expect-users", action="store_true")
    p.add_argument("--drift-ratio", type=float, default=0.005)
    p.add_argument("--min-drift", type=int, default=10)
    p.add_argument("--include-schemas", help="comma list; compare only these schemas")
    p.add_argument("--exclude-tables", help="comma list of schema.table to skip")
    p.set_defaults(func=cmd_db_checks)

    p = sub.add_parser("pick-latest")
    p.set_defaults(func=cmd_pick_latest)

    args = parser.parse_args()
    try:
        return args.func(args)
    except BrokenPipeError:
        eprint("::error::downstream pipe closed early")
        return 1
    except RuntimeError as exc:
        eprint(f"::error::{exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
