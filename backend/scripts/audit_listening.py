"""Bulk listening content-audit runner.

Runs the FULL audit (structural + audio-bounds + LLM content pass) over every
published listening test, persists each result to listening_audit (upsert),
and prints an aggregate report. Mirrors POST /admin/listening/tests/{id}/audit/run
but as a standalone CLI so a whole-library audit can run before the admin UI
ships / deploys.

Reuses services.listening_audit (the same engine the endpoint uses) and the
grading provider for LISTENING_AUDIT_MODEL. Writes to prod Supabase via .env.

Usage (from backend/):
  python3 scripts/audit_listening.py                 # all published, LLM + persist
  python3 scripts/audit_listening.py --no-llm        # structural/audio only
  python3 scripts/audit_listening.py --no-persist    # report only, no DB write
  python3 scripts/audit_listening.py --status all
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from config import settings                              # noqa: E402
from database import supabase_admin as sb                # noqa: E402
from services import listening_audit as audit           # noqa: E402


def _fetch_rows(test_uuid: str):
    t = sb.table("listening_tests").select("*").eq("id", test_uuid).limit(1).execute().data[0]
    c = sb.table("listening_content").select("*").eq("test_id", test_uuid).execute().data or []
    cids = [x["id"] for x in c]
    e = sb.table("listening_exercises").select("*").in_("content_id", cids).execute().data if cids else []
    return t, c, e


def _build_provider():
    from services.grading_orchestrator import _build_grading_primary
    ak = getattr(settings, "ANTHROPIC_API_KEY", "") or ""
    gk = getattr(settings, "GEMINI_API_KEY", "") or ""
    try:
        return _build_grading_primary(settings.LISTENING_AUDIT_MODEL, ak, gk)
    except Exception as exc:
        print(f"  ! provider build failed: {exc}", file=sys.stderr)
        return None


def _persist(test_uuid: str, status: str, health: dict, issues: list[dict]):
    row = {"test_id": test_uuid, "status": status, "health": health,
           "issues": issues, "auditor": "bulk-script"}
    existing = sb.table("listening_audit").select("id").eq("test_id", test_uuid).limit(1).execute()
    if existing.data:
        sb.table("listening_audit").update(row).eq("test_id", test_uuid).execute()
    else:
        sb.table("listening_audit").insert(row).execute()


async def audit_one(test, provider, use_llm: bool) -> dict:
    t, c, e = _fetch_rows(test["id"])
    h = audit.hydrate_test(t, c, e)
    issues = audit.structural_checks(h) + audit.audio_bounds_checks(h)
    if use_llm and provider is not None:
        issues.extend(await audit.llm_content_audit(h, provider.invoke))
    elif use_llm:
        issues.append({"q_num": None, "dimension": "solution", "severity": "warning",
                       "code": "llm_skipped", "resolved": False,
                       "message": "No audit model configured."})
    health = {**audit.summarize(issues), "question_count": len(h["all_questions"]),
              "llm": use_llm and provider is not None}
    return {"uuid": test["id"], "test_id": test.get("test_id"),
            "type": test.get("test_type") or "full",
            "health": health, "issues": issues}


async def main() -> int:
    ap = argparse.ArgumentParser(description="Bulk listening content audit.")
    ap.add_argument("--status", default="published", help="filter: published (default) | all")
    ap.add_argument("--no-llm", action="store_true", help="skip the LLM content pass")
    ap.add_argument("--no-persist", action="store_true", help="report only; no DB write")
    args = ap.parse_args()

    q = sb.table("listening_tests").select("id,test_id,test_type,metadata,status").order("test_id")
    if args.status != "all":
        q = q.eq("status", args.status)
    tests = q.execute().data or []
    use_llm = not args.no_llm
    provider = _build_provider() if use_llm else None

    print(f"== Bulk audit · {len(tests)} test · LLM={'on' if (use_llm and provider) else 'off'} "
          f"· persist={'off' if args.no_persist else 'on'} · model={settings.LISTENING_AUDIT_MODEL} ==\n")

    results = []
    for t in tests:
        r = await audit_one(t, provider, use_llm)
        results.append(r)
        if not args.no_persist:
            try:
                _persist(r["uuid"], r["health"]["status"], r["health"], r["issues"])
            except Exception as exc:
                print(f"  ! persist failed for {r['test_id']}: {exc}", file=sys.stderr)
        hc = r["health"]
        print(f"{r['test_id']:<28} {r['type']:<12} {hc['question_count']:>3}q  "
              f"{hc['error_count']} lỗi / {hc['warning_count']} cảnh báo  → {hc['status']}")

    # ── aggregate ────────────────────────────────────────────────────────────
    total_err = sum(r["health"]["error_count"] for r in results)
    total_warn = sum(r["health"]["warning_count"] for r in results)
    passed = [r for r in results if r["health"]["status"] == "passed"]
    has_issues = [r for r in results if r["health"]["status"] == "has_issues"]
    by_code = Counter()
    by_dim = Counter()
    for r in results:
        for i in r["issues"]:
            if i.get("resolved"):
                continue
            by_code[(i["severity"], i["code"])] += 1
            by_dim[(i["severity"], i["dimension"])] += 1

    print("\n" + "=" * 70)
    print(f"TỔNG: {len(results)} test · {len(passed)} đạt · {len(has_issues)} có lỗi")
    print(f"      {total_err} lỗi (error) · {total_warn} cảnh báo (warning)")

    print("\n-- Theo chiều (dimension) --")
    for (sev, dim), n in sorted(by_dim.items(), key=lambda x: (-x[1])):
        print(f"   {sev:<8} {dim:<12} {n}")

    print("\n-- Theo mã lỗi (code) --")
    for (sev, code), n in sorted(by_code.items(), key=lambda x: (-x[1])):
        print(f"   {sev:<8} {code:<22} {n}")

    if has_issues:
        print("\n-- Test có lỗi (cần xử lý) --")
        for r in has_issues:
            codes = Counter(i["code"] for i in r["issues"]
                            if i["severity"] == "error" and not i.get("resolved"))
            top = ", ".join(f"{c}×{n}" for c, n in codes.most_common(4))
            print(f"   {r['test_id']:<28} {top}")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
