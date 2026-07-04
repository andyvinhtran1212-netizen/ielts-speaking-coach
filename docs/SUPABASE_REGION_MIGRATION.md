# Runbook — Migrate Supabase từ ap-south-1 (Mumbai) → ap-southeast-1 (Singapore)

**Mục tiêu:** đưa database về cùng region với Railway (Singapore) để cắt ~56ms RTT/query.
Đo trước migration: `/auth/me` db=487ms, `/api/dashboard/init` db=731ms (66–85% tổng thời gian).
Kỳ vọng sau: db/query ~56ms → ~2–5ms ⇒ hai endpoint rớt về ~40–60ms tổng (**~10×**).

> **Nguyên tắc số 1:** region của một Supabase project là **BẤT BIẾN**. Không "đổi region" — phải
> **tạo project mới** ở `ap-southeast-1` rồi **migrate toàn bộ** (DB + auth users + storage) sang.

---

## 0. TL;DR trình tự

1. Tạo project mới ở **Southeast Asia (Singapore) — ap-southeast-1**.
2. Migrate **schema + data** (`public`) qua `pg_dump`/`psql`.
3. Migrate **auth users** (`auth.users` + `auth.identities`).
4. Migrate **Storage**: tạo lại buckets (đúng public/policy) + copy files.
5. Cấu hình lại **Auth**: Site URL, Redirect allowlist, **Google OAuth** (+ callback ở Google Cloud).
6. **Cutover** (maintenance window): đổi env Railway (3 biến) + sweep 99 file frontend + rebuild Tailwind + redeploy.
7. **Verify** bằng `backend/scripts/measure_hot_endpoints.py`.

**Downtime:** cần cửa sổ bảo trì ~30–90 phút (bước 6). Chọn giờ thấp điểm.

**Tác dụng phụ bắt buộc:** JWT secret của project mới **khác** → mọi session hiện tại **bị vô hiệu** → user phải **đăng nhập lại** (một cú click Google OAuth — chấp nhận được).

---

## 1. Inventory — những gì dự án này phụ thuộc vào Supabase

| Hạng mục | Giá trị hiện tại | Ghi chú migrate |
|---|---|---|
| Source project ref | `nqhrtqspznepmveyurzm` (ap-south-1) | URL: `https://nqhrtqspznepmveyurzm.supabase.co` |
| Anon (publishable) key | `sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4` | **đổi** ở frontend (97 file) |
| **Backend env (Railway)** | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` | 3 biến — đổi hết |
| **Frontend hardcode** | `nqhrtqspznepmveyurzm.supabase.co` trong **99 file**, anon key trong **97 file** | sed-sweep + rebuild Tailwind |
| Auth provider | **Google OAuth** (`signInWithOAuth`), `redirectTo` = `window.location.origin` (động) | cấu hình lại provider + callback Google Cloud |
| **Storage buckets** | `audio-responses` (**public**), `listening-audio`, `vocab-audio`, `writing-images` (public, optional), (+ verify reading bucket) | tạo lại + copy files + set public/policy |
| RPC functions | `fn_apply_srs_review`, `fn_completed_session_counts`, `fn_total_grading_minutes`, `quiz_user_bank_progress`, `create_session_daily_capped`, `srs_review_atomic`… | nằm trong schema dump → tự theo |
| Migrations | `backend/migrations/*.sql` (127 file) | **KHÔNG replay** — dump từ DB LIVE (nguồn sự thật; migrations có thể đã drift) |
| pg_cron / Realtime / Edge Functions / DB webhooks | **KHÔNG dùng** | bỏ qua — đơn giản hơn |
| RLS policies | có (nhiều bảng) | nằm trong schema dump → tự theo |

---

## 2. Chuẩn bị (không downtime — làm trước)

**Tools trên máy chạy migration:**
```bash
# psql + pg_dump/pg_restore — PHẢI khớp major version với Postgres của Supabase (15/17).
#   Kiểm tra version nguồn: Supabase Dashboard → Settings → Infrastructure → Postgres version.
psql --version           # cần >= version của Supabase project
supabase --version       # Supabase CLI (npm i -g supabase) — cho `db dump`
rclone version           # để copy Storage files qua S3 protocol (hoặc dùng script API bên dưới)
```

**Lấy connection strings (Dashboard → Settings → Database → Connection string):**
```bash
# NGUỒN (Mumbai) — "Direct connection" (KHÔNG dùng pooler cho pg_dump/restore data-heavy):
export SRC_DB="postgresql://postgres:[SRC_DB_PASSWORD]@db.nqhrtqspznepmveyurzm.supabase.co:5432/postgres"
# ĐÍCH (điền sau khi tạo project ở Phase 1):
export DST_DB="postgresql://postgres:[DST_DB_PASSWORD]@db.[NEW_REF].supabase.co:5432/postgres"
```

> Ghi lại DB password của cả 2 project (Settings → Database → Reset/copy password).
> Nếu direct connection bị chặn (IPv6-only), dùng **Session pooler** connection string (port 5432, `...pooler.supabase.com`).

---

## 3. Phase 1 — Tạo project mới ở Singapore

1. Supabase Dashboard → **New project** → cùng Organization.
2. **Region: Southeast Asia (Singapore) — `ap-southeast-1`.** ⚠️ Chọn đúng — không sửa được sau này.
3. Đặt DB password mạnh, lưu lại → điền vào `DST_DB`.
4. Đợi provision xong. Ghi lại **project ref mới**, URL mới, và **cả 3 key mới**
   (Settings → API): `URL`, `anon/publishable`, `service_role`.

---

## 4. Phase 2 — Migrate schema + data (`public`)

> Dump từ **DB LIVE** (không replay 127 migrations — DB thật là nguồn sự thật, migrations có thể drift).

**Cách khuyến nghị (Supabase CLI — tách roles / schema / data):**
```bash
# 1) Roles (nếu có custom role/grant ngoài mặc định)
supabase db dump --db-url "$SRC_DB" -f 01_roles.sql --role-only

# 2) Schema public (bảng, index, RLS, functions/RPC, triggers, sequences)
supabase db dump --db-url "$SRC_DB" -f 02_schema.sql

# 3) Data (COPY nhanh)
supabase db dump --db-url "$SRC_DB" -f 03_data.sql --data-only --use-copy
```

**Áp vào đích (theo thứ tự):**
```bash
psql "$DST_DB" -v ON_ERROR_STOP=1 -f 01_roles.sql     # bỏ qua nếu không có custom roles
psql "$DST_DB" -v ON_ERROR_STOP=1 -f 02_schema.sql
psql "$DST_DB" -v ON_ERROR_STOP=1 -f 03_data.sql
```

**Fallback thuần `pg_dump` (nếu CLI trục trặc):**
```bash
pg_dump "$SRC_DB" --schema=public --no-owner --no-privileges -Fc -f public.dump
pg_restore --no-owner --no-privileges -d "$DST_DB" public.dump
```

**Kiểm tra ngay:**
```bash
# So số bảng + vài bảng lõi giữa nguồn và đích
psql "$SRC_DB" -c "select count(*) from users;"   ; psql "$DST_DB" -c "select count(*) from users;"
psql "$SRC_DB" -c "select count(*) from sessions;"; psql "$DST_DB" -c "select count(*) from sessions;"
psql "$SRC_DB" -c "select count(*) from access_codes;"; psql "$DST_DB" -c "select count(*) from access_codes;"
# RPC tồn tại?
psql "$DST_DB" -c "\df fn_completed_session_counts"
```

> **Extensions:** dự án không có `CREATE EXTENSION` tường minh; chỉ dựa vào mặc định Supabase
> (`pgcrypto`/`gen_random_uuid`, `uuid-ossp`). Project mới đã có sẵn. Nếu `02_schema.sql` báo thiếu
> extension nào → bật ở Dashboard → Database → Extensions rồi chạy lại.

---

## 5. Phase 3 — Migrate auth users (Google OAuth)

Bảng người dùng thật nằm ở schema `auth` (không thuộc `public`). Dump **data-only** `auth.users`
+ `auth.identities` (identities giữ liên kết Google → user), rồi nạp vào đích.

```bash
# Dump data-only 2 bảng auth cốt lõi (password hash + Google identity đi theo, không cần reset)
pg_dump "$SRC_DB" --data-only --no-owner \
  -t auth.users -t auth.identities \
  -f auth_users.sql

# Nạp vào đích
psql "$DST_DB" -v ON_ERROR_STOP=1 -f auth_users.sql

# Verify
psql "$SRC_DB" -c "select count(*) from auth.users;"
psql "$DST_DB" -c "select count(*) from auth.users;"
```

**Lưu ý:**
- Nếu vướng khóa ngoại / cột mới giữa 2 version GoTrue, nạp `auth.users` trước rồi `auth.identities`.
- `public.users` (app profile) đã sang ở Phase 2; `id` của nó = `auth.users.id` → phải khớp (giữ nguyên UUID).
- Nếu Supabase báo trùng khoá trên vài user hệ thống → bỏ dòng đó, không xoá user thật.
- **Sessions cũ vô hiệu** (JWT secret khác) — bình thường, user đăng nhập lại bằng Google.

---

## 6. Phase 4 — Migrate Storage (buckets + files)

Metadata `storage.objects` nằm trong DB, nhưng **file nhị phân** ở object store — phải copy riêng.

**6.1 Tạo lại buckets ở project mới** (Dashboard → Storage → New bucket), đúng tên + cờ Public:

| Bucket | Public? | Nguồn dùng |
|---|---|---|
| `audio-responses` | **Public ✓** | ghi âm speaking (`get_public_url`) |
| `listening-audio` | (theo project cũ) | `LISTENING_AUDIO_BUCKET` |
| `vocab-audio` | (theo project cũ) | phát âm từ vựng |
| `writing-images` | **Public ✓** | ảnh đề Task 1 (optional) |
| *(verify reading bucket nếu có)* | — | `routers/reading_student.py` |

> Đối chiếu danh sách bucket + cột `public` + Storage **policies** ở project cũ
> (Dashboard → Storage → Policies) và tạo lại **giống hệt** ở project mới.

**6.2 Copy files.** Cách sạch nhất — `rclone` qua S3 protocol của Storage
(Dashboard → Storage → Settings → S3 connection: lấy endpoint + access key):
```bash
# Cấu hình 2 remote rclone kiểu s3 (src = Mumbai, dst = Singapore), rồi:
for b in audio-responses listening-audio vocab-audio writing-images; do
  rclone copy "src:$b" "dst:$b" --s3-no-check-bucket -P
done
```
*Nếu không bật S3 endpoint:* viết script duyệt `storage.objects` ở nguồn → `download` (Storage API)
→ `upload` sang đích, dùng `SERVICE_KEY` mỗi bên. (Copy cả path để URL public không đổi cấu trúc.)

**6.3 Verify:** mở thử 1 URL public `audio-responses` trên project mới; đếm object mỗi bucket.

---

## 7. Phase 5 — Cấu hình lại Auth ở project mới

Auth config **KHÔNG** đi theo DB dump — phải set tay ở project mới:

1. **Authentication → URL Configuration:**
   - **Site URL:** `https://averlearning.com`
   - **Redirect URLs (allowlist):** thêm `https://averlearning.com/**`, `https://www.averlearning.com/**`,
     `https://ielts-speaking-coach-sage.vercel.app/**`, và `http://localhost:*/**` (dev).
     *(Code dùng `redirectTo = window.location.origin` nên allowlist phải phủ mọi origin thật.)*
2. **Authentication → Providers → Google:** bật, dán **Client ID + Client Secret** (cùng OAuth app cũ được).
3. **Google Cloud Console → OAuth client → Authorized redirect URIs:** thêm callback của project MỚI:
   `https://[NEW_REF].supabase.co/auth/v1/callback`
   *(giữ callback cũ tới khi cutover xong rồi mới gỡ).*

---

## 8. Phase 6 — Cutover (maintenance window) 🔴

> Từ đây có downtime. Thông báo user trước. Chọn giờ thấp điểm.

**8.1 (khuyến nghị) Freeze ghi + đồng bộ delta.** Nếu có ghi mới giữa lúc dump (Phase 4) và cutover,
làm lại dump `--data-only` cho các bảng "nóng" (`sessions`, `grammar_recommendations`,
`user_vocabulary`, `flashcard_reviews`, `access_code_*`) sát giờ cutover, hoặc chấp nhận
đặt app ở chế độ read-only/bảo trì trong lúc migrate để tránh mất dữ liệu.

**8.2 Đổi env backend (Railway → Variables) — 3 biến:**
```
SUPABASE_URL         = https://[NEW_REF].supabase.co
SUPABASE_ANON_KEY    = [anon/publishable key mới]
SUPABASE_SERVICE_KEY = [service_role key mới]
```
→ Railway redeploy. (Nhớ `ENABLE_SERVER_TIMING=false` nếu đang bật.)

**8.3 Sweep frontend (99 file hardcode URL + 97 file hardcode anon key):**
```bash
cd frontend
OLD_URL='nqhrtqspznepmveyurzm.supabase.co'
NEW_URL='[NEW_REF].supabase.co'
OLD_ANON='sb_publishable_a_vDrA0c3mT-QlASPW7yhw_YZnUsfT4'
NEW_ANON='[anon key mới]'

# KHÔNG đụng practice.legacy.html (file legacy, "do not edit") và *.md
grep -rl "$OLD_URL" . --include=*.html --include=*.js | grep -v practice.legacy.html \
  | xargs sed -i '' "s#$OLD_URL#$NEW_URL#g"          # macOS sed: -i ''  (Linux: -i)
grep -rl "$OLD_ANON" . --include=*.html --include=*.js | grep -v practice.legacy.html \
  | xargs sed -i '' "s#$OLD_ANON#$NEW_ANON#g"

# Rebuild Tailwind (CI gate) sau khi sửa hàng loạt HTML — dùng script thật của repo:
npm run build:css        # = build:css:plusjakarta + build:css:inter (regenerate tailwind.build.css + tailwind.inter.css)
grep -rl "$OLD_URL" . --include=*.html --include=*.js | grep -v practice.legacy.html   # phải rỗng
```
→ commit + deploy Vercel. *(Anon/publishable key là public theo thiết kế — an toàn để hardcode.)*

**8.4 Thứ tự bật lại:** DB đích sẵn sàng → Railway (env mới) redeploy xong → Vercel (frontend mới) deploy xong → mở lại traffic.

---

## 9. Phase 7 — Verify sau cutover

```bash
# 1) Đo lại — db/query phải rớt từ ~56ms xuống ~2–5ms
cd backend
TOKEN=[access_token mới sau khi login lại] python3 scripts/measure_hot_endpoints.py --n 8
#   kỳ vọng: /auth/me db ~30-60ms (từ 487ms), dashboard/init db ~40-80ms (từ 731ms)

# 2) Health
curl -s https://[railway]/health/ready | jq .status        # "ok"
```
**Smoke test tay:**
- [ ] Đăng nhập Google (session cũ đã chết → login lại 1 lần).
- [ ] `/pages/speaking.html`: stats + charts + history load nhanh, không lỗi.
- [ ] Ghi âm 1 câu → chấm điểm (STT + Claude) → phát lại audio (bucket `audio-responses` public OK).
- [ ] Admin: access-code ownership hiển thị đúng.
- [ ] Grammar Wiki, Vocabulary, Listening audio phát được.

---

## 10. Rollback

Nếu hỏng ở cutover, đảo ngược **8.2 + 8.3** về project cũ (Mumbai vẫn nguyên vẹn, chưa xoá):
```
SUPABASE_URL/ANON/SERVICE  → giá trị cũ (nqhrtqspznepmveyurzm)
frontend sed ngược NEW→OLD → rebuild → deploy
```
Vì migration là **copy** (không phá nguồn), rollback = trỏ lại nguồn. **Giữ project Mumbai tối thiểu 1–2 tuần**
sau cutover rồi mới xoá — làm điểm rollback và đối chiếu delta.

⚠️ Ghi chú delta: dữ liệu user tạo ra trên project MỚI sau cutover sẽ **không** có ở project cũ →
rollback muộn = mất phần delta đó. Rollback chỉ an toàn ngay sau cutover.

---

## 11. Checklist tổng

- [ ] Project mới ở `ap-southeast-1` (Singapore) — xác nhận region.
- [ ] `public` schema + data migrate xong; count bảng lõi khớp.
- [ ] RPC functions tồn tại (`\df`).
- [ ] `auth.users` + `auth.identities` count khớp; `public.users.id` = `auth.users.id`.
- [ ] Buckets tạo lại đúng tên + cờ Public + policies; files copy xong; URL public mở được.
- [ ] Auth: Site URL + Redirect allowlist + Google provider + Google Cloud callback (ref mới).
- [ ] Railway: 3 env mới + `ENABLE_SERVER_TIMING=false` + redeploy.
- [ ] Frontend: sed sweep (URL + anon), `grep` xác nhận sạch, rebuild Tailwind, deploy.
- [ ] `measure_hot_endpoints.py`: db/query ~2–5ms.
- [ ] Smoke test tay pass.
- [ ] Project Mumbai giữ lại 1–2 tuần làm rollback.

---

## 12. Gotchas riêng dự án này

- **99 file frontend hardcode URL** — đừng quên file nào; `grep -rc` phải rỗng sau sweep. Đừng sửa
  `practice.legacy.html` (legacy) và `*.md`.
- **Tailwind CI gate:** sau sweep HTML phải rebuild `css/tailwind.build.css`, nếu không CI đỏ
  (xem memory "Tailwind STALE after merge").
- **`audio-responses` phải Public** — nếu quên set public, replay audio hỏng (CLAUDE.md "Known limitations").
- **`association_lookup_failed` / access-code ownership:** sau migrate, verify admin access-code hiển thị
  đúng canonical (không phải `—`) — dữ liệu `user_code_assignments` + `access_codes.used_by` phải sang đủ.
- **Timezone bug:** không liên quan region DB, nhưng nhớ backend đã dùng `datetime.now(timezone.utc)` —
  migrate không đụng, chỉ nhắc để không hoảng khi thấy giờ UTC.
- **JWT secret mới** → toàn bộ user re-login. Vì chỉ có Google OAuth (1 click) nên UX chấp nhận được;
  báo trước cho user "cần đăng nhập lại".
- **PR #654 (B+C) vẫn có ích sau migrate:** reuse httpx client + parallel dashboard cộng dồn với co-location.

---

*Runbook tạo 2026-07-04. Lệnh Supabase CLI/`pg_dump` có thể đổi theo version — đối chiếu docs Supabase
"Migrating to a new project" hiện hành trước khi chạy. `[NEW_REF]`, `[*_DB_PASSWORD]`, `[*key]` = điền tay.*
