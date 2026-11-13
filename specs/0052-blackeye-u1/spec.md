---
id: BLACKEYE-0052
title: Black Eye Listening Unit 1 exercises are assigned to a class, reviewed after submission and stay locked until each gate passes
status: approved
risk: high
owner: product
---

# Black Eye Listening Unit 1 exercises are assigned to a class, reviewed after submission and stay locked until each gate passes

Trạng thái: **approved**. Anh Vinh duyệt lúc 17:50 ngày 10/11/2026 (Asia/Saigon,
UTC+7), widget t1601s5314, qua Leader: spec này và Q-1..Q-16 theo đề xuất của FD
(xem `approval-decision.md` và mục "Quyết định của anh Vinh (10/11/2026)").
Quyết định này **không** duyệt merge PR spec, chạy migration, production hay
giao bài cho học viên thật (T014). FD viết ngày 10/11/2026 (giờ Việt Nam) theo
việc BLACKEYE-U1-SPEC của Leader. Số spec **0052** đã ghi trong
`/workspace/cc-jobs/spec-number-register.md`. Spec này **không** cấp số
migration (xem "Thay đổi dữ liệu, config, migration").

Vì sao có spec này: PR #2279 (`blackeye-u1-pr1`, head
`3a7d494e21baa52da10092ac99f65f67a8869be1`) thêm route, kiểm quyền và lưu kết
quả, nên là `high-risk`. Check "Spec and PR metadata"
(`backend/scripts/validate_specs.py`) bắt buộc PR high-risk có spec đã duyệt
trên base `staging`. Handoff anh Vinh gửi (t1594u/t1596u) §5.1 ghi: không hạ
loại PR, không mượn spec khác, không sửa validator. Spec này mô tả đúng phạm vi PR1 đang
có, và vẽ ranh giới cho PR2 và các PR sau.

Theo `specs/README.md`, spec phải được merge vào `staging` ở trạng thái
`approved` trước khi làm code. Theo t1601s5314, FD mở PR spec (chỉ tài liệu)
vào `staging`; merge PR spec cần anh Vinh duyệt riêng.

## Nguồn

Mọi nguồn nằm ở `/workspace/cc-jobs/process/blackeye-u1-source-20261110/`.
Tên file là SHA256 đầy đủ; 12 ký tự đầu khớp `SHA256-12.txt` (FD kiểm lại bằng
`sha256sum` lúc 17:17 ngày 10/11/2026, khớp cả 10 file).

| Nguồn | SHA256 (12 ký tự) | Gọi tắt trong spec |
| --- | --- | --- |
| Handoff của anh Vinh, chụp 16:45 10/11 (t1594u) | `0320e094634e` | Handoff |
| Đề xuất khảo sát (proposal) | `541dbd52bcd9` | Proposal |
| Thiết kế pilot Unit 1 A1–A20 | `bc9007518cc6` | Design |
| Bảng xung đột đáp án theo câu | `c3afc51c97b3` | Conflicts |
| Hợp đồng triển khai Unit 1 (contract v1) | `2df625064ae7` | Contract |
| S0 freeze amendment | `e0fbc780408a` | S0 |
| Quyết định bảo mật MV1/N2 | `b2a4c38bd248` | MV1 |
| Sổ quyết định khảo sát | `bbb38e36a51e` | Survey decision |
| Quyết định release nấc 1 (push + PR vào staging) | `743673a89058` | Tier-1 |

Thêm: diff PR #2279 (đọc chỉ đọc, `git diff origin/staging...3a7d494e2`), lời
anh Vinh qua Leader t1597u (17:18), t1598u và t1600u (10/11/2026).

Spec **không** chép lời sách, câu hỏi, đáp án, script hay transcript. Mọi chỗ
cần nội dung sách chỉ ghi vị trí hoặc tên trường dữ liệu.

## Quyết định của anh Vinh

### 11 quyết định đã chốt (Handoff §4, nguyên văn tóm tắt; nguyên gốc ở Survey decision)

1. **Chữa bài:** chữa sau khi nộp cho bản đầu. Chữa từng câu để làm sau.
2. **Activity thiếu audio:** vẫn hiện, kèm lý do thiếu audio, khóa nút làm bài.
3. **Chính tả:** là bài bổ trợ tự chọn, tiến độ và điểm tách riêng. Chỉ mở sau
   một quyết định riêng bật 0011 v2. *(Xem thay đổi D-3 bên dưới.)*
4. **Phạm vi thử:** chỉ Unit 1 (A1–A20).
5. **A19:** vẫn hiện nhưng khóa, chờ nguồn lựa chọn A/B gốc được review.
6. **A17:** dùng bản phân loại tự đối chiếu, ghi rõ là chuyển thể từ biểu đồ.
7. **Câu có đáp án hỏng hoặc bất đồng:** lập bảng từng câu, đề xuất đáp án theo
   script, hỏi bên PDF kiểm sách gốc. Bên PDF trả lời mọi câu đều UNRESOLVED.
   Tạm thời các câu UNRESOLVED chỉ tự đối chiếu, không tính điểm. Một câu chỉ
   được chấm tự động khi đã xác nhận trang gốc **và** chủ dự án duyệt answer set.
   *(Giữ nguyên; anh Vinh được hỏi lại ở Q-1.)*
8. **Code:** chỉ code và test local với dữ liệu giả theo đúng hợp đồng, mọi cổng
   live, ghi và phát hành vẫn đóng. Sau đó có quyết định riêng cho phép push và
   mở PR vào staging (Tier-1). Merge cần duyệt riêng theo từng PR và SHA.
9. **Nội dung:** một người viết, chủ dự án kiểm học thuật và duyệt đáp án. Chưa
   mở viết nội dung thật. *(Xung đột với t1597u, xem D-4 và Q-3.)*
10. **Kiểm thử:** chỉ dùng lớp và tài khoản giả, chưa thử với học viên thật,
    không ghi staging. *(Phần đối tượng prod đã đổi bởi t1600u, xem D-2.)*
11. **Audio:** chỉ kiểm tại chỗ và lập danh sách. Chỉ upload lên staging riêng
    tư khi chủ dự án duyệt đúng danh sách file. *(Câu cuối của §4.11 về quyền sử
    dụng nguồn được thay bằng D-5.)*

### Quyết định mới và thay đổi (10/11/2026)

- **D-1 (t1597u, 17:18; sửa tên lớp t1598u):** bài Black Eye Listening được tải
  lên ở trang admin và giao cho lớp **course 2**, có theo dõi tiến độ, đáp án và
  giải thích; chính tả cũng được mở; còn thiếu một số audio; viết nội dung và
  giải thích giao cho Claude/Codex. Spec đưa các phần này vào phạm vi (FR-016 đến
  FR-023) và chia theo PR. Chỗ nào đổi quyết định cũ đều có Q-n để anh xác nhận.
- **D-2 (t1600u):** lớp course 2 **có học viên thật** (học viên lên lớp từ khóa
  trước). Đối tượng trên production là học viên thật của course 2. Đây là **thay
  đổi** quyết định §4.10 "chỉ dữ liệu giả" **cho đối tượng prod**. Phần còn lại
  của §4.10 vẫn giữ cho kiểm thử: test trên staging chỉ dùng lớp giả và tài
  khoản giả (FR-024). Giao bài cho học viên thật trên prod là một bước release
  riêng, cần anh Vinh duyệt đúng bản release đó; không nằm trong merge PR1/PR2
  (FR-025, task T014).
- **D-3 (t1597u):** chính tả nằm **trong phạm vi** spec. Đây là **thay đổi**
  quyết định §4.3 ("chỉ mở sau quyết định riêng bật 0011 v2"). Cho tới khi anh
  xác nhận ở **Q-2**, hành vi code vẫn theo §4.3 cũ: chính tả Black Eye khóa.
- **D-4 (t1597u):** viết nội dung và giải thích giao cho Claude/Codex, Content
  Manager (CM) nghiệm thu học thuật trước khi publish. Khác §4.9 (một người viết
  là web-content, chủ dự án kiểm học thuật và duyệt đáp án). Spec giữ §4.9 ở
  điểm "anh Vinh duyệt answer set" và hỏi ở **Q-3**.

- **D-5 (t1599u, 17:20, anh Vinh qua Leader):** chủ dự án quyết định không cần
  xử lý bản quyền sách và audio Black Eye. Spec không còn điều kiện "chờ xác
  nhận bản quyền" ở FR, task, nghiệm thu hay release. Quy tắc riêng của spec
  vẫn giữ: spec, code và fixture không trích nội dung sách hay đáp án.

Các giới hạn cũ vẫn giữ cho tới khi anh duyệt spec: không chạy SQL/migration,
không prod, không upload audio, không sửa validator, không push/commit/PR.

## Tóm tắt (tiếng Việt)

- Đưa bài tập Unit 1 (A1–A20) sách *Black Eye IELTS Listening v5 (thượng)* lên
  web Aver với một định danh riêng, không dùng lại định danh bộ 80 ngày.
- Học viên làm bài, lưu, nộp; sau khi nộp mới thấy đáp án tham chiếu, giải
  thích tiếng Việt và transcript của **đúng activity đó**. Không có điểm tự
  động: mọi câu hiện là tự đối chiếu (§4.7).
- A8 (No.8 là file tải dở 0 byte), A14 (thiếu No.14) và A19 (chưa review lựa
  chọn A/B gốc) vẫn hiện trong danh sách nhưng khóa, có nhãn lý do.
- **PR1 (PR #2279):** ranh giới backend, DTO chặt, kiểm quyền, nộp bài
  report-only, trang chữa bài có bảo vệ, chặn mọi đường phụ. Đường giao bài
  đóng (503). Dữ liệu giả, chưa bật cho học viên.
- **PR2:** admin xem trước và giao bài cho course 2, theo dõi tiến độ, runner và
  màn chữa bài phía học viên, nhãn khóa activity thiếu audio.
- **PR3 trở đi:** tải gói nội dung ở trang admin, đáp án và giải thích thật
  (Claude/Codex viết, CM nghiệm thu), chính tả Black Eye, và bước release riêng
  cho học viên thật trên prod.

## Problem

Admin chưa giao được bài tập sách Black Eye Listening v5 (thượng) cho lớp, và
học viên không có nơi làm, nộp rồi xem chữa bài. Code hiện có chỉ hỗ trợ bộ 80
ngày (`backend/models/listening_source_collection.py` gắn cứng định danh 80
ngày), importer chặn quá 40 câu một form (A13 có 48 ô trả lời), đường chữa từng
câu (0006) từ chối bài được giao, và chưa có trang chữa bài sau khi nộp cho bài
được giao (Contract §3 MV1, MV2, MV3).

Nguồn đáp án chưa chắc chắn: bên PDF trả lời mọi câu trong bảng xung đột là
UNRESOLVED (Conflicts §2–3), nên không câu nào được chấm tự động. Hai file audio
Unit 1 hỏng hoặc thiếu (Handoff §2, §6).

Lớp course 2 có học viên thật (t1600u), nên mọi dữ liệu bài làm và tiến độ là
dữ liệu cá nhân thật khi lên prod, và mọi lỗi lộ đáp án trước khi nộp làm hỏng
bài tập.

## Scope

- Định danh Black Eye riêng và DTO chặt cho học viên, admin và giáo viên
  (PR1).
- Danh sách Unit 1 cho học viên, activity khóa có lý do (PR1 backend, PR2 UI).
- Bắt đầu, lưu, nộp, đọc lại bài làm độc lập (standalone) với dữ liệu báo cáo,
  không điểm (PR1).
- Trang chữa bài sau khi nộp cho chủ bài và cho giáo viên được phép (PR1
  backend, PR2 UI).
- Chặn mọi đường phụ: chữa từng câu, reveal, check, chấm theo section, player
  chung, chính tả (PR1).
- Giới hạn 48 ô chỉ cho đúng hợp đồng Black Eye; 40 ô chung giữ nguyên (PR1).
- Admin xem trước và giao Unit 1 cho course 2, theo dõi tiến độ (PR2).
- Hợp đồng dữ liệu đáp án và giải thích, cách hiển thị (PR1 phần đọc; nội
  dung thật ở giai đoạn nội dung).
- Tải gói nội dung ở trang admin (PR3, cần Q-8).
- Chính tả Black Eye (PR riêng sau PR2, cần Q-2).
- Bước release riêng cho học viên thật course 2 trên prod (T014).

## Non-goals

- Unit 2 hoặc cả sách (§4.4).
- Chữa từng câu trong lúc làm cho bài được giao (§4.1).
- Chấm điểm tự động bất kỳ câu nào trong bản này; điểm band/CEFR/đạt-trượt
  (§4.7).
- Mở A19 hoặc thay A19 bằng bản điền ngày dựng lại (§4.5).
- Phục hồi biểu đồ gốc của A17 (§4.6).
- Sửa nguồn PDF; chép nội dung sách vào code, fixture hay spec.
- Dùng AI, STT hay TTS trả phí lúc chạy; dịch hoặc chấm ngữ nghĩa bằng AI.
- Bucket công khai; phát file master `normalized.md` hay cả gói STAFF.
- Thông báo thật cho học viên (email/push) trong PR1/PR2 (xem Q-13).
- Đổi luồng Grammar/Writing, bộ 80 ngày, các bài Listening đã giao, lịch sử
  chính tả hay cờ `DICTATION_LEXICAL_V2_ENABLED` trong PR1/PR2.
- Bất kỳ PR hay promote nào vào `main` trong phạm vi merge PR1/PR2.

## Users and journeys

- **Học viên course 2** (thật trên prod sau T014; giả trên staging): mở bài
  được giao → thấy danh sách A1–A20, activity khóa có nhãn → làm activity được
  mở → lưu tự động → nộp (xác nhận ô trống) → xem chữa bài của activity đó → về
  lại đúng lớp.
- **Học viên tự luyện (standalone):** cùng luồng, không có lớp. Đây là luồng
  duy nhất mở trong PR1, và chỉ mở khi có dữ liệu đã publish (hiện chưa có).
- **Giáo viên/admin của course 2:** xem trước Unit 1, chọn activity sẵn sàng,
  chọn học viên, hạn nộp, giao bài; xem bảng tiến độ ai đã làm gì; mở chữa bài
  của một học viên đã nộp.
- **Content (Claude/Codex) và CM:** viết và nghiệm thu đáp án tham chiếu, giải
  thích tiếng Việt, ghi chú giới hạn nguồn (task T011).
- **Anh Vinh:** duyệt answer set, quyết các Q-n, duyệt từng merge và bước
  release thật.

### Luồng admin tải lên và giao bài cho course 2

| Bước | Hành vi | PR |
| --- | --- | --- |
| 1 | Admin tải gói nội dung Unit 1 lên trang admin; hệ thống chạy kiểm tra (dry-run), báo lỗi theo ô, tạo bản nháp, không publish | PR3 (Q-8) |
| 2 | CM nghiệm thu học thuật; anh Vinh duyệt answer set; mới được publish revision | Giai đoạn nội dung (T011, T012) |
| 3 | Lớp course 2 → Giao bài → Listening → Black Eye v5 (thượng) → Unit 1: xem trước A1–A20 và ma trận sẵn sàng; A8/A14/A19 hiện nhưng không chọn được | PR2 (FR-016) |
| 4 | Chọn activity sẵn sàng, học viên (một, nhóm, cả lớp), hạn nộp theo giờ `Asia/Ho_Chi_Minh`, xác nhận số người nhận thật | PR2 (FR-017) |
| 5 | Giao bài idempotent: gửi lại cùng request trả cùng biên nhận; giao lại có chủ ý là bài giao mới | PR2 (FR-017) |
| 6 | Bảng tiến độ: mỗi học viên × activity: chưa bắt đầu / đang làm / đã nộp / quá hạn / không khả dụng; giờ nộp; số ô trống; chính tả cột riêng | PR2 (FR-018) |
| 7 | Mở chữa bài của học viên đã nộp | PR1 backend (FR-010), PR2 UI |
| 8 | Bật cho học viên thật course 2 trên prod | Release riêng (FR-025, T014) |

Trong PR1 các bước 3–6 trả 503 (FR-012).

## Requirements

Nhãn pha: **[PR1]** = có trong PR #2279; **[PR2]**; **[PR3+]** = PR sau hoặc
giai đoạn nội dung/release. FR của PR1 khớp route, model và service trong diff
PR #2279 (bảng ánh xạ ở plan.md).

- **FR-001:** [PR1] Black Eye có định danh riêng: programme `blackeye-v5-upper-listening`, collection `blackeye-v5-upper`, source contract `blackeye_u1_v1`, unit `U1`, activity `U1-A01`…`U1-A20` (regex `^U1-A(0[1-9]|1[0-9]|20)$`); mọi DTO Black Eye trong `backend/models/listening_blackeye.py` là strict và từ chối trường lạ; hằng số và model bộ 80 ngày không đổi.
- **FR-002:** [PR1] `GET /api/listening/source-collections/blackeye-v5-upper/units/U1` yêu cầu đăng nhập và trả `BlackEyeUnitPublic` chỉ gồm activity có test và gói nội dung đều `published`, `is_public` và đúng programme; chỉ chứa trường trong allowlist công khai (không đáp án, giải thích, transcript, bằng chứng, verdict, đường dẫn riêng); trùng activity, dữ liệu hỏng hoặc rỗng trả 503; header `Cache-Control: private, no-store`.
- **FR-003:** [PR1] A8, A14, A19 luôn có `readiness=locked`, `selectable=false` và lý do lần lượt `audio_incomplete_download`, `audio_not_found`, `original_options_unreviewed`; model từ chối dữ liệu trái điều này; start cho activity khóa hoặc chưa `ready` trả 422 trước khi tạo attempt; activity khóa không có attempt giả và không vào mẫu số hoàn thành.
- **FR-004:** [PR1] `POST /api/listening/tests/{test_id}/attempts?standalone=true` cho test Black Eye (server nhận ra từ dữ liệu test, không từ trường client) bắt buộc `blackeye_binding: BlackEyeLearnerBinding`; thiếu, null, sai dạng hoặc sai định danh trả 422; revision nội dung/policy cũ trả 409; có khóa `answer_set_revision` trả 422 giống hệt nhau với mọi giá trị; `blackeye_binding` gửi tới test không phải Black Eye trả 422; caller cũ không gửi trường này giữ nguyên hành vi; admission chỉ qua RPC service-only `fn_acquire_blackeye_attempt` và trả `BlackEyeAttemptState`; `class_item`, sitting hoặc purpose khác `practice` trả 503/422 trong PR1.
- **FR-005:** [PR1] `PATCH /api/listening/tests/attempts/{attempt_id}/answers` cho attempt Black Eye chỉ cho chủ attempt (khác chủ, kể cả admin toàn cục, trả 404 trước mọi đọc snapshot và mọi ghi), kiểm `q_num` theo bản đồ ô đã đóng băng, kiểm codec ô KEEP/CHANGE `{version:'blackeye_keep_change_v1', action, correction_text}` (không thêm khóa, không trùng khóa), lưu nguyên văn không sửa ký tự nào, trả `BlackEyeSaveAck` với `performance_event_recorded=false`; giá trị sai dạng trả 422, không rơi về đường text cũ; attempt hết hạn hoặc không còn `in_progress` trả 422; attempt được giao trả 503 trong PR1.
- **FR-006:** [PR1] Importer và đường lưu cho phép 1..48 ô trả lời chỉ khi programme đúng Black Eye và bản đồ ô hợp lệ khớp `source_item_id`; A13 phải đúng 48 ô trong một activity và một lần nộp; 49 ô, trùng, thiếu hoặc lệch số bị từ chối; form chung giữ `MAX_FORM_ITEMS=40` và nguyên thông báo lỗi cũ; gắn dữ liệu Black Eye vào form chung bị từ chối.
- **FR-007:** [PR1] `POST /api/listening/tests/attempts/{attempt_id}/submit` cho attempt Black Eye chuyển `in_progress` → `submitted` bằng một lệnh cập nhật có điều kiện (đúng chủ, đúng trạng thái, đúng bộ đáp án, chưa hết hạn), lưu `result_summary` báo cáo `{submitted:true, item_count, blank_count, unscored_count=item_count, objective_denominator:0, score:null, band_estimate:null}`; đọc lại bản chuẩn sau khi ghi; nộp lại một attempt đã nộp trả đúng trạng thái đã lưu mà không chấm lại hay đọc catalog hiện tại; thua race trả 409.
- **FR-008:** [PR1] `GET /api/listening/tests/attempts/{attempt_id}` và `GET /api/listening/tests/{test_id}/attempts/in-progress` cho Black Eye chỉ trả cho chủ attempt `BlackEyeAttemptState` / `BlackEyeInProgress` dựng từ snapshot đã đóng băng, không có đáp án hay tài liệu bảo vệ; tra cứu in-progress có `class_item`, sitting hoặc không standalone trả 503 trong PR1; `result_summary` lệch so với tính lại từ snapshot trả 503.
- **FR-009:** [PR1] `GET /api/listening/tests/attempts/{attempt_id}/review` cho Black Eye: chỉ chủ attempt (khác chủ, kể cả admin toàn cục, trả 404 giống FR-008, không xác nhận attempt tồn tại), chỉ khi đã nộp (409), kiểm test vẫn published và snapshot khớp revision trước khi đọc `marking_rows`; trả `BlackEyeActivityReview` gồm câu trả lời đã lưu, cờ trống, `source_status`, `scoring_mode='SELF-CHECK'`, `academic_verdict`, đáp án tham chiếu, nguồn gốc đáp án, giải thích tiếng Việt, ghi chú giới hạn (bắt buộc với UNRESOLVED/DISAGREEMENT) và transcript của đúng activity không có mốc thời gian; audio `url=null`, `granularity='whole_activity'`; lỗi tải chữa bài trả 503 và không đổi bài đã nộp.
- **FR-010:** [PR1] `GET /admin/cohorts/{cohort_id}/assignments/{assignment_id}/items/{item_id}/listening-review` yêu cầu admin, đúng cohort, đúng người tạo bài giao (`assigned_by`), đúng item, item gắn đúng attempt Listening của đúng học viên và attempt đã nộp, rồi mới đọc dữ liệu bảo vệ; admin toàn cục không phải người tạo bị 403; sai cohort/item 404; trả `BlackEyeActivityReview`, `private, no-store`. Giáo viên và admin chỉ **đọc**: trong PR1/PR2 không có đường nào cho họ ghi điểm, sửa câu trả lời hay mở lại bài Black Eye của học viên. Từ PR2, người được phép đọc theo FR-027.
- **FR-011:** [PR1] Với mọi attempt hoặc test Black Eye: guided-state, reveal và check trả 422 trước mọi lần đọc dữ liệu bảo vệ; chấm theo section qua `content_id`/`exercise_id` trả 422 trước khi đọc transcript, chấm hay ghi; player `GET /api/listening/tests/{test_id}`, `playback-started` và admin preview không bao giờ dùng bộ dựng payload chung và trả 503 tạm thời; các route chính tả trả 422 "requires separate release". **Deny-by-default:** mọi route nhận `attempt_id`, `test_id`, `content_id`, `exercise_id`, `programme_id` hoặc `lesson_id` mà gặp dữ liệu Black Eye phải nằm trong allowlist route Black Eye (plan.md "Kiểm kê route") hoặc trả 422/503 trước mọi đọc dữ liệu bảo vệ và mọi ghi; gồm cả `GET/PATCH /api/listening/tests/attempts/{attempt_id}/review-flags`, `POST /api/mock-corrections/{skill}/attempts/{attempt_id}/post-test-capture`, `POST /api/mock-corrections/{skill}/attempts/{attempt_id}/items/{q}/events`, `POST /api/listening/tests/attempts/{attempt_id}/renderer-affinity`, `GET /api/listening/tests/{test_id}/practice-windows`, `GET /api/listening/programmes/{programme_id}/lessons` và `GET /api/listening/programmes/{programme_id}/lessons/{lesson_id}`; một test kiểm kê duyệt `app.routes` và fail khi có route nhận các tham số trên mà chưa được xếp vào allowlist hoặc chưa có test 422/503 với fixture Black Eye.
- **FR-012:** [PR1] Đường giao bài Black Eye đóng trong PR1: `GET /admin/cohorts/{cohort_id}/listening-source-catalog`, `POST /admin/cohorts/{cohort_id}/listening-source-assignments`, `GET /admin/cohorts/{cohort_id}/listening-source-assignments/{assignment_id}` yêu cầu admin rồi trả 503; giao bài chung (`create_assignment` ở router và `create_class_assignment` ở service) với test Black Eye trả 503 trước mọi kiểm tra hay ghi khác; với bài giao Black Eye, các route chung bù người nhận (`backfill_assignment`), đổi trạng thái (`update_assignment`), đổi hạn (`update_assignment_due`), xóa (`delete_assignment`) và trả bài (`return_student_work`) trả 503 trước mọi ghi; mọi đường giao bài khác, kể cả luồng giao bài của ADMINSIMPLE-0049 khi được làm, gặp test Black Eye phải trả 503 qua cùng `assignment_seam` cho tới PR2.
- **FR-013:** [PR1] `answer_set_revision` (UUID mờ, không suy ra từ nội dung đáp án, không phải hash duyệt) chỉ xuất hiện ở ba bề mặt giao bài của người có quyền theo FR-027: catalog (FR-016), request tạo bài giao và biên nhận (FR-017); không xuất hiện ở bảng tiến độ, chữa bài giáo viên, mọi bề mặt học viên (kể cả body lỗi, header và `paper_revision` có thể đổi theo answer set) hay đọc trực tiếp PostgREST/Realtime bằng JWT client; lỗi validate của `blackeye_binding` trả 422 chung không lặp lại giá trị gửi lên; mọi response Black Eye mang `Cache-Control: private, no-store`.
- **FR-014:** [PR1] Caller không phải Black Eye giữ nguyên request, response và mã lỗi: `attempt_receipt` chung, importer 40 câu, chính tả chung vẫn chấm và lưu, attempt chẩn đoán cũ không có revision không thêm lần đọc catalog; ba dòng allowlist sync-in-async đã lỗi thời được xóa vì lời gọi đã chạy qua threadpool, không thêm dòng mới.
- **FR-015:** [PR1] SQL đề xuất `docs/proposals/blackeye-u1/admission.sql` nằm ngoài `backend/migrations/`, không có số migration, không được runner hay workflow nào phát hiện (test tĩnh `backend/tests/test_blackeye_admission_proposal_static.py` khóa điều này) và chưa chạy ở đâu; khi RPC `fn_acquire_blackeye_attempt` chưa có, start Black Eye trả 503, không tạo attempt.
- **FR-016:** [PR2] Người có quyền giao bài cho course 2 theo FR-027 xem `BlackEyeSourceCatalog = {inventory: BlackEyeUnitAdmin, eligible_recipient_ids, lookup_errors}`; `BlackEyeUnitAdmin` mang binding đủ 8 trường (có `answer_set_revision` mờ) và không trường bảo vệ nào khác (đây là một trong ba bề mặt duy nhất có trường này, xem FR-013); học viên, người được cấp quyền lớp khác và admin toàn cục không có quyền FR-027 nhận 403/404; tra cứu học viên lỗi hiện lỗi, không hiện danh sách rỗng.
- **FR-017:** [PR2] Người có quyền theo FR-027 giao Unit 1 cho course 2 bằng `BlackEyeAssignmentCreate` (request_id, activity sẵn sàng, học viên, hạn nộp, `deadline_timezone='Asia/Ho_Chi_Minh'`, replay_policy) và nhận `BlackEyeAssignmentReceipt` với giá trị server đóng băng; trong một giao dịch: đóng băng danh sách activity có thứ tự, revision, người nhận, hạn, mẫu số hoàn thành; cùng request trả cùng biên nhận, khác dấu vân tay trả 409, revision cũ trả 409; activity khóa không chọn được; mở start/save/submit/review cho attempt được giao gắn đúng snapshot bài giao. Mọi thay đổi bài giao Black Eye (bù người nhận, trạng thái, hạn, xóa, trả bài) chỉ đi qua route Black Eye, chỉ người có quyền theo FR-027, và giữ snapshot người nhận: bù người nhận tạo bài giao và biên nhận mới, ghi vào nhật ký lớp hiện có (`class_action_log`).
- **FR-018:** [PR2] Bảng tiến độ, chỉ cho người có quyền đọc theo FR-027, hiện, cho mỗi học viên × activity, một trạng thái lấy từ dữ liệu đã lưu: chưa bắt đầu, đang làm, đã nộp, quá hạn, không khả dụng; giờ nộp và số ô trống; không hiện điểm hay độ chính xác; chính tả là cột riêng; tải lại trang hiện cùng trạng thái; lỗi tra cứu hiện lỗi, không hiện 0.
- **FR-019:** [PR2] Màn học viên: danh sách Unit 1 hiện mọi activity; activity thiếu audio (A8, A14) và A19 có nhãn trạng thái rõ và nút "Bắt đầu" bị khóa (không bấm được, có lý do đọc được bằng trình đọc màn hình); runner hỗ trợ ô text và ô KEEP/CHANGE, bảng giữ ngữ cảnh hàng/cột, lưu có trạng thái đang lưu/đã lưu/lỗi, nộp có xác nhận ô trống; sau nộp hiện "Không chấm điểm tự động" thay cho điểm.
- **FR-020:** [PR2] Màn chữa bài phía học viên và giáo viên đọc `BlackEyeActivityReview`: hiện câu trả lời đã lưu, đáp án tham chiếu kèm nguồn gốc (`literal_key`, `derived`, `editorial`), giải thích tiếng Việt, ghi chú giới hạn cạnh từng câu UNRESOLVED/DISAGREEMENT và transcript của đúng activity; thiếu đáp án hoặc giải thích hiện "chưa có", không bao giờ hiện là sai; trước khi nộp không có dữ liệu này trong JSON, HTML, SSR/RSC, cache, preload hay nhãn accessibility.
- **FR-021:** [PR3+] Đáp án tham chiếu và giải thích là tài liệu bảo vệ, gắn với revision bất biến: mỗi câu có `source_item_id`, `source_status`, `academic_verdict`, `reference`, `reference_provenance`, `explanation_vi`, `limitation_vi`, `evidence_pointer`, cộng người viết, người nghiệm thu CM, thời điểm, tham chiếu anh Vinh duyệt answer set; chỉ revision đã được CM nghiệm thu và anh Vinh duyệt mới publish được; sửa nội dung tạo revision mới, không chấm lại hay sửa bài đã nộp.
- **FR-022:** [PR3+] Admin tải gói nội dung Unit 1 trên trang admin: hệ thống kiểm tra gói (định danh, bản đồ ô, giới hạn 48, không có trường bảo vệ trong phần công khai, media đã duyệt), báo lỗi theo ô, lưu bản nháp; publish bị chặn khi thiếu nghiệm thu CM hoặc duyệt answer set; audio chỉ là handle tới file riêng tư đã duyệt danh sách (§4.11).
- **FR-023:** [PR3+] Chính tả Black Eye là bài bổ trợ tự chọn, tiến độ và điểm tách khỏi Listening, chấm theo 0011 lexical v2 với đoạn, câu và hash tham chiếu đã duyệt; cho tới khi anh Vinh xác nhận Q-2 và release 0011 v2 được duyệt, card chính tả hiện "Bổ trợ tự chọn / Chưa mở", start trả 422 và không có đường dự phòng chính tả cũ.
- **FR-024:** [PR1, PR2, PR3+] Mọi kiểm thử trên staging chỉ dùng lớp giả và tài khoản giả do team sở hữu; không dùng roster, tài khoản hay dữ liệu bài làm của học viên course 2 thật; không gửi thông báo thật; test local dùng DB tạm của task và dữ liệu giả.
- **FR-025:** [Release] Giao bài Black Eye cho học viên thật course 2 trên prod chỉ xảy ra sau một bước release riêng được anh Vinh duyệt cho đúng bản release (SHA, migration, gói nội dung đã duyệt, danh sách audio đã duyệt); merge PR1/PR2 vào staging hay promote code không tự bật việc này.
- **FR-026:** [PR1, PR2, PR3+] Dữ liệu bài làm, tiến độ và đáp án: học viên chỉ đọc được dữ liệu của chính mình (test ma trận IDOR: học viên B dùng `attempt_id`/`test_id` của học viên A trên GET state, GET in-progress, PATCH answers, submit, review, playback-started, renderer-affinity, review-flags, mock-corrections nhận 404, không đọc `marking_rows`/snapshot, không ghi; admin toàn cục gọi route học viên với attempt người khác cũng 404); chỉ người có quyền theo FR-027 đọc được dữ liệu học viên course 2; không đưa câu trả lời, đáp án, giải thích, transcript, email, tên hay `user_id` thô của học viên vào bất kỳ nơi ghi nào (logging Python mọi mức, bảng `error_logs` qua handler lỗi backend và `POST /api/error-logs`, Sentry message/exception/breadcrumb/extra, access log/URL); ngoại lệ duy nhất (SA-2280-F11): `user_id` được nằm ở cột có cấu trúc `error_logs.user_id` như handler hiện có điền theo thiết kế (chỉ admin đọc), và bị cấm trong `error_logs.message`, `error_logs.stack`, URL/query, log text và Sentry; có test sentinel cho `caplog`, insert `error_logs` (kiểm `message`/`stack`, không kiểm cột `user_id`) và event Sentry qua `before_send`; Security Auditor review spec này và mọi PR Black Eye trước khi merge.
- **FR-027:** [PR1, PR2] Nguồn quyền đọc và giao bài Black Eye cho nhân sự (theo Q-9 đã duyệt: giáo viên được gán course 2 và admin có quyền cohort rõ, không admin toàn cục): PR1 chỉ `class_assignments.assigned_by = actor`, actor là admin đang active đã qua AAL2 (ADMINAAL2-0032); từ PR2 là một danh sách cấp quyền tường minh theo lớp, mặc định rỗng là từ chối; `users.role='admin'` một mình không bao giờ đủ. Danh sách cấp quyền (SA-2280-F10, điều kiện C3 (a)–(e)): (a) **ai được cấp/thu quyền chưa quyết, là câu hỏi mở CV-1 chặn PR2** (đề xuất: chỉ chủ dự án anh Vinh hoặc một vai riêng do anh chỉ định); cho tới khi anh quyết, không có đường cấp quyền nào, danh sách rỗng và mặc định từ chối, PR2 chỉ cho người tạo bài giao như PR1; không ai tự cấp quyền cho chính mình (người cấp ≠ người nhận, kiểm ở server); admin toàn cục (`users.role='admin'`) không có route nào ghi vào danh sách; (b) danh sách nằm trong DB, ở một bảng riêng theo lớp do một migration riêng tạo, chỉ ghi được qua `service_role`, không GRANT INSERT/UPDATE/DELETE cho `anon`/`authenticated`, không có RLS policy nào cho client ghi (hay đọc); (c) mỗi lần cấp hoặc thu ghi một dòng nhật ký có người cấp, người nhận, cohort, vai, thời điểm, lý do, không sửa hay xóa dòng cũ (thu quyền là dòng mới hoặc `revoked_at`), và đọc lại được để đối chiếu; (d) migration của bảng này có số do Release Manager cấp từ sổ migration, Security Auditor review SQL, anh Vinh duyệt chạy, và nằm trong `depends` của T005; (e) test: admin toàn cục tự cấp quyền cho mình (qua route cấp quyền và qua PostgREST bằng JWT `authenticated`) nhận 403/bị từ chối và không có dòng nào được ghi (đếm dòng trước/sau bằng 0), kèm test catalog chỉ đọc về grant/policy của bảng. Mọi route admin/giáo viên chung đọc `listening_test_attempts`, `class_assignment_items` hoặc snapshot (`GET /admin/listening/attempts`, `GET /admin/listening/attempts/{attempt_id}`, trang học viên admin `student_service`, tổng quan admin `admin_overview`, `cohort_progress_aggregator`, `student_work`, `assignment_tally`, `class_action_log`) phải loại attempt và test Black Eye hoặc áp đúng kiểm quyền này **trước** khi đọc; có test ma trận vai × route × kết quả (plan.md "Ma trận quyền FR-027"): không ai ngoài người được phép đọc được dữ liệu Black Eye, kể cả email, tên hay trạng thái.

## Acceptance scenarios

### Scenario 1: Danh sách Unit 1 không lộ đáp án (FR-002, FR-003, FR-013)

- **Given** dữ liệu giả có A8, A14, A19 khóa và một activity `ready`, mỗi activity có `answer_set_revision` là chuỗi sentinel
- **When** học viên giả gọi GET danh sách Unit 1
- **Then** response hợp lệ theo model học viên, A8/A14/A19 có `readiness=locked`, `selectable=false` và đúng mã lý do, và byte response cùng header không chứa sentinel, số DB hay digest của answer set

### Scenario 2: Activity thiếu audio hiện nhưng khóa (FR-003, FR-019)

- **Given** A8 (No.8 là file 0 byte) và A14 (thiếu No.14)
- **When** học viên mở danh sách Unit 1 trên màn hình, và gọi thẳng API start hoặc mở deep link
- **Then** hai activity vẫn hiện với nhãn trạng thái thiếu audio, nút "Bắt đầu" bị khóa có lý do; API start trả 422 không tạo attempt; hai activity không nằm trong mẫu số hoàn thành; đổi đuôi file hay trạng thái một mình không mở khóa

### Scenario 3: Start sai binding không thành oracle (FR-004, FR-013)

- **Given** một activity `ready` giả
- **When** học viên gửi start có `answer_set_revision` đúng sentinel, rồi gửi lại với giá trị sai
- **Then** cả hai trả 422 với status và body giống hệt nhau, không có attempt, không đọc snapshot, không ký media

### Scenario 4: Lưu và nộp ô KEEP/CHANGE không mất dữ liệu (FR-005, FR-007, FR-009)

- **Given** attempt standalone giả của A3 với ô KEEP/CHANGE
- **When** học viên lưu `CHANGE` kèm chữ sửa có dấu cách, xuống dòng và số 0 ở đầu, tải lại, nộp, nộp lại, rồi mở chữa bài
- **Then** giá trị đọc lại giống từng byte ở mọi bước, nộp lại trả cùng trạng thái, `score` và `band_estimate` là null, `objective_denominator` là 0

### Scenario 5: A13 đủ 48 ô (FR-006)

- **Given** gói giả A13 có 48 ô và một gói chung có 41 câu
- **When** chạy importer và luồng lưu/nộp/chữa
- **Then** A13 48 ô qua trong một lần nộp, 49 ô bị từ chối; gói chung 40 câu qua, 41 câu bị từ chối với thông báo cũ

### Scenario 6: Không có đường phụ trước khi nộp (FR-011)

- **Given** attempt Black Eye đang làm, standalone và (bằng fixture) được giao
- **When** gọi guided-state, reveal, check, chấm section theo content hoặc exercise, player GET, playback-started, chính tả
- **Then** mỗi route trả mã đã định (422 hoặc 503) trước mọi lần đọc `marking_rows`, transcript hay ký media, và không ghi bảng nào

### Scenario 7: Giáo viên chỉ xem được đúng bài (FR-010, FR-026, FR-027)

- **Given** bài giao giả trong cohort A do admin X tạo, học viên đã nộp; admin Y là admin toàn cục không có quyền FR-027 với cohort A; admin Z có quyền FR-027 với cohort B (từ PR2)
- **When** X, Y, Z và học viên gọi route chữa bài của giáo viên, và Y gọi `GET /admin/listening/attempts` cùng các route admin chung ở FR-027
- **Then** chỉ X nhận `BlackEyeActivityReview` không có `answer_set_revision`; Y nhận 403 ở route chữa bài và không thấy dòng Black Eye nào ở route chung; Z nhận 404; học viên bị từ chối; không ai ngoài X làm đọc dữ liệu bảo vệ

### Scenario 7b: Admin toàn cục không tự cấp quyền được (FR-027, SA-2280-F10) — PR2

- **Given** danh sách cấp quyền FR-027 rỗng; admin Y là admin toàn cục, AAL2, không có quyền FR-027 với cohort giả A
- **When** Y gọi route cấp quyền (nếu PR2 có) để tự cấp cho mình ở cohort A, và Y dùng JWT `authenticated` ghi thẳng vào bảng qua PostgREST
- **Then** cả hai bị từ chối (403 ở route), số dòng trong danh sách và nhật ký trước/sau bằng nhau (0 dòng mới), Y vẫn không thấy dữ liệu Black Eye của cohort A

### Scenario 8: Đường giao bài đóng trong PR1 (FR-012)

- **Given** code PR1
- **When** admin gọi catalog, tạo bài giao, đọc biên nhận Black Eye hoặc dùng giao bài chung với test Black Eye
- **Then** tất cả trả 503 sau kiểm quyền admin, không ghi dòng nào

### Scenario 9: Giao bài cho course 2 và theo dõi tiến độ (FR-016, FR-017, FR-018) — PR2

- **Given** lớp giả mang vai course 2 trên staging, 3 học viên giả, activity sẵn sàng giả
- **When** admin giao 2 activity, gửi lại cùng request, một học viên làm một activity và nộp
- **Then** chỉ có một bài giao, biên nhận giống nhau; bảng tiến độ hiện "đã nộp" cho đúng ô đó, "chưa bắt đầu" cho ô khác, không có điểm; tải lại trang cho cùng kết quả

### Scenario 10: Đáp án và giải thích chỉ sau khi nộp (FR-020, FR-021)

- **Given** revision giả có đáp án và giải thích đã đánh dấu nghiệm thu
- **When** học viên xem activity trước và sau khi nộp
- **Then** trước khi nộp không có đáp án, giải thích hay transcript trong bất kỳ payload nào; sau khi nộp thấy đúng activity đó, câu UNRESOLVED có ghi chú giới hạn và nhãn tự đối chiếu

### Scenario 11: Kiểm thử staging chỉ dùng dữ liệu giả (FR-024)

- **Given** một lượt QA staging cho PR2
- **When** QA ghi bằng chứng
- **Then** bằng chứng nêu id lớp giả và tài khoản giả; không có id học viên course 2 thật; không có thông báo thật nào được gửi

### Scenario 12: Bật cho học viên thật là bước riêng (FR-025)

- **Given** PR1 và PR2 đã merge vào staging
- **When** chưa có quyết định release của anh Vinh cho đúng bản release
- **Then** không có bài giao Black Eye nào cho học viên course 2 thật trên prod

## Edge cases

- Lưu tự động có ACK không có nghĩa là đã nộp; mất ACK khi nộp thì đọc lại
  trạng thái chuẩn, không đoán thành công.
- Hai lần nộp đồng thời: một lần ghi, lần kia đọc lại cùng trạng thái hoặc 409.
- Attempt hết hạn (`resume_expires_at`) hoặc không còn hoạt động: 422 "attempt
  inactive"; chính sách làm lại chờ Q-10, không ghi đè bài đã nộp.
- Snapshot thiếu hoặc lệch revision: 503 trước khi đọc dữ liệu bảo vệ.
- Catalog đổi sau khi nộp: chữa bài đọc snapshot đã đóng băng, không đọc bản
  hiện tại.
- Chỉ answer set đổi: `content_revision`, `policy_revision`, body GET công khai
  và validator cache không đổi; start với binding cũ vẫn thành công.
- Ô KEEP/CHANGE với `CHANGE` và chữ rỗng là ô chưa xong khi xác nhận nộp,
  không bị từ chối khi lưu.
- Thiếu giải thích đã duyệt: hiện "chưa có giải thích", không fallback.
- Học viên course 2 rời lớp hoặc bị lưu trữ sau khi giao: theo luật lưu trữ
  lớp/học viên hiện có (0029, 0030, 0031); PR2 phải test (xem plan.md).

## Thay đổi dữ liệu, config, migration

- PR1 tái dùng máy snapshot bất biến hiện có (`mock_paper_attempt_snapshots`,
  migration 306) và bảng `listening_test_attempts`, `listening_tests`,
  `listening_content_packages`, `class_assignments`, `class_assignment_items`.
  Không thêm bảng mới.
- `docs/proposals/blackeye-u1/admission.sql` **chỉ là đề xuất**: đổi ba CHECK
  `programme_id`, thêm trigger chặn admission và RPC `fn_acquire_blackeye_attempt`
  (service-only). Chưa chạy ở đâu, kể cả local.
- **Số migration không do spec này cấp.** Số lấy từ sổ migration của Leader /
  Release Manager (`/workspace/cc-jobs/migrations-register.md`) khi anh Vinh
  duyệt chạy (quyết định placement d9f3f92b ghi trong README đề xuất).
  Chạy migration, kể cả local, cần quyết định riêng (Handoff §5.4).
- PR2: danh sách cấp quyền FR-027 cần một bảng mới theo lớp, do một migration
  riêng tạo (số do Release Manager cấp, Security Auditor review, anh Vinh duyệt
  chạy); chỉ `service_role` ghi, không GRANT ghi cho `anon`/`authenticated`,
  không policy client. Spec này không cấp số và không viết SQL; tên bảng và
  cột chốt trong PR migration đó. Ai được cấp/thu là CV-1 (còn mở).
- Config: `DICTATION_LEXICAL_V2_ENABLED` giữ `False` trong PR1/PR2.

## API và contract

DTO chuẩn nằm ở `backend/models/listening_blackeye.py` (PR1):
`BlackEyeLearnerBinding` (7 trường), `BlackEyeRevisionBinding` (+
`answer_set_revision`, chỉ admin và nội bộ server), `BlackEyePublicItem`,
`BlackEyeActivityPublic`, `BlackEyeUnitPublic`, `BlackEyeContext`,
`BlackEyeAttemptState`, `BlackEyeInProgress`, `BlackEyeKeepChange`,
`BlackEyeReviewItem`, `BlackEyeActivityReview`, `BlackEyeSaveAck`. PR2 thêm
`BlackEyeUnitAdmin`, `BlackEyeSourceCatalog`, `BlackEyeAssignmentCreate`,
`BlackEyeAssignmentReceipt` theo S0 §3 và MV1 §3. Hợp đồng route đầy đủ ở
plan.md "Data and contracts". `frontend/types/api.d.ts` phải khớp OpenAPI
(check "api.d.ts ↔ OpenAPI drift" đang đỏ trên PR #2279, Handoff §5.2).

### Hợp đồng dữ liệu đáp án và giải thích

| Trường | Ý nghĩa | Ai thấy | Khi nào |
| --- | --- | --- | --- |
| `reference` | `null`, chuỗi, danh sách biến thể chấp nhận, hoặc `{version:'blackeye_keep_change_v1', action, correction_text}` | chủ bài, giáo viên được phép | sau khi nộp activity đó |
| `reference_provenance` | `literal_key` (theo key in), `derived` (suy từ script), `editorial` (biên tập) | như trên | như trên |
| `source_status` | `UNRESOLVED` / `CONFIRMED` / `DISAGREEMENT` (tình trạng nguồn) | như trên | như trên |
| `scoring_mode` | luôn `SELF-CHECK` trong bản này (§4.7) | như trên | như trên |
| `academic_verdict` | `CONFIRMED` / `SUSPECT` / `AMBIGUOUS` / `UNRESOLVED` (kết luận học thuật, tách khỏi tình trạng nguồn) | như trên | như trên |
| `explanation_vi` | giải thích tiếng Việt đã nghiệm thu, hoặc null | như trên | như trên |
| `limitation_vi` | ghi chú giới hạn, bắt buộc khi UNRESOLVED/DISAGREEMENT | như trên | như trên |
| `evidence_pointer` | vị trí bằng chứng (không phải trích dẫn sách) | như trên | như trên |
| transcript | các đoạn của đúng activity, không mốc thời gian | như trên | như trên |
| người viết, người nghiệm thu CM, thời điểm, tham chiếu duyệt answer set, hash duyệt | dữ liệu tác giả | chỉ nội bộ/authoring | không bao giờ ra bề mặt học viên |

Dữ liệu bảo vệ nằm trong `marking_rows[0].payload.blackeye_review` của snapshot
attempt, gắn với binding đủ 8 trường. Ghi chú mẫu từ Design §2.1a (câu chữ cuối
là lựa chọn nội dung của anh Vinh): "Chưa xác minh mục này trên trang sách gốc.
Em tự đối chiếu; mục này không được chấm điểm."

## Bảo mật, quyền và dữ liệu học viên

- **MV1 (quyết định web-security N2 = server tự resolve):** học viên không bao
  giờ nhận `answer_set_revision`, trước hay sau khi nộp. Server resolve nó lúc
  admission (bài giao: từ snapshot bài giao; standalone: từ bản published hiện
  tại) và đóng băng vào snapshot attempt. Trường này chỉ có ở catalog admin và
  bài giao/biên nhận, cho admin đúng cohort, dạng ID mờ (UUID), không phải hash,
  digest, HMAC hay mã hóa nội dung đáp án, không phải hash duyệt của anh Vinh.
  Lỗi 409/422/503 cho học viên không lặp lại revision. Luật cửa phụ: không
  `paper_revision` hay số DB nào trên bề mặt học viên đổi khi chỉ answer set
  đổi (MV1 §3). Test bắt buộc N2-T01…T12 (MV1 §5); MV1 chỉ đóng khi
  web-security chạy lại các test này trên đúng commit. **MV1 vẫn OPEN.**
- **Quyền:** học viên chỉ đọc attempt, tiến độ và chữa bài của chính mình
  (FR-026, ma trận IDOR). Nhân sự đọc hay giao bài theo đúng nguồn quyền
  FR-027: PR1 chỉ người tạo bài giao; PR2 theo danh sách cấp quyền tường minh
  của course 2 (Q-9 đã duyệt). Vai admin toàn cục một mình không đủ; route
  admin chung phải loại Black Eye hoặc kiểm FR-027 trước khi đọc. Danh sách
  cấp quyền PR2 chỉ ghi qua `service_role` (không GRANT ghi cho
  `authenticated`, không policy client), cấm tự cấp, admin toàn cục không có
  route ghi, mỗi lần cấp/thu có nhật ký đọc lại được; ai được cấp/thu là
  CV-1, còn mở, chặn PR2, mặc định từ chối (FR-027 (a)–(e)).
  Kiểm chủ/cohort/bài giao/item/nộp/revision **trước** khi đọc
  dữ liệu bảo vệ hoặc ký media (S0 N6).
- **Dữ liệu bảo vệ:** chỉ server-side, qua service role; RLS và quyền trên
  attempt/snapshot giữ như migration 306. Không ẩn bằng CSS.
- **PostgREST/Realtime:** bề mặt học viên gồm cả đọc trực tiếp bằng JWT học
  viên. Bất biến: không có policy cho `anon`/`authenticated` trên
  `listening_tests`, `listening_content_packages`,
  `mock_paper_attempt_snapshots` và view `listening_public_practice_catalog`;
  `answer_set_revision` (nằm trong `listening_tests.metadata.blackeye.binding`)
  không nằm ở cột nào client đọc được; `paper_revision`/`policy_revision` trên
  `listening_test_attempts` không đổi khi chỉ answer set đổi. Test catalog chỉ
  đọc (`pg_policies`, grant bảng/cột) khóa các bất biến này. Thu hồi GRANT
  SELECT thừa của `anon`/`authenticated` trên `listening_tests` ảnh hưởng mọi bài
  Listening, nên là migration riêng cần Security Auditor và anh Vinh duyệt.
- **Hàm/trigger `SECURITY DEFINER` của Black Eye** (gồm RPC
  `fn_acquire_blackeye_attempt` và trigger admission đề xuất): `SET search_path
  = pg_catalog, pg_temp`, mọi bảng ghi `public.`, hàm catalog ghi
  `pg_catalog.`; `REVOKE ALL … FROM PUBLIC, anon, authenticated`; chỉ `GRANT
  EXECUTE … TO service_role`; test tĩnh
  (`backend/tests/test_blackeye_admission_proposal_static.py`) khóa các điều này.
- **Cache:** mọi response Black Eye `private, no-store`.
- **Log/PII:** không đưa câu trả lời, đáp án, giải thích, transcript, email,
  tên hay `user_id` thô của học viên vào **bất kỳ** nơi ghi nào: logging Python
  mọi mức, bảng `error_logs` (handler lỗi backend và `POST /api/error-logs` từ
  frontend), Sentry (message, exception, breadcrumb, extra), access log/URL
  (câu trả lời chỉ đi trong body PATCH, không trong query). Riêng `user_id`
  (SA-2280-F11): được phép ở cột có cấu trúc `error_logs.user_id` như hiện có
  (handler lỗi backend, `POST /api/error-logs`; chỉ admin đọc); cấm trong
  `error_logs.message`, `error_logs.stack`, URL/query, log text và Sentry.
  Exception trong code
  Black Eye chỉ mang mã lỗi và id mờ, không mang giá trị. Cấu hình Sentry hiện
  có (`send_default_pii=False`, `include_local_variables=False`,
  `max_request_body_size="never"`, `before_send`) phải giữ. Test sentinel ở
  FR-026.
- **Security Auditor (bắt buộc; Leader yêu cầu khi chuyển t1600u, anh Vinh duyệt
  cùng spec ở t1601s5314):** review spec này trước khi duyệt, và
  review mọi PR Black Eye (PR1, PR2, PR3+, PR migration) trước khi merge: RLS và
  quyền, dữ liệu tiến độ và bài làm, chỉ giáo viên/admin course 2 xem được,
  học viên chỉ thấy dữ liệu mình, log/PII. Đây là cổng review riêng, không thay
  web-reviewer hay Code Reviewer.
- Thông báo và đồng ý của học viên thật: đã quyết theo Q-13 (t1601s5314):
  không gửi thông báo tự động, giáo viên course 2 báo lớp theo cách hiện có,
  không cần đồng ý riêng ngoài điều khoản hiện tại, dữ liệu chỉ dùng cho học
  tập trong lớp. Lưu giữ dữ liệu: đã quyết theo Q-14: như các bài Listening
  khác, không xóa tự động, xóa theo luật lưu trữ học viên hiện có (0029).

## Rủi ro

| Rủi ro | Ảnh hưởng | Giảm thiểu |
| --- | --- | --- |
| Lộ đáp án trước khi nộp | Bài tập vô nghĩa với học viên thật | Allowlist dương, DTO strict, N2-T01…T12, test HTML/SSR ở PR2 |
| Oracle qua `answer_set_revision` | Đoán được key | Server resolve, 422 giống hệt, ID mờ |
| Commit PR #2279 có trước khi spec được duyệt | Validator vẫn đỏ sau khi spec merge | Q-5 |
| File ngoài FR trong PR1 (`evidence/`, `handoffs/`) | Validator báo path không có FR sở hữu | Q-6 |
| Audio thiếu/hỏng | Không mở được A8/A14 | Khóa có nhãn; Q-4 |
| Đáp án UNRESOLVED | Học viên hiểu sai | Tự đối chiếu, ghi chú giới hạn; Q-1 |
| Dữ liệu học viên thật | Lộ dữ liệu cá nhân | Security Auditor mọi PR, FR-026, staging chỉ dữ liệu giả |
| Hết hạn quyền đọc nguồn PDF 30/11/2026 | Dừng viết nội dung | Q-15 |
| Migration chưa chạy | Start luôn 503, PR2 không test end-to-end được | Q-12 |

## Phụ thuộc

- Migration admission (đề xuất) được anh Vinh duyệt chạy, Release Manager cấp
  số, Security Auditor review SQL (Q-12).
- Migration danh sách cấp quyền FR-027 (Release Manager cấp số, Security
  Auditor review, anh Vinh duyệt chạy) và câu trả lời CV-1, trước PR2 (T005).
- Player/playback DTO (đề xuất R1) được web-security reconcile trước PR2
  (Q-11).
- Gói nội dung đã nghiệm thu (T011, T012) và danh sách audio đã duyệt (§4.11).
- Release 0011 v2 và gold FR-007 cho chính tả (FR-023, Q-2).
- Cổng review: web-reviewer / Code Reviewer trên đúng head; **Security
  Auditor** trên spec và mọi PR; web-qa cho MV2/AC02; CM nghiệm thu học thuật
  nội dung.
- Spec liên quan: LISTENING-0005, 0006, 0007, LISTENING80-0009,
  DICTATIONTOKEN-0011, GRAMMARLESSON-0017, MASTER30FULL-0018, 0029–0031 (lưu
  trữ học viên/lớp), ADMINSIMPLE-0049 (luồng giao bài, PR #2254 chưa merge).

## Ranh giới PR1 / PR2

| Hạng mục | PR1 (#2279) | PR2 | PR3+ / release |
| --- | --- | --- | --- |
| Định danh, DTO strict | Có | Thêm DTO admin | — |
| Danh sách Unit 1 học viên | Backend | UI | — |
| Start/save/submit standalone | Có (cần migration) | — | — |
| Start/save/submit được giao | Đóng 503 | Mở | — |
| Chữa bài chủ bài | Backend | UI | Nội dung thật |
| Chữa bài giáo viên | Backend, chỉ người tạo | UI, mở rộng (Q-9) | — |
| Catalog, giao bài, biên nhận | Đóng 503 | Có | — |
| Tiến độ | — | Có | — |
| Player/playback | 503 tạm | DTO dương (Q-11) | — |
| Tải gói nội dung ở admin | — | — | PR3 (Q-8) |
| Đáp án/giải thích thật | Chỉ đường đọc | — | Giai đoạn nội dung |
| Chính tả Black Eye | Khóa 422 | Card khóa | PR riêng (Q-2) |
| Học viên thật course 2 trên prod | — | — | Release riêng (T014) |

## Success criteria

- Check "Spec and PR metadata" xanh trên PR1 sau khi spec này được merge ở
  trạng thái `approved` và PR1 được dựng lại theo Q-5.
- N2-T01…T12 pass trên đúng commit PR1 và web-security đóng MV1 cho N2.
- 0 byte đáp án, giải thích, transcript hay sentinel answer-set trong mọi
  payload học viên trước khi nộp (test PR1 + test HTML/SSR PR2).
- Importer chung: 40 qua / 41 từ chối; Black Eye: 48 qua / 49 từ chối.
- Bảng tiến độ khớp dữ liệu đã lưu sau tải lại trong 100% case test PR2.
- Không có dữ liệu học viên thật trong bằng chứng staging; không có bài giao
  Black Eye cho học viên thật trước quyết định release.

## Open questions

- Q-1 đến Q-16 đã được anh Vinh quyết ngày 10/11/2026 (mục "Quyết định của
  anh Vinh (10/11/2026)" bên dưới); không đổi.
- **CV-1. Ai được cấp và thu quyền FR-027 cho course 2 (từ PR2)?** Còn mở,
  **chặn PR2 (T005)**. **Đề xuất:** chỉ chủ dự án (anh Vinh) hoặc một vai riêng
  do anh chỉ định; người nhận không tự cấp cho mình; admin toàn cục không có
  route ghi. **Lý do:** nếu admin toàn cục nào cũng tự cấp được thì luật "không
  bypass admin toàn cục" (Q-9) chỉ còn là thêm một cú bấm (SA-2280-F10). Câu
  này không đổi Q-9 (Q-9 quyết *ai xem được*; CV-1 hỏi *ai cấp quyền xem*).
  Cho tới khi anh trả lời: mặc định từ chối, danh sách rỗng, không có đường
  cấp quyền, PR2 chỉ người tạo bài giao. Leader hỏi anh.

## Câu hỏi cho anh Vinh

- **Q-1. Câu UNRESOLVED chấm thế nào?** Quyết định cũ §4.7: chỉ tự đối chiếu,
  không tính điểm. Có giữ cho bản giao course 2 không? **Đề xuất:** giữ. **Lý
  do:** bên PDF chưa xác nhận trang gốc câu nào; chấm tự động trên key chưa chắc
  sẽ cho học viên thật điểm sai. Một câu chỉ chuyển sang chấm khi có xác nhận
  trang gốc và anh duyệt answer set.
- **Q-2. Xác nhận thay đổi quyết định chính tả (D-3).** t1597u đưa chính tả vào
  phạm vi, thay §4.3. **Đề xuất:** duyệt "chính tả trong phạm vi spec, làm ở PR
  riêng sau PR2; chỉ bật cho học viên khi release 0011 v2
  (`DICTATION_LEXICAL_V2_ENABLED`) được duyệt và có gold FR-007 do hai người
  kiểm học thuật"; tới lúc đó card hiện khóa. **Lý do:** đường chính tả cũ
  không có version/hash tham chiếu, bật vội sẽ cho học viên thật điểm chính tả
  không ổn định và không sửa lại được lịch sử.
- **Q-3. Ai viết và ai duyệt nội dung (D-4).** §4.9: web-content viết, anh kiểm
  học thuật và duyệt đáp án. t1597u: Claude/Codex viết, CM nghiệm thu.
  **Đề xuất:** Claude/Codex viết (T011), CM nghiệm thu học thuật từng câu, anh
  Vinh vẫn duyệt answer set cuối trước khi publish. **Lý do:** giữ một người
  chịu trách nhiệm cuối cho đáp án học viên thật thấy, và tách người viết khỏi
  người kiểm.
- **Q-4. Audio: upload và file thiếu.** §4.11 chỉ cho upload staging riêng tư
  khi anh duyệt đúng danh sách. No.14 thiếu, No.8 là 0 byte. **Đề xuất:** giữ
  §4.11; anh duyệt danh sách 18 file đã đo và chốt các mục §7.1–§7.5 của kế
  hoạch upload; A8/A14 khóa đến khi có file thay đã kiểm. **Lý do:** đây là
  cổng duy nhất ngăn upload sai file.
- **Q-5. PR #2279 và luật "commit sau khi spec duyệt".** Validator kiểm mỗi
  commit code phải là hậu duệ của commit duyệt spec. Cả ba commit hiện có
  (`ea6add01e`, `66d351ce9`, `3a7d494e2`) có trước, nên check vẫn đỏ dù spec đã
  merge. Rebase cùng nhánh cần force push, Tier-1 cấm. **Đề xuất:** sau khi spec
  merge, dựng nhánh mới từ `staging` (ví dụ `blackeye-u1-pr1b`), áp cùng nội
  dung thành commit mới (gồm bản sửa CI của cx-1vr), mở PR mới; Leader xin anh
  đóng hoặc chuyển draft #2279. **Lý do:** không force push, không sửa
  validator, giữ lịch sử review cũ để đối chiếu.
- **Q-6. File không thuộc FR nào trong PR1.** `evidence/blackeye-u1-s0/*` (3
  file) và `handoffs/LISTENING-BLACKEYE-V5-UNIT1-S0-FINDINGS-20261110.md` không
  phải code sản phẩm; validator đòi mọi path có FR sở hữu. **Đề xuất:** bỏ khỏi
  PR mới, giữ ở thư mục team (S0 N3 đã nêu). **Lý do:** tránh FR giả chỉ để sở
  hữu tài liệu, và tránh repo chứa recorder tự ghi đè.
- **Q-7. Xác nhận ranh giới PR2 (uid d461e884).** Body PR #2279 và SQL đề xuất
  trích quyết định của anh "catalog/create/receipt và T09/T10 sang PR2", nhưng
  văn bản quyết định này không có trong bộ nguồn FD nhận. **Đề xuất:** xác nhận
  như spec ghi. **Lý do:** FD không tự coi một quyết định chưa đọc nguyên văn là
  đã chốt.
- **Q-8. "Tải lên ở trang admin" làm thế nào?** **Đề xuất:** PR3 thêm trang tải
  gói chỉ chạy kiểm tra và lưu bản nháp; publish cần CM nghiệm thu và anh duyệt
  answer set; bản đầu có thể do Release Manager nhập bằng importer hiện có dưới
  quyết định riêng. **Lý do:** tải lên trực tiếp mà publish ngay sẽ đưa nội dung
  chưa kiểm tới học viên thật.
- **Q-9. Ai xem được dữ liệu học viên course 2?** PR1 chỉ cho người tạo bài
  giao. **Đề xuất:** PR2 mở cho giáo viên được gán vào course 2 và admin có
  quyền cohort rõ, không mở cho admin toàn cục mặc định. **Lý do:** tối thiểu
  quyền với dữ liệu học viên thật; Security Auditor review.
- **Q-10. Attempt hết hạn: làm lại thế nào?** PR1 tạm từ chối (422). **Đề xuất:**
  cho mở attempt mới không ghi đè bài đã nộp; bài chưa nộp đã hết hạn giữ
  nguyên để giáo viên thấy "quá hạn". **Lý do:** học viên thật cần làm lại khi
  mất phiên, nhưng lịch sử nộp không được đổi.
- **Q-11. Player/playback cho Black Eye.** PR1 trả 503 tạm (O6). **Đề xuất:**
  đưa DTO player dương (đề xuất R1) vào PR2 sau khi web-security reconcile theo
  MV1 §3. **Lý do:** không có player thì học viên không nghe được, PR2 không có
  luồng thật.
- **Q-12. Migration admission.** **Đề xuất:** Security Auditor review
  `admission.sql`, Release Manager cấp số từ sổ migration, anh duyệt chạy trên
  staging trước khi test PR2. **Lý do:** không có RPC thì mọi start Black Eye
  là 503.
- **Q-13. Thông báo và đồng ý của học viên thật.** **Đề xuất:** không gửi thông
  báo tự động; giáo viên course 2 báo lớp theo cách hiện có; không cần đồng ý
  riêng ngoài điều khoản hiện tại nếu anh xác nhận dữ liệu chỉ dùng cho học
  tập trong lớp. **Lý do:** tránh thông báo sai khi bài chưa sẵn sàng; đồng ý
  là quyết định pháp lý của anh.
- **Q-14. Lưu giữ dữ liệu bài làm.** **Đề xuất:** giữ như các bài Listening
  khác (không xóa tự động), xóa theo luật lưu trữ học viên hiện có (0029).
  **Lý do:** đồng nhất với dữ liệu học viên hiện có, không tạo luật mới.
- **Q-15. Quyền đọc nguồn PDF hết hạn 30/11/2026.** **Đề xuất:** anh gia hạn
  qua doc-leader trước khi T011 bắt đầu nếu việc viết kéo qua 30/11. **Lý do:**
  người viết cần đọc nguồn để viết giải thích; hết hạn thì phải dừng.
- **Q-16. Giá trị mặc định `replay_policy` khi giao bài.** S0 có `allowed` và
  `once` nhưng chưa định nghĩa đầy đủ. **Đề xuất:** `allowed` cho bài luyện, và
  ghi định nghĩa chính xác trong PR2. **Lý do:** đây là bài tập, không phải bài
  thi; nhưng FD không tự chốt nghĩa của trường.

### Quyết định của anh Vinh (10/11/2026)

Widget t1601s5314, 17:50 ngày 10/11/2026 (Asia/Saigon), nguyên văn: "Duyệt
spec 0052 và Q-1..Q-16 theo đề xuất; FD mở PR spec".

- Q-1 đến Q-16: duyệt **theo đề xuất** ghi ở từng câu phía trên.
- Không thuộc quyết định này: merge PR spec vào `staging` (cần duyệt merge
  riêng), chạy bất kỳ migration nào (đường Q-12), production, và giao bài cho
  học viên thật course 2 (T014).

## Changelog

- 10/11/2026 17:17–17:40 (UTC+7), FD: bản nháp đầu theo BLACKEYE-U1-SPEC
  (Leader), nguồn Handoff t1594u và 8 tài liệu t1596u; FR-001…FR-015 khớp PR
  #2279 head `3a7d494e2`.
- 10/11/2026, t1597u (anh Vinh qua Leader, 17:18): thêm luồng tải lên/giao bài
  và tiến độ, hợp đồng đáp án/giải thích, chính tả trong phạm vi (thay đổi
  §4.3), activity thiếu audio, task viết nội dung; FR-016…FR-023.
- 10/11/2026, t1598u: lớp nhận bài là **course 2** (sửa tên lớp nêu ở t1597u).
- 10/11/2026, t1600u: course 2 có học viên thật; đối tượng prod là học viên
  thật (thay đổi §4.10 cho prod); staging chỉ dữ liệu giả (FR-024); release thật
  là bước riêng (FR-025); Security Auditor bắt buộc (FR-026). Bỏ câu hỏi "lớp
  có học viên thật không", đánh số lại Q-n.
- 10/11/2026, t1599u (17:20): ghi D-5, chủ dự án quyết định không xử lý bản
  quyền sách/audio Black Eye; bỏ câu hỏi bản quyền và mọi điều kiện chờ xác
  nhận bản quyền; đánh số lại Q-1…Q-16.
- 10/11/2026 17:50 (Asia/Saigon), t1601s5314: anh Vinh duyệt spec và Q-1..Q-16
  theo đề xuất; status draft → approved; thêm `approval-decision.md`. Không đổi
  phạm vi hay FR.
- 10/11/2026, R2 theo SA-2280-R1 (Security Auditor, head
  343ef6e60) và CR P3 (reviews/PR-2280.md): thêm FR-027 nguồn quyền nhân sự và
  route admin chung (F01); log/PII mọi nơi ghi (F02); ma trận IDOR, FR-005 chỉ
  chủ, FR-009 khác chủ 404 (F03); FR-011 deny-by-default và kiểm kê route
  (F04); bất biến PostgREST (F05); `search_path = pg_catalog, pg_temp` (F06);
  route chung bù người nhận/trạng thái/hạn/xóa/trả bài, giáo viên chỉ đọc
  (F07); điều kiện T014 (F08); FR-013 và FR-016 thống nhất bề mặt (F09); ghi
  Q-13/Q-14 đã quyết; sửa nguồn câu "không hạ loại PR" và cổng Security
  Auditor (CR P3). Không đổi quyết định Q-1..Q-16.
- 10/11/2026, R3 theo SA-2280-R2 (Security Auditor, head 331c8c81e, F10, F11,
  điều kiện C3 (a)–(e)) và quyết định CR sửa ngay trong spec (gates/verdicts/
  2280.txt sha256 fa141e5293d4): FR-027 thêm luật danh sách cấp quyền PR2 (chỉ
  `service_role` ghi, không GRANT ghi cho `authenticated`, không policy client,
  cấm tự cấp, admin toàn cục không có route ghi, nhật ký cấp/thu đọc lại được,
  test tự cấp → 403 và 0 dòng) và Scenario 7b; ghi CV-1 (ai cấp/thu quyền) là
  câu hỏi mở chặn PR2, mặc định từ chối; T005 phụ thuộc migration danh sách
  (RM cấp số, SA review, anh Vinh duyệt chạy), C3 và CV-1 (F10); `user_id` chỉ
  ở cột `error_logs.user_id`, cấm trong message, stack, URL, log và Sentry
  (F11). Không đổi quyết định Q-1..Q-16 hay D-1..D-5, không mở rộng phạm vi.

- 2026-11-11 (Leader decision, CR #2281 R1 P2-4): FR-015/T004 amended: proposal SQL lands in PR1 as numbered migration 376 marked pending_feature in forward-policy.tsv, merged unexecuted (No apply on merge). T004 = SA SQL review + anh Vinh run approval; staging first, production only at T014.

- 13/11/2026, C8 / CR P2-R9-1: ghi changelog v2 được anh Vinh duyệt qua
  **t1803u** (12/11/2026 23:59 Asia/Saigon), theo
  `handoff/leader/spec-0052-changelog-DRAFT-v2.md`, SHA256
  `85aeb7c8fbe98383ae57a1b086b3f2af52170ebd0f64c61a18be3429288f25eb`.
  Phê duyệt chỉ cho changelog C8; không phải phê duyệt merge, migration,
  seed/import hay production. Không đổi định nghĩa Black Eye.

  - FR-011 / plan.md “Kiểm kê route”: giữ trong #2281 các guard theo identity/by-id (bao gồm provenance, frozen attempt identity, session external identity, đường học viên C3) và toàn bộ inventory tests đang có. Chuyển phần loại Black Eye khỏi danh sách, phân trang, đếm và tổng hợp còn lại sang FU-2281-NAMESPACE. Bao gồm P2-R8-2: predicate trong SQL page/count, không hydrate toàn thư viện.
  - FR-027 / plan.md “Ma trận quyền FR-027”: giữ mọi bảo vệ theo id đã có trong PR1. Chuyển exclusion danh sách/tổng hợp của các route admin chung còn thiếu sang FU-2281-NAMESPACE. Không thay đổi ai được quyền, không coi admin toàn cục là đủ quyền, không cấp/thu quyền trong PR1. Metadata/tên/trạng thái vẫn được bảo vệ theo spec sau follow-up.
  - FR-012 vẫn thuộc #2281: mọi đường gắn listening_test_id Black Eye vào mock exam create/update phải 503 qua assignment_seam (hoặc 404 deny), trước mọi ghi. Chỉ picker list chuyển sang follow-up.
  - FU-2281-NAMESPACE gồm M-A, M-B, helper chung và inventory/list/aggregate call sites; không thêm vào #2281. Các đường theo id mới không có trong allowlist FR-011 không được trì hoãn theo thay đổi này.

  - Bổ sung v2 (theo SA-2281-R12k-DELTA-8434cf28): route admin GET /admin/listening/content (backend/routers/listening.py:1619) — exclude_tests đang giữ dòng test_id NULL có marker metadata.blackeye hoặc dẫn xuất qua source_test_id/parent_content_id — được ghi nhận rõ là thuộc FU-2281-NAMESPACE (Codex thread PRRT_kwDOR6Uds862sorH). Trên staging hiện 0 dòng như vậy và chưa có đường app tạo được trước M-A; không áp 376/không import Black Eye cho tới khi FU xong.

  `plan.md` ghi nhận phân tách FR-011/FR-027 ở trên; `rollout.md` bổ sung
  Preconditions và cổng importer đúng bản v2 đã duyệt. Trước merge vẫn cần CI,
  CR, SA delta và Codex trên đúng head mới; anh Vinh tự gõ duyệt merge cho đúng
  SHA. Changelog này không phải SA-MET và không thay thế các điều kiện đó.
