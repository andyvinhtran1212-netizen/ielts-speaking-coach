"""q-122 — STAGING backfill of the Content Manager's "demographic" gloss correction.

The Vocabulary Wiki reads vocab_cards first, so the markdown fix in
content_vocab/people-society/demographic.md changes nothing learners see until
the row is updated. This touches exactly one row (people-society/demographic):

  gloss_vi   ← the CM short gloss (NOT the body's first paragraph, which is what
               the importer would derive — see note below)
  body_html  ← the markdown file rendered by the importer's own pipeline
               (parse_vocab_markdown), so its first <p> carries the corrected sentence

definition_vi stays as it is ('' on staging). It is the curated quiz meaning that
takes priority over gloss_vi in the quiz/listening generators, so filling it
would be a separate decision.

Guards: refuses unless the target is the staging project. The UPDATE matches only
when gloss_vi and body_html still hold the values read at plan time (optimistic
concurrency), and it aborts unless exactly one row changed. Without --commit the
UPDATE runs inside a DO block that always ends in RAISE, so Postgres rolls it back;
the in-transaction readback is printed from the error message (dry run).

Note: a later re-import of the markdown would reset gloss_vi to the body's first
paragraph text (vocab_import.parse_vocab_markdown), overwriting this short gloss.

Usage (needs SUPABASE_ACCESS_TOKEN, Supabase Management API, HTTPS only):
  python3 backend/scripts/backfill_demographic_gloss_staging.py            # dry run
  python3 backend/scripts/backfill_demographic_gloss_staging.py --commit   # write
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
# vocab_import imports database.py (a Supabase client) and the vocab service,
# which tries a vocab_cards read at import time. Only the markdown parser is used
# here and every DB access goes through the Management API below, so point the
# client at a closed local port: that read fails fast ("markdown fallback" log
# line) and nothing leaves the machine.
os.environ.setdefault("SUPABASE_URL", "http://127.0.0.1:9")
os.environ.setdefault("SUPABASE_ANON_KEY", "unused")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "unused")

from services.vocab_import import parse_vocab_markdown  # noqa: E402

STAGING_REF = "zjphffoujxkpltixsbzj"
CATEGORY, SLUG = "people-society", "demographic"
MD_PATH = BACKEND / "content_vocab" / CATEGORY / f"{SLUG}.md"

NEW_GLOSS_VI = "nhóm nhân khẩu (nhóm người cùng độ tuổi, thu nhập…); (tính từ) thuộc nhân khẩu học"
NEW_EXPLANATION = (
    "Nhóm nhân khẩu; thuộc nhân khẩu học — (danh từ) một nhóm người trong xã hội được "
    "phân loại theo độ tuổi, giới tính, thu nhập, v.v.; (tính từ) liên quan đến cấu trúc "
    "và đặc điểm của dân số."
)


def run_sql(sql: str, *, allow_error: bool = False):
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        sys.exit("SUPABASE_ACCESS_TOKEN is not set")
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{STAGING_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "q122-demographic-gloss"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read() or b"[]"
            return (r.status, body.decode()) if allow_error else json.loads(body)
    except urllib.error.HTTPError as e:
        text = e.read().decode(errors="replace")
        if allow_error:
            return e.code, text
        sys.exit(f"Management API HTTP {e.code}: {text}")


def lit(value: str) -> str:
    """Dollar-quoted SQL literal; refuses a value that contains the tag."""
    tag = "$q122$"
    if tag in value:
        raise ValueError("value contains the dollar-quote tag")
    return f"{tag}{value}{tag}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--commit", action="store_true", help="write (default: dry run, rolled back)")
    args = ap.parse_args()

    parsed = parse_vocab_markdown(MD_PATH.read_text(encoding="utf-8"))
    if (parsed.category, parsed.slug) != (CATEGORY, SLUG):
        sys.exit(f"refusing: {MD_PATH} parsed as {parsed.category}/{parsed.slug}")
    if parsed.gloss_vi != NEW_EXPLANATION:
        sys.exit("refusing: the markdown's first paragraph is not the CM sentence:\n"
                 f"  {parsed.gloss_vi!r}")
    new_body_html = parsed.body_html

    where = f"category = {lit(CATEGORY)} and slug = {lit(SLUG)}"
    rows = run_sql(f"select id, gloss_vi, definition_vi, body_html, updated_at "
                   f"from public.vocab_cards where {where};")
    if len(rows) != 1:
        sys.exit(f"refusing: expected 1 row for {CATEGORY}/{SLUG}, found {len(rows)}")
    before = rows[0]

    changes = {k: v for k, v in (("gloss_vi", NEW_GLOSS_VI), ("body_html", new_body_html))
               if before[k] != v}
    mode = "COMMIT" if args.commit else "DRY RUN (rolled back)"
    print(f"[q122] target project={STAGING_REF} row={before['id']} mode={mode}")
    for col in ("gloss_vi", "body_html"):
        state = "CHANGE" if col in changes else "unchanged"
        print(f"\n--- {col}: {state}\n  before: {before[col]!r}")
        if col in changes:
            print(f"  after:  {changes[col]!r}")
    print(f"\n--- definition_vi: not touched (current {before['definition_vi']!r})")
    if not changes:
        print("\n[q122] nothing to do — row already matches")
        return

    sets = ", ".join(f"{col} = {lit(val)}" for col, val in changes.items())
    guard = (f"gloss_vi = {lit(before['gloss_vi'])} "
             f"and body_html = {lit(before['body_html'])}")
    # One DO block = one atomic statement. It aborts unless exactly one row
    # matched; a dry run always ends in RAISE, so Postgres rolls the UPDATE back
    # and the readback travels in the error message.
    finish = ("" if args.commit else
              "  raise exception 'Q122_DRYRUN %', readback;\n")
    sql = f"""do $do$
declare n int; readback json;
begin
  update public.vocab_cards set {sets}, updated_at = now() where {where} and {guard};
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'q122: expected 1 updated row, got %', n; end if;
  select json_build_object('id', id, 'gloss_vi', gloss_vi, 'definition_vi', definition_vi,
                           'body_html_head', left(body_html, 400), 'updated_at', updated_at)
    into readback from public.vocab_cards where {where};
{finish}end $do$;"""
    if args.commit:
        run_sql(sql)
        readback = run_sql(f"select id, gloss_vi, definition_vi, left(body_html, 400) as "
                           f"body_html_head, updated_at from public.vocab_cards where {where};")
    else:
        status, text = run_sql(sql, allow_error=True)
        # Error body: {"message": "Failed to run sql query: ERROR:  P0001: Q122_DRYRUN {…}\nCONTEXT: …"}
        try:
            message = json.loads(text).get("message", "")
        except (ValueError, AttributeError):
            message = ""
        marker = "Q122_DRYRUN "
        if marker not in message:
            sys.exit(f"[q122] dry run failed (HTTP {status}): {text}")
        payload = message.split(marker, 1)[1]
        readback, _ = json.JSONDecoder().raw_decode(payload)
    print(f"\n[q122] in-transaction readback ({mode}):")
    print(json.dumps(readback, ensure_ascii=False, indent=2))

    final = run_sql(f"select gloss_vi, body_html, updated_at from public.vocab_cards where {where};")[0]
    print(f"\n[q122] row after request: gloss_vi={final['gloss_vi']!r} updated_at={final['updated_at']}")
    if not args.commit:
        unchanged = (final["gloss_vi"], final["body_html"]) == (before["gloss_vi"], before["body_html"])
        print(f"[q122] dry run left the row unchanged: {unchanged}")
        if not unchanged:
            sys.exit("[q122] ERROR: dry run left the row changed")


if __name__ == "__main__":
    main()
