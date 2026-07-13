# Environment Certification — Staging (2026-07-13)

Artifact theo mục 7.1 của `FE_NEXTJS_MIGRATION_MASTER_PLAN_2026-07-12.md` (v3).
Phạm vi certify lần này: **backend staging**. Frontend staging chưa certify (xem "Chưa đạt / Pending").

## Backend (Railway)

| Hạng mục | Giá trị | Bằng chứng |
|---|---|---|
| URL | `https://ielts-speaking-coach-staging.up.railway.app` | `/health` HTTP 200, version `phase-d-wave-2` |
| Cách tạo | Railway environment `staging`, duplicate từ production, override variables theo nhóm 1–3 (xem bên dưới) | Thao tác dashboard 2026-07-13 |
| ENVIRONMENT | `staging` | Railway variable override |

## Database / Supabase staging

| Hạng mục | Giá trị | Bằng chứng |
|---|---|---|
| Project ref | `zjphffoujxkpltixsbzj` (region ap-northeast-1) | `.env.staging`; khác production `huwsmtubwulikhlmcirx` và legacy `nqhrtqspznepmveyurzm` |
| Schema | Clone cấu trúc từ production 2026-07-13 bằng `backend/scripts/staging_clone_schema_from_prod.sh` (schema-only, zero data) | 78 tables, 76 bảng bật RLS, 112 policies, 25 functions |
| Vì sao clone thay vì replay migrations | `backend/migrations/001+` là ALTER trên base schema ngoài repo — không bootstrap được từ zero | Plan v3 §3.1; migration 001 fail `relation "responses" does not exist` trên DB trống |
| Migrations tăng dần về sau | Dùng `backend/scripts/apply_migrations.sh` (có production guard) cho migration 155+ | Script trong repo |
| Dữ liệu | 0 rows toàn bộ | Kiểm tra `pg_stat_user_tables` |
| DB password | Rotate 2026-07-13, cập nhật `.env.staging` + Railway | |

## Cách ly production — PROVEN

| Kiểm tra | Staging | Production | Kết luận |
|---|---|---|---|
| `GET /api/public-stats` | `{"total_users":0,"sessions_completed":0}` | `{"total_users":67,"sessions_completed":3035}` | Backend staging đọc DB staging, không phải production |
| Auth gate `GET /auth/me` không token | HTTP 401 | — | Auth middleware hoạt động |

## CORS

Preflight `OPTIONS` với `Origin: https://staging.averlearning.com` → 200, `access-control-allow-origin: https://staging.averlearning.com`, `allow-credentials: true`, methods `GET, POST, PATCH, DELETE, OPTIONS`, headers gồm `Authorization`, `X-Reading-*`, `X-Request-ID`. Nguồn: regex `^https://(?:[a-z0-9-]+\.)?averlearning\.com$` tại `backend/main.py:138` — không cần sửa backend.

## Storage buckets (tạo 2026-07-13 qua Storage API)

| Bucket | Public |
|---|---|
| `audio-responses` | ✅ |
| `writing-images` | ✅ |
| `vocab-audio` | ✅ |
| `listening-audio` | ❌ (signed URL) |
| `listening-images` | ❌ (signed URL) |
| `reading-images` | ❌ (signed URL) |

## OAuth

- Google provider bật trên Supabase staging với OAuth client riêng cho staging (user xác nhận 2026-07-13).
- Callback Supabase: `https://zjphffoujxkpltixsbzj.supabase.co/auth/v1/callback` (đăng ký trong Google Cloud console).
- Site URL / Redirect URLs: `https://staging.averlearning.com`.

## Variables đã override trên Railway staging (manifest)

- Nhóm 1: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL`, `ENVIRONMENT=staging`, `READING_ANON_SALT` (salt riêng).
- Nhóm 3: `MAX_SESSIONS_PER_USER_PER_DAY` nới cho test.
- Nhóm 4 giữ parity production: model selectors, bucket names, feature flags, reaper settings.

## Provider mode

**Real AI providers** — chưa có deterministic fixture mode (deliverable Phase 0). E2E chạy trên staging hiện tại sẽ gọi Whisper/Claude/Gemini thật và tốn tiền thật.

## Chưa đạt / Pending

| Hạng mục | Trạng thái | Ghi chú |
|---|---|---|
| `staging.averlearning.com` (frontend) | ✅ LIVE (cập nhật cùng ngày) — CNAME `staging` → `4a4c9e34c57b3708.vercel-dns-017.com` tại Squarespace Domains; Vercel domain gán **Preview + branch `staging`**; deployment `9731faa7` Ready | Được bảo vệ bởi **Vercel Authentication (Standard Protection)**: team member vào qua SSO tự động; E2E automation phải dùng "Protection Bypass for Automation" secret (Settings → Deployment Protection). Cập nhật staging frontend = merge main → `staging` rồi push |
| ~~Bằng chứng frontend CHƯA cách ly~~ → **ĐÃ CÁCH LY (cùng ngày, PR #730 merged, release `5f85d2bd`)** | ✅ Landing staging hiển thị **0+/0+** (staging DB) thay vì 67+/3K+ (production); `/js/runtime-config.js` trả `environment=staging` + toàn origins staging | Generated runtime config (§7.1): api base + Supabase client + perf-hints preconnect + public-stats đều environment-aware; preview build fail-closed nếu lộ production origin. Còn lại cho Gate A: network-trace assertion tự động (Playwright) và dọn hardcode inert theo từng route khi migrate |
| AI keys riêng cho staging (nhóm 2) | ☐ chưa xác nhận | Nếu đang dùng chung key production: ghi nhận là nợ, cần cost cap |
| **Frontend staging KHÔNG được coi là isolated** | ⚠ | Legacy hardcode Supabase production (111 files) + `api.js` trỏ non-localhost về Railway production → trang chạy trên `staging.averlearning.com` hôm nay vẫn gọi PRODUCTION. Chỉ hết sau khi làm generated runtime config (plan §7.1) |
| Seed synthetic identities (§7.2) | ☐ chưa có | Cần data factory (Phase 0) |
| Fixture mode fail-closed | ☐ chưa có | Deliverable Phase 0 |

## Kết luận

Backend staging **CERTIFIED** cho mục đích API-level testing và phát triển Phase 0. Frontend staging **NOT CERTIFIED** — chờ runtime config. Re-certify khi: đổi schema (ghi migration head mới), đổi provider mode, hoặc bật frontend staging.
