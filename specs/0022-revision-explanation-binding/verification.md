# Verification

## Requirement coverage

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=test; ref=backend/tests/test_explanation_version_reason_postgres.py; real PostgreSQL R+L × none / multiple / pinned / historical-only / single, negative control against 260 (#1692 CI `075ae26`). Staging 2026-10-26 04:24Z and production 04:53Z (rolled-back calls): unbound REV paper → `web_explanation_content_version_unavailable:none`; bound C19T1 REV01 → approved, 40 objects, signature/grants unchanged | PASS |
| FR-002 | kind=test; ref=backend/tests/test_class_assignment_service.py; `test_scoped_exam_version_refusal_names_the_cause` (R+L × 4) and `frontend/tests/admin-class-homework-next-behavior.test.mjs`, shipped in #1689 and promoted via #1695 | PASS |
| FR-003 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py; dry-run default, one named paper, operator-named version (#1692) | PASS |
| FR-004 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py; every refusal incl. canonical list, scoring override, reviewed-change mismatch, malformed rows, authored response_policy, unreadable test-level audio (#1692 `075ae26`) | PASS |
| FR-005 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py; revision identity, source version, pending rights/editorial, source rows untouched (#1692) | PASS |
| FR-006 | kind=test; ref=backend/tests/test_bind_revision_web_explanations.py; plan SHA covers fingerprints (incl. Listening test-level audio SHA-256) and reviewed changes; single insert and read-back (#1692) | PASS |
| FR-007 | kind=query; ref=https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1692; C19T1 REV01 R+L 2026-10-25: owner-reviewed changes (R 1–23,27–40; L 1–40), staging rehearsal on QA-CAM19 copies, production plan SHAs e43b2e1d…/e459ba28…, import batches 67c47f5a…/f0212a9a…, read-back 40/40, 320 source objects and attempts unchanged; 2026-10-26 read-only check: no response policies, source/REV full.mp3 SHA-256 identical (2c0ff96a…) | PASS |
| FR-008 | kind=query; ref=https://github.com/andyvinhtran1212-netizen/ielts-speaking-coach/pull/1692; 319 applied under advisory lock 173204 with ledger re-check: staging 2026-10-26 04:24:47Z, production 04:53:19Z, before promotion; only pending file in both ledgers; #1699 uses 320 | PASS |

Each further REV binding adds its own FR-007 record (T008).
