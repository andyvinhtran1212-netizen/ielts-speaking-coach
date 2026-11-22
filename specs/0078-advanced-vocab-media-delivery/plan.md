# Implementation plan

## Architecture impact

### Kiểm kê (G10-T16 bước 1, đo ở `5987bc018`)

Lệnh sinh lại bảng kê. Chạy từ gốc repo. CSV để ở thư mục tạm, không commit:

```bash
git ls-files -s frontend/public/assets/advanced-vocab \
  | while read -r mode blob stage path; do
      printf '%s,%s,%s,%s\n' "$path" "$(shasum -a 256 "$path" | cut -d' ' -f1)" \
        "$(wc -c < "$path" | tr -d ' ')" "$blob"
    done > "${TMPDIR:-/tmp}/advanced-vocab-media.csv"
```

| Đo | Giá trị |
| --- | ---: |
| File được Git theo dõi | 3.100 |
| mp3 / png / svg | 2.975 (365,7 MiB) / 61 (7,4 MiB) / 64 (0,5 MiB) |
| Tổng byte | 391.706.682 (373,6 MiB) |
| Nội dung khác nhau (SHA-256 = blob Git) | 1.482 (184,2 MiB) |
| Byte trùng | 189,3 MiB |
| Nhóm trùng | 1.481 nhóm: 1.401 nhóm 2 file, 47 nhóm 3, 26 nhóm 4, 4 nhóm 5, 1 nhóm 6, 1 nhóm 10, 1 nhóm 16 |
| File không trùng | 1 (`versions/ADV-T11/a03819b4…/listening/VOC-ADV-LIS-LSN-T11_map.svg`) |
| Cây legacy `/<lesson>/…` | 30 bài · 1.524 file · 184,6 MiB |
| Cây `versions/<lesson>/<checksum>/…` | 30 bài · 31 thư mục checksum (ADV-T11 có 2) · 1.576 file · 189,0 MiB |
| Thư mục con | `vocab/` 2.914 · `writing/` 122 · `listening/` 64 |
| File lớn nhất | `ADV-T17/listening/full_test.mp3`, 6.630.129 byte |
| `du -sh` trên worktree | 381M |

Đã kiểm: cả 1.524 file legacy trùng đúng byte với file cùng đường dẫn tương đối ở `versions/<lesson>/<content_checksum trong core30-manifest.json>/`. Lệch 0, thiếu 0. Ngược lại, 1.524 file thuộc phiên bản hiện hành đều có bản legacy. 52 file còn lại thuộc phiên bản cũ của ADV-T11.

### Rà tham chiếu trong repo (G10-T16 bước 2, phần không đọc DB)

`git grep -n "assets/advanced-vocab\|_asset_url"` (trừ `frontend/public/assets`, `docs/history`, `specs`, `docs/proposals`):

| Chỗ | Vai trò | Ảnh hưởng khi file rời cây |
| --- | --- | --- |
| `backend/services/advanced_vocab_service.py:28,241-268` | `_PUBLIC_ROOT`, `_asset_url`, `_listening_figure_url`: dựng URL ở mỗi request, luôn có checksum cho bài giao | Không đổi: URL giữ nguyên (FR-003) |
| `backend/services/advanced_vocab_service.py:137-150` | `_assigned_lesson` đọc `content_config.runtime.{lesson_id, content_checksum}`; thiếu thì trả 409 | Không đổi; DB chỉ giữ checksum |
| `backend/scripts/import_advanced_vocab_core30.py:83-88` | ghi `quiz_banks.meta.runtime` (lesson_id, checksum), không ghi URL | Không đổi |
| `backend/scripts/sync_advanced_vocab_core30.py:22` (`_PUBLIC`) và các dòng 108–669 | ghi cây legacy và cây phiên bản, đọc bản phiên bản trước, `_PUBLIC.rglob` để biết đã từng deploy | Phải đổi (FR-004, T003) |
| `backend/tests/test_advanced_vocab_service.py:1083-1105` | đòi mọi URL dựng ra tồn tại trong `frontend/public` | Đổi ở T19 (FR-009) |
| `backend/tests/test_advanced_vocab_package_validator.py:1918` | `monkeypatch` `_PUBLIC` sang `tmp_path` | Giữ; chỉnh theo T003 |
| `frontend/tests/advanced-vocabulary-next-behavior.test.mjs:30-35,142` | `existsSync` trên cây legacy | Đổi ở T19 (FR-009) |
| `frontend/next.config.ts:196` | `Cache-Control` cho `/assets/:path*` | Giữ |
| `frontend/tooling/content-security-policy.mjs:110-111` | `img-src`, `media-src` đã có `https:` | Giữ (FR-008) |
| `README.md:56`, `docs/ADVANCED_VOCAB_CORE30_DEPLOY.md:28,36` | tài liệu nơi lưu | Cập nhật ở T18/T19 |

Không thấy frontend app code nào dựng URL `/assets/advanced-vocab` riêng. Frontend chỉ phát URL backend trả về.

**Bước 3 (validator):** `advanced_vocab_package_validator.py` (dòng 1895–1946, cùng 874–895 và 1182) giải đường dẫn trong **package nguồn** (`path.parent`, `path.parents[2]`), không trong `frontend/public/assets`. Validator không cần đổi.

### Các phương án (Q-e1)

| | (A) Storage + rewrite ngoài | (B) Storage + redirect 308 | (C) giữ trong repo, dedupe lúc build | (D) gỡ cây legacy + rewrite nội bộ |
| --- | --- | --- | --- | --- |
| Bớt trong worktree | khoảng 373 MiB | khoảng 373 MiB | 0 (chỉ bớt lúc deploy) | 184,6 MiB |
| Bớt khi deploy Vercel | 3.100 file | 3.100 file | khoảng 189 MiB | 1.524 file |
| Hạ tầng mới | bucket công khai + script tải lên | như A | bước build | không |
| URL giữ nguyên | có | URL cuối khác origin | có | có |
| `Range` → 206 | **CHƯA KIỂM** qua rewrite ngoài | bucket trả 206 (Supabase) | có (tĩnh) | có (tĩnh cùng origin), vẫn thử trên preview |
| Rollback | tắt cờ (trước T19) | tắt cờ | bỏ bước build | tắt cờ (trước T19), `git revert` (sau) |
| Rủi ro | proxy, CDN, chi phí egress | redirect với client cũ | Vercel không giữ symlink trong `public/` (CHƯA KIỂM) | bảng rewrite phải theo checksum hiện hành |

**Đề xuất:** làm **D** trước (T18-D, T19-D). Nếu sau đó vẫn cần bớt 189 MiB của cây `versions/`, làm **A** cho riêng `versions/`, với điều kiện preview chứng minh `Range` → 206; nếu không chứng minh được thì làm **B**.

### Thiết kế D

- `frontend/tooling/advanced-vocab-legacy-rewrites.mjs` sinh 30 rule `beforeFiles` từ `backend/content/advanced_vocab/core30-manifest.json`. Mỗi rule có dạng `{ source: '/assets/advanced-vocab/ADV-T07/:path*', destination: '/assets/advanced-vocab/versions/ADV-T07/<checksum>/:path*' }`.
- Bảng được sinh lúc build vào một module tĩnh, để `rewrites()` không đọc filesystem (ràng buộc ở `next.config.ts:66`). Test so module với manifest.
- Cờ `AVER_ADVANCED_VOCAB_LEGACY_REWRITE=1` bật rule. Rỗng thì không rule nào (FR-006).
- Rule nằm ở `beforeFiles`, nên có tác dụng cả khi file legacy còn trên đĩa. Nhờ vậy staging thử được trước T19.
- `route-ownership-check.mjs` và `verify-csp-nonce-404-flow.mjs` đọc rewrites. T18 chạy cả hai.
- Trước T19 (T005), `sync_advanced_vocab_core30.py` vẫn ghi cả `versions/` và cây legacy, nên tắt cờ bất cứ lúc nào cũng trả đúng bản hiện hành (FR-005).
- Từ T19, sync chỉ ghi `versions/` và manifest; bảng rewrite tự theo manifest. `--restore-legacy` dựng lại cây legacy từ `versions/<lesson>/<checksum hiện hành>/` (chép đúng byte, kiểm SHA-256) khi cần rollback sau T19.

### Thiết kế A/B (chỉ khi Q-e1 chọn)

- Cờ `AVER_ADVANCED_VOCAB_MEDIA_ORIGIN=https://<project>.supabase.co/storage/v1/object/public/<bucket>`. Rỗng thì tắt.
- A: rewrite `beforeFiles` `/assets/advanced-vocab/:path*` → `${origin}/:path*`. B: redirect 308 cùng đích.
- `backend/scripts/upload_advanced_vocab_media.py`:
  - `--dry-run` mặc định, `--env staging|production`.
  - Đọc bảng kê, `HEAD` từng object. Thiếu thì tải lên. Có mà khác SHA-256 thì dừng (FR-007).
  - In tóm tắt, không in khoá.
  - Production chỉ chạy khi anh Andy gõ duyệt.

## Data and contracts

- Không migration, không đổi bảng, không đổi response API. `audio_url`, `audio_headword`, `audio_example` và `figure` giữ đúng chuỗi như ở `5987bc018`.
- Biến môi trường mới (Vercel, frontend): `AVER_ADVANCED_VOCAB_LEGACY_REWRITE` (D) hoặc `AVER_ADVANCED_VOCAB_MEDIA_ORIGIN` (A/B). Mặc định rỗng. Đặt biến trên Vercel là thay đổi env, cần anh Andy gõ duyệt.
- Truy vấn soạn sẵn cho Q-e2, chỉ đọc. Chạy staging trước; production chỉ chạy `count`, do anh Andy chạy:

```sql
-- Bài giao hoặc bank nào giữ URL media nguyên văn thay vì checksum?
select count(*) from quiz_banks
 where meta::text like '%/assets/advanced-vocab/%';
select count(*) from class_assignments
 where content_config::text like '%/assets/advanced-vocab/%';
select count(*) from course_section_submissions
 where content_snapshot::text like '%/assets/advanced-vocab/%';
```

Tên bảng và cột lấy từ `migrations/177_class_assignments.sql:105` (`class_assignments.content_config`) và `226_course_multisection_results.sql:12` (`course_section_submissions.content_snapshot`). Người chạy xác nhận lại bằng `information_schema.columns` trước khi chạy, vì bảng lưu bài nộp Advanced Vocabulary khác (`advanced_vocab_*`) có thể cũng giữ snapshot (**CHƯA KIỂM**). Kỳ vọng cả ba trả 0. Nếu khác 0, phải liệt kê dạng URL và bổ sung FR-003 trước T19.

## Rollout and rollback

Xem `rollout.md`. Tóm tắt:
- Cờ tắt mặc định.
- Staging bật trước, rồi production sau khi anh duyệt.
- T19 chỉ làm sau 14 ngày production không lỗi.
- Rollback: tắt cờ (trước T19) hoặc `git revert` PR T19.

## Verification strategy

- FR-001: bảng kê sinh lại bằng lệnh trên và so với tóm tắt ở đây (`3100`, `1482`, `391706682`).
- FR-003: hai hợp đồng kiểm riêng. URL có checksum so với SHA-256 trong bảng kê `5987bc018`. URL legacy so với file cùng đường dẫn ở `versions/<lesson>/<checksum hiện hành theo manifest lúc kiểm>/`. `curl -sI -H 'Range: bytes=0-99'` trên preview và staging cho mẫu URL sau, kèm so SHA-256 toàn file:
  - 30 URL legacy `full_test.mp3`;
  - 31 URL `versions/…/full_test.mp3`;
  - 30 URL `vocab/` ngẫu nhiên;
  - 2 hình ADV-T11 hai phiên bản.
- FR-005: thứ tự bắt buộc trên staging: bật cờ → phát hành một checksum mới cho bài thử (Scenario 4) → tắt cờ → kiểm audio, ảnh, `Range` cho URL legacy và hai URL có checksum (Scenario 6). Scenario 7 chạy trên nhánh preview trước T005.
- FR-006: so `routes-manifest.json` khi cờ tắt với `5987bc018`.
- FR-007: test đơn vị của script tải lên (A/B), hoặc test bảng rewrite so manifest (D).
- FR-009: hai test hiện có chuyển sang đọc bảng kê hoặc bảng rewrite; chạy cả trước và sau gỡ file.
- E2E-5 (gói): một bài cũ và một bài mới trên staging bằng tài khoản thử, phát và tua audio.
