# Verification

## Requirement coverage

Mọi dòng ở trạng thái `PENDING`: spec đang `draft` và chưa có dòng mã nào. Cột bằng chứng ghi bằng chứng **dự kiến** theo task. Khi mã merge, dòng đổi sang `PASS`/`MANUAL`/`N/A` theo mẫu `specs/_templates/verification.md`.

| Requirement | Evidence | Result |
| --- | --- | --- |
| FR-001 | kind=command; ref=plan.md lệnh kiểm kê ở `5987bc018`: 3100 file, 391706682 byte, 1482 SHA-256 khác nhau, 1481 nhóm trùng; cây legacy = bản hiện hành (lệch 0, thiếu 0); đổi sang PASS khi người review chạy lại lệnh | PENDING |
| FR-002 | kind=query; ref=plan.md rà tham chiếu trong repo (đã làm) + ba truy vấn đếm staging/production (T001) | PENDING |
| FR-003 | kind=command; ref=curl Range 206 + so SHA-256: URL có checksum với bảng kê `5987bc018`, URL legacy với bản hiện hành theo manifest (T002, T004); Scenario 1, 2 | PENDING |
| FR-004 | kind=test; ref=backend/tests/test_advanced_vocab_package_validator.py ca sync khi cờ bật: D ghi `versions/` + legacy đồng bộ trước T005, không tạo legacy sau T005; A/B không ghi public (T003, T005); Scenario 4 | PENDING |
| FR-005 | kind=manual; ref=phát hành checksum mới khi cờ bật rồi tắt cờ trên staging, Scenario 6 (T004); `--restore-legacy` trên nhánh preview, Scenario 7 (T005) | PENDING |
| FR-006 | kind=command; ref=routes-manifest.json khi cờ tắt so với `5987bc018` (T002); Scenario 3 | PENDING |
| FR-007 | kind=test; ref=test bảng rewrite khớp manifest (D) hoặc test script tải lên từ chối SHA lệch (A/B) (T002/T006); Scenario 5 | PENDING |
| FR-008 | kind=test; ref=frontend/tests CSP hiện có không đổi; diff `content-security-policy.mjs` rỗng (T002–T006) | PENDING |
| FR-009 | kind=test; ref=test_advanced_vocab_service.py::test_core30_assets_exist_for_every_card_and_core_media và advanced-vocabulary-next-behavior.test.mjs chạy qua trước và sau T005 | PENDING |

## T002–T003 evidence (G10-T18, option D, 2026-11-23, base `cc6dd4c8`)

Option D is the working choice for Q-e1 taken by the coordinator as reversible
(flag off by default, no file removed, no env changed); anh Andy confirms Q-e1
when reviewing the PR.

- FR-006 / Scenario 3: `npm run build` with the flag unset; the `rewrites` of
  `.next/routes-manifest.json` equal those of base `cc6dd4c8` (0 `beforeFiles`).
  `frontend/tests/advanced-vocab-legacy-rewrites.test.mjs`: values `''`, `0`,
  `true`, `yes`, ` 1` and unset give no rule.
- FR-003 / FR-007 (D): with `AVER_ADVANCED_VOCAB_LEGACY_REWRITE=1` the build has
  30 `beforeFiles` rules, one per lesson, onto
  `versions/<lesson>/<checksum in core30-manifest.json>/`. The test checks the
  table equals the manifest and every legacy file (1,524) is byte-identical to
  its rewrite target.
- Scenario 2 (local `next start`, flag on): with the legacy `ADV-T07/` directory
  moved out of `public/`, `Range: bytes=0-99` on
  `/assets/advanced-vocab/ADV-T07/listening/full_test.mp3` returns 206 with 100
  bytes equal to the head of `versions/ADV-T07/<current>/listening/full_test.mp3`;
  the full file SHA-256 matches; a `vocab/` file returns 200. Preview run still
  to do in T004.
- `route-ownership-check.mjs` (source and `--manifest`): clean.
  `verify-csp-nonce-404-flow.mjs --enforced` on a build with the rewrite flag
  and `AVER_CSP_NONCE_ENFORCE=1`: passes, "no rewrite routes a URL under the
  nonce prefixes".
- FR-004 (D) / FR-005: `sync_advanced_vocab_core30.py --write` still writes the
  legacy tree and now rewrites `advanced-vocab-legacy-table.mjs` from the
  manifest it writes. `--restore-legacy` (dry-run default, `--write` to copy)
  rebuilds `/<lesson>/` from `versions/<lesson>/<current checksum>/`, checks
  SHA-256, refuses extra legacy files and a version directory whose file count
  differs from `asset_count`; on the repo it reports 1,524 files, 0 to rebuild.
  The "already deployed" check now reads the manifests instead of
  `_PUBLIC.rglob`. Tests in `backend/tests/test_advanced_vocab_package_validator.py`.
- FR-008: `content-security-policy.mjs` unchanged.

