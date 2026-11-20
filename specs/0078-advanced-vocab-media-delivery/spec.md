---
id: MEDIAOUT-0078
title: Advanced Vocabulary media leaves the Git working tree while every existing media URL keeps playing, seeking and loading
status: draft
risk: high
owner: product
---

# Advanced Vocabulary media leaves the Git working tree while every existing media URL keeps playing, seeking and loading

Status: **draft**, soạn ngày 20/11/2026 cho nhiệm vụ `G10-T16` và `G10-T17` (thương mại hoá 2026-11). Nguồn: `docs/proposals/commercialization-2026-11/GOI-10-repo-pha-2-cau-truc.md` mục 4(e), G10-T16…T19 và `docs/REPOSITORY_MAINTENANCE.md` mục "Media follow-up". Mọi số liệu đo lại trên `staging @ 5987bc018` (20/11). Bước 2 của T16 (đọc DB staging) **chưa làm**: hàng chờ Q10 loại bước này vì cần Q-e2. Chưa có dòng mã nào chạy theo spec này.

Chỉ anh Andy duyệt spec. Khi duyệt, câu trả lời ghi vào `approval-decision.md` cùng thư mục, nguyên văn kèm thời điểm, rồi `status` đổi sang `approved`. Số spec lấy từ sổ cấp số `01-KE-HOACH-TONG.md` mục 6. Spec không có migration và không đổi biến môi trường hiện có. Nó thêm một biến mới, mặc định rỗng.

## Tóm tắt (tiếng Việt)

Người dùng cuối **không thấy gì thay đổi**; nếu thấy là lỗi. Hiện 3.100 file (373,6 MiB) dưới `frontend/public/assets/advanced-vocab/` nằm trong mỗi worktree và mỗi lần deploy Vercel. Spec cho phép đưa chúng ra khỏi cây làm việc mà mọi URL `/assets/advanced-vocab/**` cũ vẫn phát, tua (`Range` → 206) và hiện ảnh như trước.

Kiểm kê ở `5987bc018` cho thấy năm điều gói việc chưa ghi. Spec xử lý cả năm:

1. **Cây "legacy" là bản sao đúng byte của bản phiên bản hiện hành.** Có 1.524 file ở dạng `/<lesson>/…`, và cả 1.524 file trùng SHA-256 với file cùng đường dẫn ở `versions/<lesson>/<checksum của core30-manifest>/…`. Không file nào thiếu, không file nào lệch. Vì vậy có thêm phương án **(D)**: gỡ cây legacy rồi rewrite nội bộ cùng origin sang thư mục phiên bản. Phương án này bớt 184,6 MiB mà không cần nơi lưu ngoài và không có rủi ro `Range` qua proxy.
2. **Runtime học viên không lưu URL media.** Bài giao và `quiz_banks.meta.runtime` chỉ lưu `lesson_id` và `content_checksum` (`import_advanced_vocab_core30.py:83-88`, `advanced_vocab_service.py:137-150`). URL được dựng lại ở mỗi request bằng `_asset_url` / `_listening_figure_url` và luôn ở dạng `versions/…`. Thiếu checksum thì bài giao trả 409. Repo không có dòng mã nào ghi URL media vào DB. Phải kiểm trên DB trước khi bỏ file khỏi cây (FR-002, Q-e2).
3. **Validator package không đọc `frontend/public`.** Đây là bước 3 của T16. `advanced_vocab_package_validator.py:1895-1946` giải đường dẫn media trong **thư mục package nguồn** (`path.parent`, `path.parents[2]`), không trong `frontend/public/assets`. Thứ cần file trên đĩa ở `frontend/public/assets/advanced-vocab` là ba chỗ khác:
   - `sync_advanced_vocab_core30.py`: `_PUBLIC`, ghi và đọc bản phiên bản trước.
   - `backend/tests/test_advanced_vocab_service.py::test_core30_assets_exist_for_every_card_and_core_media`.
   - `frontend/tests/advanced-vocabulary-next-behavior.test.mjs`, dòng 30–35 và 142.
4. **`generate_advanced_vocab_audio.py` không ghi vào `frontend/public`.** Script này ghi ra một thư mục bundle mới do người chạy chỉ định. Chỉ `sync_advanced_vocab_core30.py` ghi vào cây public, nên FR-004 chỉ áp cho script sync.
5. **Rewrite phải ở `beforeFiles`.** Khi file còn trong `public/` (giai đoạn T18, bật cờ nhưng chưa xoá file), rewrite `afterFiles` không bao giờ chạy, vì file tĩnh thắng. Muốn cờ có tác dụng trước khi xoá file thì rewrite hoặc redirect phải nằm ở `beforeFiles`.

## Problem

`frontend/public/assets/advanced-vocab/` chiếm 373,6 MiB, gồm 3.100 file: 2.975 mp3 (365,7 MiB), 61 png (7,4 MiB) và 64 svg (0,5 MiB). Có 1.482 nội dung khác nhau (184,2 MiB) và 189,3 MiB là bản trùng.

Git đã gộp blob trùng nên kích thước clone không tăng. Cái giá nằm ở chỗ khác: mỗi worktree checkout đủ 373,6 MiB, và mỗi lần deploy Vercel tải lên đủ 3.100 file. Các luồng song song của đợt thương mại hoá mở nhiều worktree cùng lúc.

Media phải giữ URL bất biến (`docs/ADVANCED_VOCAB_CORE30_DEPLOY.md`). Bài giao mở lại phụ thuộc thư mục `versions/<lesson>/<checksum>/`. Bookmark, cache CDN và client cũ có thể còn giữ dạng `/<lesson>/…`. `00-QUY-UOC-CHUNG.md` §4.11 cấm đổi `frontend/public/assets/advanced-vocab/**` khi chưa có quyết định riêng; quyết định đó là Q-e1.

## Scope

- Mục (e) của GOI-10: các FR dưới đây và nhiệm vụ G10-T18, G10-T19.
- Phục vụ `/assets/advanced-vocab/**` từ nơi lưu theo phương án anh Andy chọn ở Q-e1. Cờ `AVER_ADVANCED_VOCAB_MEDIA_ORIGIN` (với D: `AVER_ADVANCED_VOCAB_LEGACY_REWRITE`) điều khiển việc này, mặc định tắt.
- Script tải lên một lần, idempotent, `--dry-run` mặc định, so SHA-256. Chỉ cần với A và B.
- `sync_advanced_vocab_core30.py` ghi media mới tới nơi lưu mới.
- Đổi ba test đang đòi file trên đĩa sang kiểm qua bảng kê hoặc qua bảng rewrite. Chỉ làm ở T19.
- Gỡ file khỏi cây (T19): chỉ sau 14 ngày cờ bật trên production không lỗi, và chỉ khi anh Andy duyệt Q-e1 bằng chữ.

## Non-goals

- Viết lại lịch sử Git, chuyển sang LFS, đổi URL media, xoá hoặc đổi tên thư mục `versions/` (gói mục 8 điểm 4).
- Thu nhỏ `.git`. Xoá file khỏi cây không làm `.git` nhỏ đi khi không viết lại lịch sử.
- Đổi nội dung, checksum, giọng đọc hay manifest của 30 bài Advanced Vocabulary.
- Đổi `Cache-Control` của `/assets/:path*`. Hiện là `public, max-age=86400`, giữ nguyên. Thêm `immutable` cho `versions/` là việc riêng.
- Media ngoài `advanced-vocab`, ví dụ audio Listening đã ở Supabase Storage.
- Đọc bảng học viên production. Chỉ được chạy truy vấn đếm do anh Andy tự chạy (Q-e2).

## Users and journeys

- Học viên mở lại một bài giao Advanced Vocabulary đã nhận (bất kỳ phiên bản nào) và nghe, tua audio từ vựng hoặc bài nghe đầy đủ.
- Học viên mở một bài giao mới, nhận phiên bản hiện hành.
- Người bảo trì nội dung chạy `sync_advanced_vocab_core30.py` để phát hành phiên bản mới.
- Người phát triển mở worktree mới mà không phải checkout 373,6 MiB media.

## Requirements

- **FR-001:** Có bảng kê đường dẫn, SHA-256, kích thước và blob Git cho mọi file dưới `frontend/public/assets/advanced-vocab/`, kèm nhóm trùng. Bảng kê sinh lại được bằng lệnh trong `plan.md`. Bước 1 của "Media follow-up" đã làm trong PR này.
- **FR-002:** Có bảng kê mọi nơi lưu hoặc dẫn tới URL media trước khi gỡ file (bước 2):
  - Repo: làm trong PR này, xem `plan.md`.
  - Staging: chỉ `SELECT`, khi Q-e2 cho phép.
  - Production: chỉ `count`, do anh Andy chạy.
- **FR-003:** Sau khi file rời khỏi cây, mọi URL `/assets/advanced-vocab/**` từng phục vụ ở `5987bc018` vẫn trả 200/206, theo hai hợp đồng khác nhau:
  - **URL có checksum** `versions/<lesson>/<checksum>/…`: byte **bất biến**, đúng SHA-256 trong bảng kê ở `5987bc018`, mãi mãi.
  - **URL legacy** `/<lesson>/…`: byte của **phiên bản hiện hành** theo `core30-manifest.json` lúc phục vụ, tức là đúng file cùng đường dẫn tương đối ở `versions/<lesson>/<content_checksum hiện hành>/`. Ở `5987bc018`, hai cách hiểu này trùng nhau (plan.md, lệch 0). Sau khi phát hành checksum mới, URL legacy đổi theo, như hiện nay sync vẫn làm.
  - Request `Range` nhận 206 đúng đoạn (trực tiếp, hoặc sau một redirect 308 với phương án B).
- **FR-004:** `sync_advanced_vocab_core30.py` ghi media của phiên bản mới tới nơi lưu mới và cập nhật bảng định tuyến. Phạm vi cấm ghi khác nhau theo phương án:
  - **D:** vẫn ghi `frontend/public/assets/advanced-vocab/versions/<lesson>/<checksum>/` như hiện nay. Bảng rewrite legacy trỏ checksum mới. Cây legacy `/<lesson>/` **vẫn được ghi đồng bộ** cho tới khi T005 gỡ nó; từ T005, sync không tạo lại file legacy nào.
  - **A/B:** không ghi vào `frontend/public/assets/advanced-vocab` khi cờ bật.
- **FR-005:** Có đường quay lại đã thử trên staging **sau khi đã phát hành ít nhất một checksum mới lúc cờ bật**:
  - Trước T005: tắt cờ thì phục vụ lại từ `public/`. Cây legacy trên đĩa đúng phiên bản hiện hành, vì sync vẫn ghi đồng bộ (FR-004 D).
  - Sau T005: `git revert` PR gỡ file rồi chạy `sync_advanced_vocab_core30.py --restore-legacy` để dựng lại cây legacy từ `versions/<lesson>/<checksum hiện hành theo manifest>/`. Lệnh chép đúng byte và kiểm SHA-256, không phụ thuộc bản cũ trong lịch sử Git. Chỉ sau đó mới tắt cờ.
- **FR-006:** Cờ rỗng hoặc tắt nghĩa là hành vi giống hệt `5987bc018`: không rewrite, không redirect, file phục vụ từ `public/`.
- **FR-007:** Một object đã phục vụ ở đường dẫn `versions/<lesson>/<checksum>/…` không bao giờ bị ghi đè bằng byte khác. Script tải lên và sync từ chối khi SHA-256 đích khác nguồn.
- **FR-008:** CSP không phải nới: `media-src 'self' blob: https:` và `img-src 'self' data: blob: https:` đã cho nguồn https. Với D, mọi thứ cùng origin.
- **FR-009:** Ba chỗ đòi file trên đĩa (mục Tóm tắt, điểm 3) vẫn kiểm cùng điều kiện trước và sau T19: mỗi thẻ có hai audio, mỗi bài có `full_test.mp3`, mỗi hình WT1 và hình Listening tồn tại với đúng checksum. Chúng chuyển sang kiểm qua bảng kê hoặc bảng rewrite, không bị bỏ hay nới.

## Acceptance scenarios

### Scenario 1: bài giao cũ, phiên bản cũ (gói E2E-5)

- **Given** một bài giao trỏ `ADV-T11` với checksum cũ `a03819b4…3026`, và cờ bật trên staging,
- **When** học viên mở bài và bấm phát `versions/ADV-T11/a03819b4…/listening/full_test.mp3`,
- **Then** audio phát, tua được (request `Range: bytes=…` → 206), và hình `VOC-ADV-LIS-LSN-T11_map.svg` của phiên bản đó hiện. Đây là file duy nhất không trùng nội dung với file nào khác.

### Scenario 2: URL legacy `/ADV-T07/…`

- **Given** cờ bật (D: đã gỡ cây legacy trên preview),
- **When** `curl -sI -H 'Range: bytes=0-99' <origin>/assets/advanced-vocab/ADV-T07/listening/full_test.mp3`,
- **Then** nhận 206 với 100 byte đầu, đúng với SHA-256 của `versions/ADV-T07/<checksum hiện hành>/listening/full_test.mp3`.

### Scenario 3: cờ tắt

- **Given** `AVER_ADVANCED_VOCAB_MEDIA_ORIGIN` rỗng,
- **When** build và mở cùng các URL ở Scenario 1–2,
- **Then** `next.config.ts` không sinh thêm rewrite hay redirect nào (so `routes-manifest.json` với `5987bc018`), và file phục vụ từ `public/`.

### Scenario 4: phát hành phiên bản mới

- **Given** cờ bật, khi `sync_advanced_vocab_core30.py --write` phát hành checksum mới cho một bài,
- **Then** media của checksum mới có ở nơi lưu mới (D: `versions/<lesson>/<checksum mới>/`) trước khi manifest đổi. Media của checksum cũ vẫn còn, không bị ghi đè. Bảng rewrite legacy (D) trỏ checksum mới. Trước T005, cây legacy trên đĩa cũng đã mang byte của checksum mới; sau T005, không file legacy nào được tạo.

### Scenario 5: tải lên bị lệch

- **Given** object đích đã tồn tại với SHA-256 khác nguồn,
- **When** chạy script tải lên (không `--dry-run`),
- **Then** script dừng với mã lỗi khác 0, in đường dẫn lệch và không ghi đè (FR-007).

### Scenario 6: rollback sau khi đã phát hành bản mới

- **Given** cờ bật trên staging, và Scenario 4 vừa phát hành một checksum mới cho một bài (bài thử, nội dung đổi một file audio),
- **When** tắt cờ và redeploy,
- **Then** URL legacy của bài đó trả byte của checksum **mới** (không quay về bản cũ, không 404 với file chỉ có ở bản mới), và audio, ảnh, `Range` → 206 đều qua cho cả URL legacy lẫn hai URL có checksum (cũ và mới).

### Scenario 7: khôi phục sau khi đã gỡ cây legacy

- **Given** T005 đã gỡ cây legacy (thử trên một nhánh preview), và đã có một checksum mới phát hành sau T005,
- **When** revert PR T005, chạy `--restore-legacy`, rồi tắt cờ,
- **Then** cây legacy trên đĩa trùng đúng byte với `versions/<lesson>/<checksum hiện hành>/` cho cả 30 bài, và các kiểm ở Scenario 6 đều qua.

## Edge cases

- Staging và production là hai project Supabase. Bucket ở đâu và có tách theo môi trường không là Q-e1b.
- Cache CDN Vercel có thể giữ phản hồi cũ 86.400 giây. Rollback có thể cần purge cache cho `/assets/advanced-vocab/*`.
- Redirect 308 (phương án B) làm URL cuối khác origin. Trình phát `<audio>` theo redirect được. Một request `fetch` có `credentials` sẽ cần CORS ở bucket. Hiện frontend chỉ phát qua `new Audio(url)` (`components/vocabulary-audio-button.tsx:47`) và `<audio src>` (`advanced-vocabulary-lesson.tsx:292`), không `fetch`, nên không cần CORS. T18 kiểm lại điều này.
- `ADV-T11` có hai checksum. Phiên bản cũ có 52 file, trong đó 51 trùng với phiên bản mới.
- File lớn nhất là 6.630.129 byte (`ADV-T17/listening/full_test.mp3`), dưới giới hạn upload mặc định của Supabase Storage.
- Với D, URL legacy luôn trỏ phiên bản **hiện hành** (FR-003). Hiện cũng vậy, vì sync chép phiên bản mới đè lên cây legacy. Hành vi không đổi. Bất biến byte chỉ áp cho URL có checksum.

## Success criteria

- Một worktree mới checkout ít hơn 184,6 MiB (D) hoặc ít hơn khoảng 373 MiB (A/B). Đo bằng `du -sh frontend/public/assets/advanced-vocab` trước và sau T19.
- Không có lỗi 404 hay 416 mới trên `/assets/advanced-vocab/*` trong log Vercel 14 ngày sau khi bật cờ trên production.
- Scenario 1–6 có bằng chứng ghi trong `verification.md` với SHA.

## Related specifications

- `docs/ADVANCED_VOCAB_CORE30_DEPLOY.md`: hợp đồng media bất biến theo checksum.
- `docs/REPOSITORY_MAINTENANCE.md` mục "Media follow-up": kế hoạch 4 bước. Spec này là bước 3, đề xuất nơi lưu.
- TESTPOLICY-0057: test mới kiểm hành vi, không kiểm text nguồn (FR-009).

## Open questions

- **Q-e1 (anh Andy):** đưa media ra khỏi git không, và theo phương án nào? Bảng so sánh ở `plan.md`.
  - **Đề xuất: (D) trước, rồi (A) nếu vẫn cần.**
  - Lý do: D bớt 49% dung lượng mà không cần hạ tầng mới, không qua proxy ngoài (rủi ro `Range` bằng 0), và rollback chỉ là tắt cờ.
  - A bớt thêm 189 MiB nhưng phải thử `Range` qua rewrite ngoài của Vercel trên preview (**CHƯA KIỂM**).
  - Mặc định tạm: chỉ làm T16 và T17 (PR này).
- **Q-e1b (anh Andy, chỉ khi chọn A hoặc B):** một bucket ở project production cho cả hai môi trường, hay mỗi môi trường một bucket?
  - Đề xuất: mỗi môi trường một bucket công khai chỉ đọc. Lý do: staging thử tải lên mà không chạm production, đúng quy tắc staging trước.
- **Q-e2 (anh Andy):** cho đọc `SELECT` trên staging các bảng lưu `content_config` / `meta.runtime` / bài nộp Advanced Vocabulary, để xác nhận không bảng nào giữ URL media nguyên văn.
  - Đề xuất: có, chỉ staging. Với production, anh chạy truy vấn đếm có sẵn trong `plan.md`.
  - Mặc định: chưa đọc. Bằng chứng ở mục Tóm tắt điểm 2 hiện chỉ đến từ mã.
