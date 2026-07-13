# ADR-009 — Backend/environment N/N−1 compatibility

**Status:** ACCEPTED 2026-07-13 · Plan v3 §8.5, §12.4, B23/B32

## Quyết định
1. FastAPI duy trì compatibility cho frontend N và N−1 suốt rollback window của mọi route đã cutover: không xóa field/endpoint khi eligible legacy/rollback deployment còn tồn tại; deprecation = additive trước, remove sau khi window đóng.
2. Schema changes trong window: backward-compatible only (additive cột/bảng; không destructive) — đúng convention migrations forward-only hiện tại.
3. Secret/key rotation: overlap bắt buộc (cả key cũ và mới sống trong window) hoặc freeze rotation trong window. Ghi nhận thực tế: staging DB password rotation 2026-07-13 làm gãy clone script — bài học cùng loại.
4. N/N−1 consumer test: trước mutation pilot, chạy legacy client contract tests với backend HEAD (backend-deploy/frontend-rollback drill — Pilot Entry checklist).
5. Environment certification per release (đã có mẫu: docs/ENV_CERTIFICATION_STAGING_2026-07-13.md); production candidate + rollback target có provenance artifact đối xứng.
