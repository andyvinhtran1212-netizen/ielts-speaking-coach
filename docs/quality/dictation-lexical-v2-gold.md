# Lexical-v2: bộ mẫu đối chiếu ngoại tuyến

Spec đã duyệt trên base `9e548f3d913ffaa6877f6427ce0abd5725164026`. Root và hội đồng kỹ thuật đã duyệt độc lập toàn bộ 53 nhãn; the independent final review ghi nhận phê duyệt lại theo đúng hash hiện tại sau kiểm tra Python 3.11/3.12. Kết quả chạy dưới đây đối chiếu các nhãn đã duyệt.

Có 53 trường hợp: 49 grade hợp lệ và 4 nguồn không có từ lexical phải bị từ chối. Bốn mẫu production đã đổi tên riêng nhất quán và bỏ toàn bộ định danh học viên/session. Không kiểm chứng audio ở bước này. Trường hợp nguồn thiếu số điện thoại không được suy diễn thành đáp án hoặc dùng làm gold.

| Mẫu đã ẩn danh | Cũ: đúng/tổng | Điểm cũ | Mới: đúng/tổng | Điểm mới |
| --- | ---: | ---: | ---: | ---: |
| P01 | 12/13 | 0.9231 | 12/12 | 1.0000 |
| P02 | 13/14 | 0.9286 | 13/13 | 1.0000 |
| P03 | 11/12 | 0.9167 | 11/11 | 1.0000 |
| P04 | 10/12 | 0.8333 | 10/10 | 1.0000 |

P04 giữ một extra lexical `one` trong diff; điểm 1.0 giữ nguyên quy tắc hiện tại không phạt extra, không xóa lỗi đó. Trung bình của hai nhóm mẫu chọn lọc: cũ 0.9059, mới 1.0000. Đây là nhóm câu chọn lọc, **không phải** toàn bộ session gốc hay điểm sửa của 303 session.

Đối chiếu mọi nhãn: 0 sai lệch; đối chiếu 9 mẫu không chứa shell/dash cần tách: 0 thay đổi ngoài ý muốn. Nhãn miss/wrong/extra/forgiven không khai báo có nghĩa là 0; mọi grade hợp lệ đều được kiểm đủ các count. Có 28 mẫu đổi điểm, 14 mẫu đổi denominator, 31 mẫu đổi diff. Không ghi DB hoặc đổi caller legacy.

[JSON kèm](dictation-lexical-v2-gold.json) có toàn bộ ops cũ/mới, exhaustive raw segments, half-open offsets và ambiguity flags. Mỗi lexical segment xuất hiện đúng một lần trong diff ở mỗi phía; ghép toàn bộ segments khôi phục nguyên văn. Offsets là Python Unicode codepoint, không phải UTF-16 JavaScript. Dấu ngoặc nội từ trong `“foo(bar)”` được giữ trong lexical word, còn outer quote không tạo lỗi; `pre(hello)post` không được nới thành `prehellopost`. Ambiguous quote/crossed bracket, mixed elision và triple single-quote/possessive giữ baseline và cờ author review. A44–46 do reviewer độc lập phát hiện, ngăn quote đóng sớm làm mất plural-possessive apostrophe. A26 giữ cả tie-breaking LCS legacy: 1 miss/2 wrong/1 extra, không sửa thuật toán alignment trong scope này.

Kiểm tra cuối theo đúng hash: `dictation-unicode-pinned-shells-wire-gold.log` có 138 passed, 9 warnings; kiểm tra độc lập `admin-dictation-305-unicode-final.log` có 127 passed, 8 warnings, không skip. Các suite có phần giao nhau nên không cộng hai số này. Tích hợp version/frozen reference, UI và rollout theo FR003–010 vẫn phải có bằng chứng riêng; phép đối chiếu ngoại tuyến này không xác nhận triển khai hay sửa điểm lịch sử.

Fixture SHA-256: `37b513b4cc9a8af864b0c2bfd64bafada5ab702b1781d9823611de50aab621e2`.


## Reproduction and release boundary

The checked-in `backend/tests/fixtures/dictation_lexical_gold.json` contains the
independently approved labels. Run `python -m pytest tests/test_dictation_lexical_policy.py tests/test_dictation_unicode_policy.py -q` from backend with its configured environment. The report JSON records complete old/new results and exact input hashes. Reviewers were root and the engineering council; no human IELTS rater evaluation or paid model call is claimed by this deterministic token-policy report.

The final affected backend gate passed370 tests with9 warnings, including the
configured real PostgreSQL identity/policy tests. Independent testing also ran
actual Python3.11/UCD14 and Python3.12/UCD15 and confirmed identical v2 grades for
all53 gold cases and10 adversarial span/ambiguity cases. Unicode15 lexical and
combining classification are pinned in one immutable module and lexical ranges
are also pinned in the private SQL helper; native runtime Unicode changes cannot
silently change this policy. These suites overlap and their counts are not added.

Historical repair decision: disabled. The selected comparison is not a complete
303-session dry-run and gives no authorization to repair any original record.
Missing frozen evidence stays unknown/unrepairable. No repair endpoint, automatic
migration regrade or generic repair platform is included. An eventual repair needs
a separately reviewed bounded dry-run, explicit authorization and staging restore
proof. Classification-only/default legacy behavior remains available while
DICTATION_LEXICAL_V2_ENABLED defaults to false.

Exact-SHA staging migrations, live deployed contracts, enabled version scope,
production promotion and rollback observation remain PENDING. Local results and
this report do not close those release gates.
