# Thứ tự merge các PR đang mở vào staging (25/11/2026)

Soạn bởi RM sau promote phương án A (#2672). **Đây chỉ là đề xuất thứ tự. Không PR nào được merge khi anh Andy chưa gõ `merge #N`.** Từ 25/11 04:30Z, lời duyệt "merge theo lô" đã thu hồi, và staging đóng merge cho tới khi anh mở lại.

Số liệu lấy từ GitHub lúc ~05:00Z: 121 PR mở (không tính #2450 nháp và #2672 promote). Trong đó 48 PR xếp chồng theo base, thêm 2 chuỗi xếp chồng theo nội dung (LEGACYJS, FR-010). Trạng thái thay đổi liên tục, nên trước mỗi lần merge phải chạy lại cổng.

## Nguyên tắc gom lô

- **L0:** đã qua CR ở head hiện tại và chờ staging mở lại. Rủi ro thấp nhất.
- **L1:** chỉ sửa docs/spec, đứng riêng, không có migration.
- **L2:** có sửa code, không migration, đứng riêng. Merge từng PR một và chờ staging smoke giữa các PR.
- **L3:** có migration. Mỗi PR cần SA, và cần anh Andy gõ duyệt áp migration trên staging trước khi merge code dùng tới nó.
- **L4:** chuỗi xếp chồng. Merge từ gốc lên ngọn. Sau mỗi tầng, tầng kế tiếp phải merge staging vào, CR delta lại, chờ CI xanh rồi mới merge.
- PR có `dirty` (xung đột) hoặc base cũ: chủ PR merge staging vào hoặc đổi base trước. Không rebase, không force-push.
- Cổng của từng PR: CR ở head, check bắt buộc xanh, 0 thread mở, không có HOLD của Andy, mergeable clean/unstable. Thêm điều kiện: anh Andy gõ `merge #N`.

## L0: đã CR, chờ staging mở (3 PR)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2536 LIBRARY-0061 G06-T13 follow-up: "Bỏ …" suggestions on an emp | staging | clean; CI xanh; thread mở 0 | BE+FE 7f +104/−4 | CR duyệt @40d9fba6, CI xanh |
| #2629 G10-T07-W3a: retire the users/codes scripts (LEGACYJS-0075 T | gốc chuỗi LEGACYJS | clean; CI xanh; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 24f +264/−1382 | CR duyệt @a2870e4a; Andy gỡ HOLD khi CI xanh; chỉ merge khi anh gõ duyệt riêng `merge #2629`; sau merge DỪNG cho tới khi có nghiệm thu W3a trên staging (xem chuỗi LEGACYJS) |
| #2650 spec(0072 T005, R152): independent review evidence for the S | claude/examspeak-0072-spec | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 1f +43/−14 | CR delta duyệt @321684a6 (docs); base `claude/examspeak-0072-spec` đã merge/cũ → đổi base sang staging; xung đột → merge staging vào |

## L1: docs/spec đứng riêng (10 PR)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2475 [Đợt A · chờ Andy merge] G01-T09: đóng băng TECH_DEBT.md, sp | staging | blocked; CI đỏ/chờ: Backend pytest shard 1/4, Backend pytest shard 2/4…; thread mở 0 | docs 2f +9/−7 |  |
| #2481 specs: LEARNERCORE-0063 amendment 1, course path and practic | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 40f +3280/−0 |  |
| #2482 specs: LEARNERCORE-0063 amendment 2, account pages, first vi | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 40f +3395/−0 |  |
| #2483 spec(G12-C01): SCOREPAIR-0102 lưu cặp điểm AI–giáo viên Writ | staging | NHÁP; blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 11f +618/−13 |  |
| #2484 specs: LEARNERCORE-0063 amendment 3, assigned work page and  | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 40f +3455/−0 |  |
| #2608 spec(EXAMREAD-0067): readiness-review wording fixes into #24 | claude/examread-0067-spec | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 2f +26/−12 | base `claude/examread-0067-spec` đã merge/cũ → đổi base sang staging |
| #2609 spec(EXAMWRITE-0068): readiness-review fixes into #2500 | claude/examwrite-0068-spec | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 2f +23/−6 | base `claude/examwrite-0068-spec` đã merge/cũ → đổi base sang staging |
| #2639 docs(specs/0070): ghi kết quả review độc lập T006 lần 1 | claude/examlistent-0070-spec | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 1f +24/−0 | base `claude/examlistent-0070-spec` đã merge/cũ → đổi base sang staging |
| #2662 spec(0073 T004): independent review evidence for the drill r | claude/project-thread-97v4ag-g08-t20 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 1f +30/−16 | base `claude/project-thread-97v4ag-g08-t20` đã merge/cũ → đổi base sang staging |
| #2667 docs(commercialization): MERGE-LOTS-20261123 bảng lô merge c | staging | clean; CI xanh; thread mở 0 | docs 1f +1319/−0 |  |

## L2: code không migration, đứng riêng (28 PR)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2473 [Đợt A · chờ Andy merge] G02-T06: kết quả chương trình Liste | staging | blocked; CI đỏ/chờ: Backend pytest shard 1/4, Backend pytest shard 2/4…; thread mở 0 | +FE 2f +53/−2 |  |
| #2474 [Đợt A · chờ Andy merge] G02-T07: Quick Check mở lại ghi "Lư | staging | blocked; CI đỏ/chờ: Backend pytest shard 1/4, Backend pytest shard 2/4…; thread mở 0 | +FE 3f +70/−3 |  |
| #2486 feat(enroll): VietQR payload builder (G05-T11) | staging | NHÁP; blocked; CI đỏ/chờ: Spec and PR metadata; thread mở 0 | BE 2f +225/−0 |  |
| #2517 EXAMROOM-0066 T003 (G08-T04): shared exam-room question type | staging | NHÁP; blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 48f +4506/−2 |  |
| #2542 feat(G08-T14): Listening exam-room audio policy and submit o | staging | NHÁP; blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 32f +3542/−2 |  |
| #2543 feat(G07-T14): new Today page at /home behind learner_v2 | claude/project-thread-94m6ux-g07-t13 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 24f +2185/−118 | base `claude/project-thread-94m6ux-g07-t13` đã merge/cũ → đổi base sang staging |
| #2549 feat(listening): abandon route for a self-selected Listening | claude/examlistent-0070-spec | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 5f +436/−2 | base `claude/examlistent-0070-spec` đã merge/cũ → đổi base sang staging |
| #2550 COURSEACCESS-0055 T010: thời hạn xem nội dung theo quyền học | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 42f +7816/−385 |  |
| #2669 ADMINIA-0074 G09-T38 backend: GET /admin/speaking/mock-queue | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 6f +659/−0 |  |
| #2499 UIBASE-0056 G03-T09: BandScore, Timer, QuestionPalette, Voca | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 19f +1551/−1 | xung đột → merge staging vào |
| #2503 G06-T11: Kiến thức Writing trong Thư viện công khai | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 19f +1869/−12 | xung đột → merge staging vào |
| #2538 EXAMLISTENP-0069 T001 (G08-T11): move the legacy Listening p | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 100f +9912/−15 | xung đột → merge staging vào |
| #2540 EXAMMOCK-0071 T001 (G08-T16): mockSubmitOutcome and reconcil | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 65f +6242/−2 | xung đột → merge staging vào |
| #2546 LIBRARY-0061 G06-T16: "Của bạn" column on the Writing sample | staging | dirty; CI xanh; thread mở 0 | BE+FE 12f +1188/−10 | xung đột → merge staging vào |
| #2551 EXAMMOCK-0071 T002 part A (G08-T16): mock runner in the shar | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 87f +8982/−23 | xung đột → merge staging vào |
| #2553 G10-T15-3: move grammar and vocab admin groups under (authed | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 155f +499/−509 | xung đột → merge staging vào |
| #2555 EXAMMOCK-0071 T002 part B (G08-T16): mock Writing room, acco | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 89f +9761/−40 | xung đột → merge staging vào |
| #2557 feat(G08-T14): Listening test in the exam room behind a flag | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 116f +11697/−40 | xung đột → merge staging vào |
| #2558 EXAMLISTENP-0069 T002 (G08-T11): exam-room branch of the Lis | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 107f +11005/−82 | xung đột → merge staging vào |
| #2567 G10-T15-4: move the speaking admin groups under (authed-admi | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 173f +583/−586 | xung đột → merge staging vào |
| #2575 EXAMMOCK-0071 T003 (G08-T16): flag-on steps in the mock exam | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 90f +9865/−42 | xung đột → merge staging vào |
| #2584 test(G08-T14): Listening journeys with the exam room on (007 | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 118f +11832/−52 | xung đột → merge staging vào |
| #2592 G08-T11: EXAMLISTENP-0069 T003, Listening programme context  | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 108f +11067/−109 | xung đột → merge staging vào |
| #2594 G10-T15-5: move reading and mock admin groups under (authed- | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 216f +745/−781 | xung đột → merge staging vào |
| #2599 feat(G08-T18): Speaking mic and recording states in the exam | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 94f +9363/−39 | xung đột → merge staging vào |
| #2611 ADMINGROUP-0077 T007, G10-T15-6: move mock-tests, writing, w | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 235f +835/−889 | xung đột → merge staging vào |
| #2620 chore(migrations): giữ số 506 (COURSELESSON-0064) và 507 (RE | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE 1f +2/−0 | xung đột → merge staging vào |
| #2666 [HOÃN] feat(admin): G09-T40 Giảng viên table and teacher pro | claude/project-thread-75nt2j-g10-t15-2 | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 1 | BE+FE 16f +1342/−106 | base `claude/project-thread-75nt2j-g10-t15-2` đã merge/cũ → đổi base sang staging; xung đột → merge staging vào |

## L3: có migration (11 PR)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2565 G09-T31 PR1: mock exam audiences, schedule, two mode names ( | staging | NHÁP; dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0 | BE+FE 21f +2355/−20 | xung đột → merge staging vào; migration 445: cần SA + Andy gõ duyệt áp staging |
| #2581 EXAMMOCK-0071 T004 (G08-T22 PR 1): learner gate reads mock_e | staging | NHÁP; dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0 | BE+FE 62f +6654/−27 | xung đột → merge staging vào; migration 445: cần SA + Andy gõ duyệt áp staging |
| #2585 COURSEACCESS-0055 T013: convert a legacy-code class to credi | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 59f +13354/−1167 | xung đột → merge staging vào; migration 385,387: cần SA + Andy gõ duyệt áp staging |
| #2589 EXAMMOCK-0071 T005 (G08-T22 PR 2): self-paced mock runs its  | staging | NHÁP; dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0 | BE+FE 113f +13530/−68 | xung đột → merge staging vào; migration 445: cần SA + Andy gõ duyệt áp staging |
| #2595 G09-T31 PR2: migration 446 exam_mode rename + audience backf | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 25f +3026/−25 | xung đột → merge staging vào; migration 445,446: cần SA + Andy gõ duyệt áp staging |
| #2612 G09-T33: mock exam timeline, extra time, room message, relea | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 32f +5203/−36 | xung đột → merge staging vào; migration 445,446,447,448: cần SA + Andy gõ duyệt áp staging |
| #2616 fix(mock): same-origin parent only for mock-flush in child p | staging | NHÁP; dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0 | BE+FE 114f +13636/−76 | xung đột → merge staging vào; migration 445: cần SA + Andy gõ duyệt áp staging |
| #2624 COURSEACCESS-0055 G04-T10b: xoá nội dung theo hạn khoá học q | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 49f +8680/−393 | xung đột → merge staging vào; migration 505: cần SA + Andy gõ duyệt áp staging |
| #2631 G09-T33b: mock exam analysis fills top wrong, question types | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 32f +5655/−36 | xung đột → merge staging vào; migration 445,446,447,448: cần SA + Andy gõ duyệt áp staging |
| #2640 G09-T32: Kỳ thi list and four-step setup behind ADMIN_FRAME_ | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 303f +8668/−919 | xung đột → merge staging vào; migration 445: cần SA + Andy gõ duyệt áp staging |
| #2661 G09-T34 PR 1: trang một kỳ thi (Đề, Thí sinh, Theo dõi, Nhật | staging | NHÁP; dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 324f +13345/−935 | xung đột → merge staging vào; migration 445,446,447,448: cần SA + Andy gõ duyệt áp staging |

## L4: chuỗi xếp chồng (theo thứ tự từ gốc)

### Chuỗi LEGACYJS: #2629 → #2646 → #2657 → #2668

**Điểm dừng bắt buộc giữa các đợt** (HOLD tài liệu 7153186191 trên #2673):
1. Merge W3a #2629 chỉ khi anh Andy gõ duyệt riêng `merge #2629`.
2. Sau khi merge và staging đã deploy đúng SHA mới, nghiệm thu W3a trên staging bằng tài khoản đã đăng nhập: `/admin/users`, tab mã (`/admin/users?tab=codes`), và `/admin/access-codes` phải chuyển hướng sang tab mã. Đạt khi không có lỗi console mới và không có `/js/*` nào ≥400. Ghi bằng chứng FR-003 vào PR và `verification.md`.
3. **Dừng trước W3b #2646** cho tới khi bằng chứng ở bước 2 đủ. CI xanh, kết quả 404 trên preview và kết quả nghiệm thu W2 **không** thay được nghiệm thu W3a trên staging.
4. Áp cùng điểm dừng cho từng đợt sau: W3b (#2646) → nghiệm thu → W4a (#2657) → nghiệm thu → W4b (#2668) → nghiệm thu. Mỗi đợt cần: merge staging vào, commit [preview], 404 trên preview, CR delta, anh gõ duyệt merge riêng, rồi nghiệm thu đăng nhập trên staging.

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2629 G10-T07-W3a: retire the users/codes scripts (LEGACYJS-0075 T | gốc chuỗi LEGACYJS | clean; CI xanh; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 24f +264/−1382 | CR duyệt @a2870e4a; Andy gỡ HOLD khi CI xanh; chỉ merge khi anh gõ duyệt riêng `merge #2629`; sau merge DỪNG cho tới khi có nghiệm thu W3a trên staging (xem chuỗi LEGACYJS) |
| #2646 chore(legacy-js): retire the class and student scripts (LEGA | #2629 (LEGACYJS) | clean; CI xanh; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 46f +1310/−11188 |  |
| #2657 chore(legacy-js): retire the overview, system and traffic sc | #2646 (LEGACYJS) | clean; CI xanh; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 69f +1744/−12875 |  |
| #2668 G10-T07-W4b: delete 11 error-log/grammar/speaking/vocab/writ | #2657 (LEGACYJS) | clean; CI xanh; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 96f +2086/−16372 |  |

### Chuỗi FR-010: #2615 → #2626 → #2642 → #2649

#2626 và #2642 đang xếp trên head cũ của #2615, nên vẫn còn nút "Bỏ bản ghi" cũ. **Bắt buộc merge #2615 trước** (comment 7153074726 trên #2642).

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2615 feat(G08-T19): Speaking exam room asks in the page before re | gốc chuỗi FR-010 | NHÁP; dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 101f +10400/−47 | xung đột → merge staging vào |
| #2626 G08-T18 T002 (R85): Speaking journey on /practice/session wi | #2615 (FR-010) | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 102f +10454/−47 | xung đột → merge staging vào |
| #2642 G08-T19b (R139): unplugged microphone stops the take, keeps  | #2626 (FR-010) | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 102f +10544/−47 | xung đột → merge staging vào |
| #2649 G08-T19c (R149): one writing tab per Speaking session | #2642 (FR-010) | dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0; comment tài khoản Andy 1 (kiểm HOLD) | +FE 108f +11529/−64 | xung đột → merge staging vào |

### Chuỗi gốc #2463 (8 PR, sâu 6 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2463 spec: PUBLICSITE-0059 and ENROLL-0060, approved (G05-T01) | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 28f +2045/−0 |  |
| #2591 G05-T22: course open alerts backend (migration 394 file, 3 r | #2463 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 14f +1501/−2 | migration 394: cần SA + Andy gõ duyệt áp staging |
| #2658 G05-T23: khối liên hệ chung và GET /api/public/site-info | #2463 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 13f +633/−0 |  |
| #2598 G05-T22: "Báo cho tôi khi mở" toggle and #bo-nhan= unsubscri | #2591 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 12f +767/−0 |  |
| #2607 G05-T02: commerce data layer for the public course pages | #2598 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 17f +1293/−1 |  |
| #2623 G05-T04: trang danh mục /courses (sau cờ AVER_PUBLIC_COMMERC | #2607 | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | +FE 20f +872/−15 |  |
| #2637 G05-T05: trang một khoá /courses/[slug] (404 thật qua proxy) | #2623 | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | +FE 24f +1321/−30 |  |
| #2648 G05-T12 màn 1: bước đăng ký /courses/[slug]/enroll | #2637 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 16f +742/−17 |  |

### Chuỗi gốc #2468 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2468 spec: draft COURSELESSON-0064 (G07-T03) | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 34f +2595/−0 |  |
| #2617 docs(specs/0064): sửa câu chữ trước khi duyệt (can_renew, le | #2468 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 4f +17/−15 |  |

### Chuỗi gốc #2469 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2469 spec: draft RESULTSHEET-0065 (G07-T04) | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 40f +3110/−0 |  |
| #2618 RESULTSHEET-0065, G07-T04: sửa câu chữ spec trước khi duyệt  | #2469 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 4f +26/−14 |  |

### Chuỗi gốc #2489 (3 PR, sâu 2 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2489 specs: LEARNERCORE-0063 amendment 4, review pages with perso | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 40f +3522/−0 |  |
| #2606 feat(LEARNERCORE-0063 T31): review notes and flag-once backe | #2489 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 19f +1210/−5 | migration 421: cần SA + Andy gõ duyệt áp staging |
| #2647 feat(LEARNERCORE-0063 T31): review pages' new tree, "Chỉ câu | #2606 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 18f +1135/−32 |  |

### Chuỗi gốc #2491 (4 PR, sâu 2 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2491 specs: LEARNERCORE-0063 amendments 5 and 6, skill hubs (G07- | staging | clean; CI xanh; thread mở 0 | docs 40f +3682/−0 |  |
| #2578 feat(G07-T25): skill hubs for Speaking, Writing, Listening a | #2491 | unstable; CI đỏ/chờ: Next-native browser regression, Spec and PR metadata; thread mở 0 | BE+FE 41f +4980/−15 | migration 420: cần SA + Andy gõ duyệt áp staging |
| #2604 feat(G07-T26): open Hôm nay to inactive learner_v2 accounts, | #2491 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 37f +2926/−25 | migration 420: cần SA + Andy gõ duyệt áp staging |
| #2633 feat(G07-T25s): starter paper per skill, set by the admin (L | #2578 | unstable; CI đỏ/chờ: Next-native browser regression, Spec and PR metadata; thread mở 0 | BE+FE 19f +2562/−22 |  |

### Chuỗi gốc #2501 (3 PR, sâu 2 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2501 G04-T18: spec ACCOUNTDATA-0100 tải dữ liệu và yêu cầu xoá tà | staging | NHÁP; blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 8f +402/−0 |  |
| #2562 ACCOUNTDATA-0100 G04-T18 part 1: user-column inventory + mig | #2501 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE 13f +1345/−3 | migration 500: cần SA + Andy gõ duyệt áp staging |
| #2600 ACCOUNTDATA-0100 G04-T18 part 2: account routes, deletion ga | #2562 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 55f +11514/−1306 | migration 504: cần SA + Andy gõ duyệt áp staging |

### Chuỗi gốc #2509 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2509 spec(G08-T15): EXAMMOCK-0071 assigned mock tests in the shar | staging | blocked; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 41f +3559/−0 |  |
| #2625 docs(specs/0071): ghi kết quả review độc lập T007 lần 1 | #2509 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | docs 1f +11/−0 |  |

### Chuỗi gốc #2528 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2528 EXAMROOM-0066 T004 (G08-T05): exam-room audio policy and Hig | staging | dirty; CI đỏ/chờ: Spec and PR metadata; thread mở 0 | +FE 80f +8137/−15 | xung đột → merge staging vào |
| #2586 G08-T05 fix: 40-question Part wraps in the exam-room strip;  | #2528 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 2f +14/−2 |  |

### Chuỗi gốc #2537 (11 PR, sâu 6 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2537 G03-T16b: StaffShell additions for G09-T08 (unavailable item | staging | clean; CI xanh; thread mở 0 | +FE 13f +294/−41 |  |
| #2560 G09-T08: new admin frame and navigation registry (behind ADM | #2537 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 1 | +FE 10f +912/−3 |  |
| #2561 G09-T16: Hộp thư sự cố /admin/incidents | #2560 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 1 | +FE 17f +1110/−1 |  |
| #2643 ADMINIA-0074 G09-T15: Sổ lượt AI /admin/credits | #2560 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 12f +1066/−1 |  |
| #2576 G09-T10: Danh bạ học viên /admin/learners | #2561 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 18f +1066/−8 |  |
| #2653 G09-T41: Báo cáo /admin/reports | #2561 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 12f +1115/−8 |  |
| #2663 feat(admin): Việc cần làm on /admin under the new frame (G09 | #2561 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 8f +885/−1 |  |
| #2587 G09-T11a: Hồ sơ học viên /admin/learners/[ref] (Tổng quan, r | #2576 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 10f +901/−2 |  |
| #2601 G09-T11b: learner profile Khoá và quyền: role change with a  | #2587 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 12f +718/−27 |  |
| #2656 G09-T23: Settings page: operations-threshold table, settings | #2601 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 14f +996/−2 |  |
| #2660 ADMINIA-0074 G09-T14b: grant re-practice and revoke access f | #2601 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 12f +1295/−11 |  |

### Chuỗi gốc #2554 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2554 G04-T07: móc lượt AI vào chấm Speaking (COURSEACCESS-0055 T0 | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE 14f +1883/−7 | xung đột → merge staging vào; migration 503: cần SA + Andy gõ duyệt áp staging |
| #2574 G04-T07b: course-only learners see the Speaking tabs (COURSE | #2554 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 7f +232/−2 |  |

### Chuỗi gốc #2556 (8 PR, sâu 4 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2556 feat(G07-T17): /help, /start và khung học viên v2 (PR 1/3) | claude/project-thread-sgp64h-g07-t17-base | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | +FE 31f +1386/−14 | base `claude/project-thread-sgp64h-g07-t17-base` đã merge/cũ → đổi base sang staging |
| #2572 feat(G07-T17): /account và /progress (PR 2/3) | #2556 | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 23f +1770/−10 | xung đột → merge staging vào |
| #2579 feat(G07-T17): cây Hồ sơ mới sau cờ (PR 3/3) | #2572 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 9f +674/−2 |  |
| #2613 feat(account): pending-deletion notice, data export and dele | #2572 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 10f +962/−6 |  |
| #2627 feat(account): Đơn đăng ký của tôi at /account/orders (G05-T | #2572 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 13f +587/−2 |  |
| #2590 feat(auth): sign out everywhere and the displaced-session no | #2579 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 17f +897/−3 |  |
| #2641 feat(enroll): order page /enroll/[orderCode], screens 2–6 (G | #2627 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 17f +1402/−21 |  |
| #2605 feat(writing): keep unsaved Writing text when the device is  | #2590 | NHÁP; unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 8f +483/−3 |  |

### Chuỗi gốc #2570 (11 PR, sâu 6 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2570 feat(G07-T15): Lộ trình page at /course behind learner_v2 | claude/project-thread-94m6ux-g07-t15-base | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 21f +1897/−6 | base `claude/project-thread-94m6ux-g07-t15-base` đã merge/cũ → đổi base sang staging |
| #2583 feat(G07-T16): Luyện tập hub at /practice behind learner_v2 | #2570 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 13f +494/−11 |  |
| #2588 LEARNERNAV-0062 G07-T15u: move My Class under /course/assign | #2570 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 81f +336/−170 |  |
| #2603 feat(G07-T16): GET /api/student/tests for the Thi thử page | #2570 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 5f +1145/−2 |  |
| #2596 feat(G07-T30a): "Bài được giao" v2 page at /course/assigned  | #2588 | unstable; CI đỏ/chờ: Next-native browser regression, Spec and PR metadata; thread mở 0 | BE+FE 21f +3048/−13 |  |
| #2602 LEARNERNAV-0062 G07-T08: move class exercises, class vocabul | #2588 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 43f +96/−71 |  |
| #2621 LEARNERNAV-0062 G07-T09: move Grammar Check-up under /course | #2602 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 21f +79/−46 |  |
| #2622 feat(G07-T30c): "Buổi học và tài liệu lớp" at /course/class  | #2596 | unstable; CI đỏ/chờ: Next-native browser regression, Spec and PR metadata; thread mở 0 | BE+FE 30f +2152/−30 |  |
| #2636 LEARNERNAV-0062 G07-T12a: move Full Test to /tests and retir | #2621 | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | +FE 48f +582/−716 |  |
| #2628 feat(G07-T10): move Full Test result to /speaking/full-test/ | #2636 | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | +FE 19f +24/−17 |  |
| #2635 feat(G07-T11): move mock results under /tests/mock | #2628 | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | +FE 43f +75/−65 |  |

### Chuỗi gốc #2571 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2571 COURSEACCESS-0055 T005: admin API for course products, entit | staging | dirty; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | BE+FE 45f +10566/−1218 | xung đột → merge staging vào |
| #2654 ADMINIA-0074 G09-T14: shared re-practice grant and revoke fo | #2571 | unstable; CI đỏ/chờ: Backend pytest collection + anchor drift, Backend pytest shard 1/4…; thread mở 0 | +FE 7f +933/−0 |  |

### Chuỗi gốc #2573 (2 PR, sâu 1 tầng)

| PR | Base / phụ thuộc | Trạng thái | Loại | Ghi chú |
|---|---|---|---|---|
| #2573 feat(G07-T30a): GET /api/student/assigned (backend half) | claude/project-thread-94m6ux-g07-t13 | unstable; CI đỏ/chờ: Next-native browser regression, Spec and PR metadata; thread mở 0 | BE+FE 36f +3396/−25 | base `claude/project-thread-94m6ux-g07-t13` đã merge/cũ → đổi base sang staging |
| #2580 feat(G07-T30b): "Tự luyện bài này" for closed class work (se | #2573 | clean; CI đỏ/chờ: Next-native browser regression; thread mở 0 | BE+FE 6f +821/−14 |  |

## Thứ tự đề xuất sau khi staging mở lại

1. L0: #2629 (khi anh gõ duyệt riêng), rồi đến #2536, #2650. Sau #2629 dừng chuỗi LEGACYJS cho tới khi nghiệm thu W3a trên staging xong.
2. Chuỗi LEGACYJS (#2646 → #2657 → #2668, mỗi đợt có điểm dừng nghiệm thu như mục chuỗi) và chuỗi FR-010 (#2615 → #2626 → #2642 → #2649). Hai chuỗi chạy song song được vì không chung file.
3. L1 docs: gộp theo ngày, mỗi lần 3–5 PR, ít rủi ro.
4. L2 code: từng PR, ưu tiên PR đã xanh và mergeable clean.
5. L3 migration: mỗi lần một PR. Áp migration trên staging, có lời anh gõ trong thread Mac, rồi mới merge.
6. Các chuỗi L4 còn lại: theo thứ tự gốc → ngọn. PR nháp và PR còn xung đột chỉ vào lô khi chủ PR đã xử lý xong.
