# Implementation plan

Nguồn: gói mục 4.6, 5.6, 5.7, 5.9 (phần T27). Đã đối chiếu với staging `31725a9b`. Chỗ ghi `CHƯA KIỂM` là việc người thực thi kiểm ở bước 1 của nhiệm vụ tương ứng, rồi ghi kết quả vào PR.

## Architecture impact

- **Frontend, component dùng chung** (thư mục `frontend/components/ui/result/`):
  - `result-next-steps.tsx`: ba lối ra (FR-050).
  - `result-grading-source.tsx`: dòng nguồn chấm (FR-051).
  - `result-pending-review.tsx`: 4 bước chờ duyệt (FR-052).
  - `regrade-request.tsx`: form và trạng thái chấm lại (FR-053).
  - `credits-empty-notice.tsx`: khối hết lượt (FR-055).
  - `retry-credit-line.tsx`: dòng lượt khi làm lại (FR-058).

  Props của từng component ghi trong PR để G08 dùng lại.
- **Frontend, model thuần:**
  - `frontend/lib/band-display-model.mjs`: quy tắc 5.6, gồm Overall theo FR-054.
  - `frontend/lib/fix-link-model.mjs` và `fix-link-map.json`: FR-056.
  - `frontend/lib/result-next-step-model.mjs`: chọn đích "Bài tiếp".
- **Áp lên ba phiếu,** cây mới đặt sau cờ `learner_v2` (LEARNERCORE-0063 FR-072):
  - phiếu Writing: `writing-result-behavior.tsx`;
  - phiếu Speaking: trang kết quả phiên Speaking;
  - phiếu thi thử: `mock-result-behavior.tsx`. Đường dẫn theo LEARNERNAV-0062 (đợt 5, 6).

  Cây cũ giữ nguyên khi cờ tắt. Các test đang nhắc `(authed-writing-result)`, `(authed-session-result)`, `(authed-mock-result)` vẫn chạy cho cây cũ.
- **Backend:**
  - Migration chấm lại (mục 5.2).
  - `writing_student.py`: `RegradeRequestBody` nhận hai dạng body; `GET` trả thêm hai cột.
  - `admin_writing_regrade.py`: list và detail trả thêm `reason_code`, `note`. Dòng `to_jsonb(r)` của RPC đã mang sẵn hai cột này; chỉ cần sửa model và màn.
  - Màn admin chấm lại hiện thêm hai cột.

## Data and contracts

### 5.1 Quy tắc hiện band (`band-display-model.mjs`)

| Kỹ năng | Hiện band khi | Thiếu thì |
|---|---|---|
| Writing | bài `delivered` có `overall_band_score` | "Chưa có bài đã chấm" |
| Speaking | buổi đã chấm có band | "Chưa có buổi đã chấm" |
| Listening/Reading | đề đủ 40 câu đã nộp | "Chưa đủ bài. Cần ít nhất một đề đủ 40 câu để có band <kỹ năng>." Bài ngắn chỉ hiện "Đúng a trên b câu" với b > 0 |
| Overall | mock test được giao, `assigned_skills` đủ 4 kỹ năng (hoặc null nghĩa là đủ 4) và `overall_readiness.banded_skill_count >= overall_min_skills` | còn phần chưa có band → "Chưa có Overall: còn chờ chấm <các kỹ năng>"; kỳ không đủ 4 kỹ năng, full test một kỹ năng, mini test → không có dòng |

- **Nhận diện mock test được giao:** `mock_exams.cohort_id IS NOT NULL`, hoặc lượt thi nằm trong danh sách dự thi của G09-T31. API phiếu thi thử trả `is_assigned: bool` (`CHƯA KIỂM` ở T22: `GET` kết quả thi thử hiện trả trường nào; thiếu thì thêm `is_assigned` vào phản hồi, chỉ đọc).
- **Hàm thuần:** `overallLine(result) -> {kind:'band', value} | {kind:'pending', skills:[...]} | null`. Mọi phiếu và Hôm nay dùng chung hàm này.
- **Không bao giờ hiện:** "0/0", "—" đứng một mình, `NaN`, mã đề nội bộ. Test quét chuỗi trên HTML đã vẽ của ba phiếu.

### 5.2 Migration chấm lại (T21, một file trong dải 420–439)

Lấy số trống đầu tiên lúc viết PR. Ngày 23/11, 420 đã thuộc LEARNERCORE-0063 và 421 thuộc `review_notes_flag_once` ở nhánh đang mở; 0064 lấy số kế tiếp. Đối chiếu `register.tsv` và các PR đang mở trước khi đặt tên file, và thêm dòng `reserved` sớm để không trùng. Thêm dòng `register.tsv`. Có file rollback.

```sql
ALTER TABLE public.essay_regrade_requests
  ADD COLUMN IF NOT EXISTS reason_code text
    CONSTRAINT essay_regrade_reason_code_check CHECK (reason_code IN
      ('score_lower','feedback_mismatch','ai_false_flag','wrong_submission','other')),
  ADD COLUMN IF NOT EXISTS note text
    CONSTRAINT essay_regrade_note_length CHECK (note IS NULL OR char_length(note) <= 300);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'essay_regrade_reason_shape'
      AND conrelid = 'public.essay_regrade_requests'::regclass
  ) THEN
    ALTER TABLE public.essay_regrade_requests ADD CONSTRAINT essay_regrade_reason_shape CHECK (
      (reason_code IS NULL AND char_length(reason) BETWEEN 50 AND 500)
      OR (reason_code IS NOT NULL AND char_length(reason) BETWEEN 1 AND 500
          AND (reason_code <> 'other' OR char_length(btrim(coalesce(note,''))) > 0))) NOT VALID;
  END IF;
END$$;
ALTER TABLE public.essay_regrade_requests VALIDATE CONSTRAINT essay_regrade_reason_shape;
ALTER TABLE public.essay_regrade_requests DROP CONSTRAINT IF EXISTS essay_regrade_reason_length;
```

Khối `DO` theo mẫu mig 085, để chạy lại file không lỗi. `VALIDATE` chạy lại trên ràng buộc đã hợp lệ thì không làm gì. `essay_regrade_reason_length` chỉ bị bỏ sau khi `essay_regrade_reason_shape` đã hợp lệ, nên không có lúc nào bảng thiếu ràng buộc.

- **Thứ tự an toàn:**
  1. Trước khi áp, chạy truy vấn chỉ đọc `SELECT count(*) FROM essay_regrade_requests WHERE char_length(reason) NOT BETWEEN 50 AND 500;` trên staging, rồi trên production trong lần áp được duyệt. Kết quả phải là 0; khác 0 thì dừng và báo anh Andy.
  2. Áp `ADD CONSTRAINT … NOT VALID` rồi `VALIDATE CONSTRAINT` trong cùng file. Runner chạy cả file trong một giao dịch (`backend/migrations/README.md`), và `ADD COLUMN` ở đầu file đã giữ khoá `ACCESS EXCLUSIVE` tới lúc commit, nên hai lệnh này không rút ngắn thời gian khoá. Lý do giữ cách viết này là để file chạy lại được và `essay_regrade_reason_length` chỉ bị bỏ sau khi ràng buộc mới đã hợp lệ. Bảng nhỏ (mỗi bài tối đa một yêu cầu), nên khoá trong một giao dịch là chấp nhận được; vẫn đặt `lock_timeout` như các file gần đây.
- **`reason`** vẫn NOT NULL. Dạng mới lưu vào cột này `"<nhãn tiếng Việt>"`, hoặc `"<nhãn>: <note>"` khi có ghi chú (nhãn dài nhất dưới 60 ký tự, `note` ≤ 300, nên luôn ≤ 500). Như vậy mã cũ và màn admin cũ đọc đủ cả lý do lẫn ghi chú mà không cần hai cột mới.
- **Lùi không mất dữ liệu (sau HOLD 23/11):** đường lùi chuẩn là **chỉ lùi mã**. Hai cột và `essay_regrade_reason_shape` ở lại. Lý do:
  - mã cũ chỉ ghi `{reason}` 50–500 với `reason_code = NULL`, thoả nhánh đầu của `essay_regrade_reason_shape`;
  - accept/reject/fulfil của admin chỉ đổi `status`, không đụng `reason`/`reason_code`/`note`, nên dòng dạng mới vẫn cập nhật được;
  - màn admin cũ đọc `reason`, trong đó đã có nhãn và ghi chú.
  Không có override phá huỷ. File trong `backend/migrations/rollback/` chỉ chạy được khi bảng **chưa có** dòng dạng mới: có bất kỳ dòng `reason_code IS NOT NULL` → `RAISE EXCEPTION` và không đổi gì. Khi 0 dòng, file bỏ `essay_regrade_reason_shape` và hai cột, rồi thêm lại `essay_regrade_reason_length` (đã kiểm hợp lệ vì mọi dòng đều là dạng cũ). Muốn gỡ hai cột sau khi đã có dạng mới thì cần một thiết kế chuyển đổi riêng, giữ được cả mã lẫn ghi chú, và anh Andy duyệt riêng.

### 5.3 API chấm lại

`POST /api/writing/essays/{essay_id}/regrade-request`:

| Body | Kết quả |
|---|---|
| `{reason}` (cắt hai đầu, 50–500) | 201 như hôm nay, `reason_code = null` |
| `{reason_code, note?}` (`note` cắt hai đầu, ≤ 300; bắt buộc khi `other`) | 201; `reason` = nhãn tiếng Việt của `reason_code` |
| có cả `reason` và `reason_code`, hoặc không có cả hai | 422 `regrade_body_ambiguous` |
| `reason_code` lạ, `note` quá 300 ký tự, `other` không có ghi chú | 422 `regrade_reason_invalid` |
| bài không phải của mình hoặc đã xoá mềm | 404 (như hôm nay) |
| bài chưa `delivered` | 409 (như hôm nay) |
| đã có yêu cầu | 409 "Bạn đã gửi yêu cầu chấm lại cho bài này rồi." (như hôm nay) |

- **Model:** `RegradeRequestBody` dùng `model_validator(mode='after')` để phân biệt hai dạng. Bỏ `Field(min_length=50, max_length=500)` của `reason`. Validator cắt hai đầu **trước**, rồi mới kiểm độ dài 50–500; sai thì trả 422 `regrade_reason_invalid`. Như vậy chuỗi có khoảng trắng ở hai đầu, ngắn hơn 50 sau khi cắt, không bao giờ tới DB, nên CHECK không gây 500. Lỗi trả theo khuôn `{"detail":{"error_code","message"}}` hiện có.
- **`GET …/regrade-request`:** `select` thêm `reason_code, note`. Hình `{"request": {...}|null}` giữ nguyên.
- **Admin:** list và detail của `admin_writing_regrade.py` trả thêm `reason_code` (kèm nhãn), `note`. Màn admin hiện "Lý do: <nhãn> · Ghi chú: <note>". Dòng cũ hiện `reason` như hôm nay. Không đổi accept/reject/fulfil.
- **Phạm vi:** không thêm route Speaking.
- **Log:** không log nội dung `reason` hay `note`.

### 5.4 "Làm gì tiếp" và nguồn chấm

- **`nextStep(ctx)`** chọn "Bài tiếp" theo thứ tự:
  1. Bài giao chưa nộp kế tiếp, cùng kỹ năng trước rồi tới kỹ năng khác. Nguồn là `/api/class/my-assignments`; href dựng bằng `my-class-model.mjs`.
  2. `next_lesson` của COURSELESSON-0064.
  3. Hub kỹ năng, lấy từ registry.

  Lỗi một nguồn thì bỏ qua và dùng nguồn kế tiếp.
- **"Xem lại":** dùng neo `#annotations` của phiếu. Bài không có chú thích thì ẩn.
- **"Làm lại":** đích là luồng tạo bài mới cùng đề, theo route hiện có của từng kỹ năng. `CHƯA KIỂM` ở T20 và T22: đường "làm lại cùng đề" của Writing và Speaking.
- **Nguồn chấm:** hai trục như FR-051. Đường trả bài lấy từ `writing_essays.review_mode` (`ai_instant`; `teacher_review` hoặc `NULL` là qua giáo viên). Người đặt band lấy từ `band_source` (`ai`, `teacher`, `unknown`). Phiếu Writing trả thêm `review_mode` (`CHƯA KIỂM` ở T20: không có đường nào giao bài `NULL` mà bỏ qua giáo viên; bài bị gắn cờ được chuyển thẳng sang `delivered` phải ra `band_source = 'unknown'` để không hiện "giáo viên duyệt"). Câu "ước lượng" chỉ hiện khi `band_source = 'ai'`. Nguồn quyền "khoá online" hay "lớp" lấy từ `credit_source` mà G04 trả trên phiếu (`CHƯA KIỂM` tên trường ở G04-T08). Thiếu thì chỉ hiện câu nguồn chấm, không đoán nguồn quyền.

### 5.5 `CreditsEmptyNotice` và `fixLink` (T27)

- **`CreditsEmptyNotice`:**
  - Props: `source: 'online'|'class'`, `canRenew: boolean`, `renewHref?`, `renewCredits?`.
  - Đọc `detail.credit_source` của 402 `insufficient_credits` (`CHƯA KIỂM` tên trường ở G04-T08).
  - `canRenew` lấy từ `GET /api/me/courses` (`can_renew`, kèm `product_slug`); `renewCredits` là `ai_credits` của sản phẩm công khai theo `product_slug` (`courses_public.py`). Cả hai không lấy từ 402. Chưa tải được thì không hiện nút đăng ký lại.
  - Câu chữ theo FR-055.
  - Khối liên hệ là component của PUBLICSITE-0059 FR-026.
- **`fixLink(fix, ctx)`:**
  - Đầu vào là mã lỗi hoặc nhãn tiêu chí mà backend đã trả trên phiếu (`CHƯA KIỂM` trường nào mang mã ở `writing-top-fixes.tsx` và payload phiếu Speaking).
  - `fix-link-map.json` có dạng `{ "<error_code>": {"type":"grammar","slug":"…","anchor":"…"} | {"type":"vocab","path":"…"} }`.
  - Test node đối chiếu mọi `slug` với danh sách bài Grammar Wiki (`backend/content/**`). Slug không có thì CI đỏ.
  - Không có ánh xạ thì trả `null`.

### 5.6 Đoạn chấm phát âm và dòng lượt (T22)

- **Đoạn chấm phát âm:** đọc `pronunciation.sample = {scope, start_s, end_s, seconds, message}` của G04-T13 (COURSEACCESS-0055 mig 502, `services/pronunciation_sampling.py`). Trường chưa có thì không hiện dòng.
  - Nút nghe dùng URL ký từ route phát lại hiện có (`recording_audio.py`, ký sau khi kiểm quyền), và đặt `currentTime = start_s`, dừng ở `end_s`.
  - Bản ghi quá hạn giữ (route trả 410 hoặc 404) thì ẩn nút.
- **Dòng lượt:** số dư lấy từ API số dư của G04 (`GET /api/me/credits`, `CHƯA KIỂM` tên). Số `k` theo bảng đơn vị ở FR-058. Lỗi hoặc không đo lượt thì ẩn dòng.

## UI and interaction

- Theo tờ `KetQuaWriting.dc.html`, `PhieuKetQua.dc.html` mục 1–4 và `GiaHanThemLuot.dc.html`. Chỉ dùng token G03.
- Form chấm lại:
  - 5 lựa chọn dạng radio; chọn bằng bàn phím được.
  - Ô ghi chú có bộ đếm "n/300".
  - Lỗi hiện dưới ô và tiêu điểm chuyển tới ô lỗi.
  - Nút "Đang gửi…" khoá trong lúc gửi.
  - Sau 201 thì tải lại trạng thái bằng `GET`, không giữ trạng thái lạc quan.
- 4 bước chờ duyệt là danh sách có thứ tự, có `aria-current="step"` ở bước hiện tại.

## Work decomposition

Xem `tasks.md`. Thứ tự:
1. T27 (component, model).
2. T20 (khung phiếu, phiếu Writing).
3. T21 (chấm lại: migration, API, màn).
4. T22 (phiếu Speaking và thi thử).

## Rollout and rollback

Xem `rollout.md`. Tóm tắt:
- Cây phiếu mới đặt sau cờ `learner_v2`.
- API chấm lại nhận hai dạng body, nên frontend cũ không vỡ.
- Migration áp staging trước, mỗi lần áp có anh Andy gõ duyệt và chạy truy vấn chỉ đọc trước.

## Verification strategy

- **Pytest (T21):**
  - dạng cũ 201;
  - dạng mới 201 và `reason` là nhãn;
  - lẫn lộn hoặc thiếu cả hai → 422 `regrade_body_ambiguous`;
  - `other` thiếu ghi chú hoặc ghi chú toàn khoảng trắng → 422;
  - `note` 301 ký tự → 422;
  - trùng → 409;
  - chưa `delivered` → 409;
  - `GET` có `reason_code`, `note`;
  - list và detail của admin có hai cột;
  - test PG: CHECK mới chặn đúng; dòng cũ 50–500 vẫn hợp lệ; file rollback `RAISE` và không đổi gì khi có `reason_code`, chạy được khi 0 dòng dạng mới;
  - **lùi mã với dữ liệu giả:** có sẵn một yêu cầu `other` kèm ghi chú → chạy route và route admin của mã cũ (trước T21) trên cùng schema: admin đọc được ghi chú trong `reason`, accept/reject/fulfil thành công, học viên khác gửi dạng cũ được → chạy lại mã mới: `reason_code`, `note` của dòng đó còn nguyên.
- **Node:**
  - `band-display-model` đủ mọi ô của bảng 5.1, gồm mini test có `overall` thì trả `null`;
  - `fixLink` có ánh xạ và không có ánh xạ; slug tồn tại;
  - `nextStep` theo đủ ba nguồn và khi một nguồn lỗi.
- **React:**
  - ba lối ra;
  - nguồn chấm với `ai`, `teacher`, `unknown`;
  - bài chờ duyệt không có band trong DOM;
  - form chấm lại (Khác bắt buộc ghi chú, bộ đếm, 409);
  - `CreditsEmptyNotice` đủ ba ca, không có chuỗi "mua" hay "giá";
  - dòng đoạn phát âm theo ba `scope` và khi bản ghi hết hạn.
- **Chung:** `git diff --exit-code frontend/types/api.d.ts` sau khi sinh lại; chạy toàn bộ bộ test backend ở T21.
