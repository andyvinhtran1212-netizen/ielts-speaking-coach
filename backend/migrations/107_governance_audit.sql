-- Migration: 107_governance_audit.sql
-- Mô tả: W-8-core — append-only audit cho hành vi GOVERNANCE nhạy cảm, trước hết
-- là admin IMPERSONATION (?as_instructor). Mỗi lần admin "xem như giảng viên"
-- ghi đúng 1 dòng (admin_id, target_instructor, path) — không thể tắt, không sửa.
--
-- ADDITIVE. Andy chạy TAY trong Supabase SQL editor TRƯỚC khi merge PR W-8-core
-- (route _me sẽ INSERT vào bảng này mỗi impersonated request).
--
-- Design (mirror access_code_audit / mig 099):
--   • APPEND-ONLY — app chỉ INSERT, không UPDATE/DELETE.
--   • NO foreign keys on admin_id / target_instructor — audit phải SỐNG SÓT khi
--     user bị xoá (cascade sẽ xoá đúng lịch sử cần giữ).
--   • detail = path/essay-id admin chạm tới khi impersonate (forensic trail).

CREATE TABLE IF NOT EXISTS governance_audit (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action            TEXT        NOT NULL,   -- 'impersonate' (mở rộng sau nếu cần)
    admin_id          UUID,                   -- admin thực hiện (no FK: sống sót delete)
    target_instructor UUID,                   -- giảng viên bị impersonate
    detail            TEXT,                   -- path/essay-id chạm tới (forensic)
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Read path: "lịch sử impersonation của 1 admin", mới nhất trước.
CREATE INDEX IF NOT EXISTS idx_governance_audit_admin
    ON governance_audit (admin_id, created_at DESC);

-- ── Reverse (chạy tay nếu cần gỡ) ─────────────────────────────────────────────
-- DROP TABLE IF EXISTS governance_audit;
