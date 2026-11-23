# Bảng lô merge vào staging (MERGE-LOTS-20261123)

Thread tiếp quản lập theo lệnh anh Andy 23/11 13:31Z (20:31 VN). Dữ liệu GitHub quét lúc 13:33–13:35Z; đã đối chiếu với `team/queue/MERGE-ORDER-20261125.md`, `CHO-CI-20261123.md`, `READY-QUEUE-20261123.md` và `lots-input-g09-mock.md` (thread qk9jb5). Bảng chỉ đọc: không merge, không bật auto-merge.

**Trạng thái chung:** `staging` vẫn đứng ở `cc6dd4c8` (đóng băng chờ #2450). Vì vậy **không PR nào trong bảng đã merge, đã deploy hay đã nghiệm thu trên staging**. Cột "Nghiệm thu" chỉ có hai mức: *local* (CR đã chạy test trên máy thread, khớp head hoặc ở head cũ) và *chưa*.

Tổng: 204 PR mở vào staging hoặc nhánh khác (không tính #2450). 78 PR xếp chồng trên nhánh PR khác. 35 nháp.

## Cách xếp
- **Rủi ro (5 mức anh nêu)**, lấy theo file trong diff, lấy mức cao nhất: 1 câu chữ/tài liệu (chỉ `docs/`, `specs/`, `.md`) · 2 giao diện (có `frontend/`; ghi "cờ" nếu PR nói chạy sau cờ, "không thấy cờ" nếu không) · 3 backend/CI · 4 migration (có file `backend/migrations/`) · 5 tiền/lượt chấm/auth/xoá dữ liệu (đường dẫn mã chạm entitlement, credit, enroll, order, VietQR, grading/regrade, auth/login/sign-out, single-session, access code, activation, delete/purge/retention, export, revoke). Mức 5 có thể kèm migration, xem cột.
- **Đủ điều kiện vào lô** khi: không nháp; CR duyệt khớp head, **và không có comment chặn nào mới hơn lần duyệt đó** (CR, review độc lập hay Conversation có "CHẶN MERGE", "CẦN SỬA", "chưa/không còn merge-ready" hoặc lỗi P1 đều thắng duyệt cũ); 0 thread mở; không còn chặn của anh Andy; CI không đỏ; không xung đột; và mọi PR phải vào trước nó cũng đủ điều kiện. PR có CI "đang chạy" vẫn được xếp lô nhưng **chỉ merge khi CI xanh trên đúng head** (kiểm lại ngay trước "merge lô N").
- **Lô 0 = #2450** (promote staging → main, cửa sổ 25/11 20:00–21:00 VN). Mọi lô dưới đây chỉ bắt đầu sau khi #2450 merge và gỡ đóng băng.
- Lô 1–5: PR gốc (không phụ thuộc PR mở nào), xếp rủi ro thấp trước. Lô 1 gồm tài liệu cộng hai PR anh cho ưu tiên: #2532 rồi #2632 (#2630 đã merge 17:00Z, xem cuối bảng). Lô 6 trở đi: PR xếp chồng, lô 6 = chồng một tầng, lô 7 = hai tầng, v.v. Trước khi merge một PR xếp chồng, **base của nó phải là `staging`** (merge staging vào head chỉ là bước thêm, không thay được việc đổi base, vì base cũ vẫn là đích merge); rồi chờ CI chạy lại và kiểm cả base lẫn head.
- **Spec gộp dồn:** nhiều PR spec base `staging` nhưng chứa luôn file spec chưa có trên staging của PR spec trước (ví dụ #2463 chứa 0062/0063 của #2460/#2461). Bảng coi đó là phụ thuộc (PR spec gốc của thư mục = PR tài liệu số nhỏ nhất mang thư mục đó) để không merge một spec kéo theo spec trước chưa duyệt.
- Migration: merge **không** áp migration. Lô 4 và mọi PR có số migration cần áp lên staging (anh gõ duyệt) trước khi kiểm staging. Đối chiếu số với `register.tsv` do thread 2zft làm (mục 5 của anh); kết quả đó sẽ bổ sung vào cột này.

## Tóm tắt lô
| Lô | Số PR | PR |
|---|---|---|
| 0 | 1 | #2450 (promote, anh quyết riêng; 6 migration prod theo thứ tự, lệnh áp, quay lui, kiểm staging: `team/release/MUC6-6-MIGRATION-PROD-2450.md`, thread 6ygN) |
| 1 | 12 | #2532 #2632 #2454 #2460 #2470 #2472 #2487 #2563 #2564 #2610 #2638 #2652 |
| 2 | 11 | #2459 #2466 #2476 #2492 #2496 #2513 #2515 #2520 #2569 #2619 #2644 |
| 3 | 16 | #2451 #2455 #2464 #2477 #2478 #2479 #2480 #2490 #2493 #2497 #2498 #2510 #2522 #2534 #2548 #2645 |
| 4 | 1 | #2527 |
| 5 | 3 | #2462 #2485 #2514 |
| 6 | 19 | #2461 #2651 #2465 #2494 #2507 #2512 #2523 #2531 #2535 #2649 #2458 #2467 #2502 #2505 #2471 #2519 #2526 #2544 #2593 |
| 7 | 14 | #2463 #2537 #2545 #2553 #2559 #2659 #2521 #2516 #2524 #2529 #2533 #2552 #2566 #2577 |
| 8 | 8 | #2468 #2567 #2456 #2539 #2525 #2536 #2556 #2591 |
| 9 | 5 | #2469 #2617 #2572 #2594 #2598 |
| 10 | 5 | #2481 #2618 #2607 #2611 #2579 |
| 11 | 2 | #2482 #2623 |
| 12 | 2 | #2484 #2637 |
| 13 | 3 | #2489 #2648 #2573 |
| 14 | 2 | #2580 #2606 |
| chưa xếp | 101 | xem mục "Chưa vào lô" |

## Lô 1: tài liệu + ưu tiên #2532, #2632 (12 PR, CI xanh 2)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2532 | — | fix(av2): margin-note focus ring uses --av2-focus as the whole outline | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2632 | G08-BUG, R136 | G08-BUG (R136): unsaved or too-short P1/P3 take returns to the recorde | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) |
| #2454 | G10-T21 | docs(specs): shipped-pending-evidence means merged, deployed state not | — | 1 tài liệu | xanh | local (CR khớp head) |
| #2460 | LEARNERNAV-0062, G07-T01 | [Spec · chờ Andy duyệt] LEARNERNAV-0062 điều hướng học viên và đổi 17  | — | 1 tài liệu | đang chạy/xếp hàng (10) | local (CR khớp head) |
| #2470 | G10-T10 | docs(0076): record Scenario 10 on staging at cc6dd4c8f (G10-T10, Q61) | — | 1 tài liệu | xanh | local (CR khớp head) |
| #2472 | — | docs(G12-C01): đổi số spec SCOREPAIR 0088 → 0102, ghi 0088 là WRITINGG | — | 1 tài liệu | đang chạy/xếp hàng (2) | local (CR khớp head) |
| #2487 | G08-T01, EXAMROOM-0066 | spec(G08-T01): EXAMROOM-0066 khung phòng thi chung (draft) | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2563 | MOCKORG-0086 | docs(spec): record anh Andy's approval of MOCKORG-0086 (Q12, Q13, Q14, | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2564 | — | Q46: spec 0077 Scenario 2 carries the "not more than pre-PR" sheet bou | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2610 | PHONEGATE-0081 | spec(PHONEGATE-0081): readiness-review fixes (draft stays draft) | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2638 | G04-T11 | docs(0055): G04-T11 apply command uses today's migration numbers and g | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2652 | G03-T17a | docs(0056): G03-T17a interim verification evidence for merged UI-found | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |

## Lô 2: giao diện, PR gốc (11 PR, CI xanh 1)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2459 | ADMINIA-0074, G09-T09 | ADMINIA-0074 G09-T09: role links "Sang khu giáo viên" / "Sang khu quản | — | 2 giao diện · không thấy cờ | xanh | local (CR khớp head) |
| #2466 | G09-T19 | G09-T19: Ctrl/⌘K quick search for admin and teacher pages | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) |
| #2476 | G01-T11 | [Đợt A · chờ Andy merge] G01-T11: xoá source_material/, dời commission | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (9) | local (CR khớp head) |
| #2492 | G03-T10 | [Đợt B] G03-T10: AudioPlayer và VideoFrame (giao diện) trong bộ "Bản i | — | 2 giao diện · cờ | đang chạy/xếp hàng (11) | local (CR khớp head) |
| #2496 | G06-T10 | G06-T10: Library Writing sample page (three essays, delta log) | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (11) | local (CR delta khớp head, comment CR delta RFJd @3e45790f) |
| #2513 | G06-T14 | feat(grammar): G06-T14 (a) bài Grammar trên khuôn đọc T007 | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2515 | G06-T14 | G06-T14 (b): Grammar Wiki home index (groups, A–Z, accent-free search) | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2520 | LIBRARY-0061, G06-T15 | LIBRARY-0061 G06-T15: Vocabulary shelf look-up, entry page, listen and | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2569 | — | R99: restore the band captions on the mock review form | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2619 | — | Shell: link "Bỏ qua tới nội dung" cao 44px khi được focus | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR delta khớp head, comment 7103401327) |
| #2644 | ADMINIA-0074 T012, G09-T12 | ADMINIA-0074 T012 (G09-T12): activation-code ledger at /admin/activati | — | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) |

## Lô 3: backend/CI, PR gốc (16 PR, CI xanh 2)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2451 | G06-T06 | G06-T06 follow-up (SA S-1): Library media per-IP throttle and short by | — | 3 backend/CI | xanh | local (CR khớp head) |
| #2455 | — | fix(writing): attribute Deep runs to the Pass 1 model, record per-pass | — | 3 backend/CI | xanh | local (CR khớp head) |
| #2464 | G09-T04c | feat(admin): learner AI cost and system log APIs (G09-T04c, FR-026/027 | — | 3 backend/CI | đang chạy/xếp hàng (2) | local (CR khớp head) |
| #2477 | G01-T12 | [Đợt A · chờ Andy merge] G01-T12: xoá 14 script chạy một lần không ai  | — | 3 backend/CI | đang chạy/xếp hàng (9) | local (CR khớp head) |
| #2478 | G01-T13 | [Đợt A · chờ Andy merge] G01-T13: bỏ dây chuyền Tailwind thứ hai (inte | — | 3 backend/CI | đang chạy/xếp hàng (2) | local (CR khớp head) |
| #2479 | G01-T15 | [Đợt A · chờ Andy merge] G01-T15: bỏ SQL apply của release Reading đã  | — | 3 backend/CI | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2480 | G10-T15, ADMINGROUP-0077 T002 | feat(admin): G10-T15-1 move usage and overview under (authed-admin) (A | — | 3 backend/CI | đang chạy/xếp hàng (8) | local (CR khớp head) |
| #2490 | 0076 | refactor(admin): make routers/admin a package (0076 T009 rename) | — | 3 backend/CI | đang chạy/xếp hàng (11) | local (CR khớp head) |
| #2493 | G10-T18, MEDIAOUT-0078 T002 | feat(advanced-vocab): G10-T18 legacy media rewrite behind a flag + syn | — | 3 backend/CI | đang chạy/xếp hàng (11) | local (CR khớp head) |
| #2497 | LIBRARY-0061, G06-T20 | LIBRARY-0061 G06-T20: trang /admin/library (quản lý Thư viện) | — | 3 backend/CI | đang chạy/xếp hàng (12) | local (CR khớp head) |
| #2498 | LIBRARY-0061, G06-T03b | LIBRARY-0061 G06-T03b: script nhập bài mẫu Writing, dry-run và --execu | — | 3 backend/CI | đang chạy/xếp hàng (11) | local (CR khớp head) |
| #2510 | G10-T07, LEGACYJS-0075 T002 | G10-T07-W1: retire the 15 admin-listening-*.js scripts (LEGACYJS-0075  | — | 3 backend/CI | đang chạy/xếp hàng (8) | local (CR khớp head) |
| #2522 | LIBRARY-0061, G06-T13 | LIBRARY-0061 G06-T13 (security): CSP allows the YouTube embed on the S | — | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2534 | — | content(cambridge): CAMBRIDGE-B offline package for the four #2311 ite | — | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2548 | — | Q46: guard v2 UI glyphs to font subsets; group backend pip bumps | — | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2645 | G09-T39 | G09-T39: regrade requests get three decisions, overdue marking and a 4 | — | 3 backend/CI | đang chạy/xếp hàng (8) | local (CR khớp head) |

## Lô 4: migration, PR gốc (1 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2527 | LIBRARY-0061, G06-T02b | LIBRARY-0061 G06-T02b: store Writing sample sign-off, migration 401 +  | — | 4 migration (mig 401) | đang chạy/xếp hàng (5) | local (CR khớp head) |

## Lô 5: tiền/lượt/auth/xoá, PR gốc (3 PR, CI xanh 1)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2462 | G09-T06 | G09-T06: Việc cần làm API for admins and teachers | — | 5 tiền/lượt/auth/xoá | xanh | local (CR delta khớp head, comment review 6022997021) |
| #2485 | COURSEACCESS-0055, G04-T03 | COURSEACCESS-0055 G04-T03: entitlement/credit services and /api/course | — | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2514 | G04-T13 | [Đợt B · chờ Andy merge] G04-T13: migration 502 — chấm phát âm trên đo | — | 5 tiền/lượt/auth/xoá (mig 502) | đang chạy/xếp hàng (11) | local (CR khớp head) |

## Lô 6: xếp chồng tầng 1 (19 PR, CI xanh 3)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2461 | LEARNERCORE-0063, G07-T02 | [Spec · chờ Andy duyệt] LEARNERCORE-0063 trang Hôm nay, API /api/stude | #2460 | 1 tài liệu | đang chạy/xếp hàng (10) | local (CR khớp head) |
| #2651 | EXAMROOM-0066 T005 | EXAMROOM-0066 T005: independent review recorded in verification.md | #2487 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2465 | G03-T16 | G03-T16: StaffShell (admin and instructor frame) with /ui-library samp | #2548, #2466 | 2 giao diện · không thấy cờ | xanh | local (CR khớp head) |
| #2494 | G03-T08 | G03-T08: DataTable, StatCard, Chart, FileUpload, Date/Time/DateRange f | #2492 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2507 | EXAMROOM-0066 T001, G08-T02 | EXAMROOM-0066 T001 (G08-T02): pure exam-room logic and examRoomSurface | #2487 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) |
| #2512 | LEARNERNAV-0062, G07-T06 | LEARNERNAV-0062 G07-T06: move flashcards under /vocabulary/flashcards  | #2460 | 2 giao diện · cờ | đang chạy/xếp hàng (9) | local (CR khớp head) |
| #2523 | LEARNERNAV-0062, G07-T03s | LEARNERNAV-0062 G07-T03s: lối "sang Giáo viên" trong menu tài khoản | #2460 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (9) | local (CR khớp head) |
| #2531 | G06-T14 | feat(grammar): G06-T14 (c1) search, compare, roadmap, exercises trên k | #2513, #2515 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2535 | G10-T15, ADMINGROUP-0077 T003 | G10-T15-2: move users, students, classes, instructors under (authed-ad | #2480 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2649 | G08-T19c, R149 | G08-T19c (R149): one writing tab per Speaking session | #2487 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR delta khớp head, comment CR delta 13:45Z @a8b43c62) |
| #2458 | G06-T06 | G06-T06 follow-up (SA S-1): guard the media throttle key against a Ver | #2451 | 3 backend/CI | xanh | local (CR khớp head) |
| #2467 | G09-T04c | feat(admin): learner attempts API for the Học tập tab (G09-T04c, FR-02 | #2464 | 3 backend/CI | đang chạy/xếp hàng (2) | local (CR khớp head) |
| #2502 | G06-T10 | G06-T10: real 404/308 for Library Writing sample pages (proxy.ts, CSP  | #2496 | 3 backend/CI | đang chạy/xếp hàng (11) | local (CR delta khớp head, comment 7109664857 @b9674eb1) |
| #2505 | 0076 | refactor(admin): cut routers/admin/_common (0076 T009, stacked on #249 | #2490 | 3 backend/CI | đang chạy/xếp hàng (9) | local (CR khớp head) |
| #2471 | G09-T35 | feat(admin): learner care notes, migration 442 (G09-T35, FR-032) | #2464 | 4 migration (mig 442) | xanh | local (CR khớp head) |
| #2519 | LIBRARY-0061, G06-T16 | LIBRARY-0061 G06-T16: own read/saved marks API (GET/PATCH/DELETE) and  | #2451 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (8) | local (CR khớp head) |
| #2526 | COURSEACCESS-0055, G04-T04 | COURSEACCESS-0055 G04-T04: API đơn ghi danh, thư học viên, sweep 5 phú | #2485 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2544 | G04-T09 | [Đợt B · chờ freeze] G04-T09: một phiên mỗi tài khoản học viên — migra | #2514 | 5 tiền/lượt/auth/xoá (mig 388) | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2593 | G04-T08, COURSEACCESS-0055 T008 | G04-T08: móc lượt AI và ai_instant cho Writing (COURSEACCESS-0055 T008 | #2485 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (4) | local (CR khớp head) |

## Lô 7: xếp chồng tầng 2 (14 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2463 | PUBLICSITE-0059, ENROLL-0060, G05-T01 | spec: PUBLICSITE-0059 and ENROLL-0060, approved (G05-T01) | #2460, #2461 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2537 | G03-T16b, G09-T08 | G03-T16b: StaffShell additions for G09-T08 (unavailable items, persist | #2465 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2545 | G06-T14 | feat(grammar): G06-T14 (c2) bỏ grammar-wiki.css khỏi layout | #2531, #2513, #2515 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2553 | G10-T15, ADMINGROUP-0077 T004 | G10-T15-3: move grammar and vocab admin groups under (authed-admin) (A | #2535, #2480 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2559 | LEARNERNAV-0062 | LEARNERNAV-0062 R82 (Q53): trang LearnerShell thật chỉ trỏ route đang  | #2523, #2460 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2659 | EXAMROOM-0066, R162 | EXAMROOM-0066 R162: drop exam-room local copies on sign-out and on ano | #2507, #2487 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2521 | LIBRARY-0061, G06-T13 | LIBRARY-0061 G06-T13: Speaking shelf, question page, answer player and | #2519 | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2516 | G09-T07, ADMINIA-0074 | G09-T07: incident groups inbox API and migration 451 (ADMINIA-0074) | #2471 | 4 migration (mig 451) | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2524 | G07-T05 | feat(G07-T05): learner_v2 flag in /auth/me and per-learner admin switc | #2461 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2529 | 0076 | refactor(admin): cut the remaining admin blocks into sub-modules (0076 | #2505, #2490 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2533 | LEARNERNAV-0062, G07-T07 | LEARNERNAV-0062 G07-T07: move fill-in under /vocabulary/fill-in (batch | #2512, #2460 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2552 | COURSEACCESS-0055, G04-T12 | COURSEACCESS-0055 G04-T12: vòng đời lượt AI (migration 385) và cấp thê | #2593, #2526 | 5 tiền/lượt/auth/xoá (mig 385) | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2566 | COURSEACCESS-0055, G04-T17 | COURSEACCESS-0055 G04-T17: thư "khoá đã mở đăng ký" (course_open_alert | #2526 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2577 | G04-T16 | [Đợt B · chờ #2544] G04-T16: lần đăng nhập gần đây của học viên — migr | #2544 | 5 tiền/lượt/auth/xoá (mig 389) | đang chạy/xếp hàng (6) | local (CR khớp head) |

## Lô 8: xếp chồng tầng 3 (8 PR, CI xanh 1)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2468 | COURSELESSON-0064, G07-T03 | spec: draft COURSELESSON-0064 (G07-T03) | #2463, #2461, #2460 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2567 | G10-T15, ADMINGROUP-0077 T005 | G10-T15-4: move the speaking admin groups under (authed-admin), keep l | #2553, #2535, #2480 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2456 | — | fix(admin): reconcile Claude-led Writing spend and label it by provide | #2529, #2455 | 3 backend/CI | xanh | local (CR khớp head) |
| #2539 | LIBRARY-0061, G06-T13 | LIBRARY-0061 G06-T13 follow-up (proxy): real HTTP 404 for an unknown S | #2521 | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2525 | G07-T13 | feat(G07-T13): GET /api/student/today and POST /api/student/today/seen | #2524, #2461 | 4 migration (mig 420) | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2536 | LIBRARY-0061, G06-T13 | LIBRARY-0061 G06-T13 follow-up: "Bỏ …" suggestions on an empty Speakin | #2521 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2556 | G07-T17 | feat(G07-T17): /help, /start và khung học viên v2 (PR 1/3) | #2461, #2524 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2591 | G05-T22 | G05-T22: course open alerts backend (migration 394 file, 3 routes, tes | #2463 | 5 tiền/lượt/auth/xoá (mig 394) | đang chạy/xếp hàng (6) | local (CR khớp head) |

## Lô 9: xếp chồng tầng 4 (5 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2469 | RESULTSHEET-0065, G07-T04 | spec: draft RESULTSHEET-0065 (G07-T04) | #2463, #2461, #2460, #2468 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2617 | — | docs(specs/0064): sửa câu chữ trước khi duyệt (can_renew, lesson_code, | #2468 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2572 | G07-T17 | feat(G07-T17): /account và /progress (PR 2/3) | #2556 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2594 | G10-T15, ADMINGROUP-0077 T006 | G10-T15-5: move reading and mock admin groups under (authed-admin), ke | #2567, #2553, #2535, #2480 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2598 | G05-T22 | G05-T22: "Báo cho tôi khi mở" toggle and #bo-nhan= unsubscribe (fronte | #2591, #2463 | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR khớp head) |

## Lô 10: xếp chồng tầng 5 (5 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2481 | LEARNERCORE-0063, G07-T15, G07-T16 | specs: LEARNERCORE-0063 amendment 1, course path and practice/tests hu | #2469, #2463, #2461, #2460, #2468 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2618 | — | docs(specs/0065): sửa câu chữ trước khi duyệt (review_mode, nguồn can_ | #2460, #2461, #2463, #2468, #2469 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) |
| #2607 | G05-T02 | G05-T02: commerce data layer for the public course pages | #2598, #2463, #2591 | 2 giao diện · cờ | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2611 | ADMINGROUP-0077 T007 | ADMINGROUP-0077 T007: move mock-tests, writing, writing-new under (aut | #2594, #2567, #2553, #2535, #2480 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) |
| #2579 | G07-T17 | feat(G07-T17): cây Hồ sơ mới sau cờ (PR 3/3) | #2572 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) |

## Lô 11: xếp chồng tầng 6 (2 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2482 | LEARNERCORE-0063, G07-T17, G07-T26 | specs: LEARNERCORE-0063 amendment 2, account pages, first visit and in | #2481, #2463, #2469, #2461, #2460, #2468 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2623 | G05-T04 | G05-T04: trang danh mục /courses (sau cờ AVER_PUBLIC_COMMERCE) + nút b | #2463, #2607, #2591, #2598 | 2 giao diện · cờ | đang chạy/xếp hàng (6) | local (CR delta khớp head, comment 7102743922) |

## Lô 12: xếp chồng tầng 7 (2 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2484 | LEARNERCORE-0063, G07-T30 | specs: LEARNERCORE-0063 amendment 3, assigned work page and self-pract | #2482, #2463, #2469, #2461, #2460, #2468, #2481 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2637 | G05-T05 | G05-T05: trang một khoá /courses/[slug] (404 thật qua proxy) + 3 nit C | #2463, #2623, #2591, #2598, #2607 | 2 giao diện · cờ | đang chạy/xếp hàng (6) | local (CR delta khớp head, comment 7102744271) |

## Lô 13: xếp chồng tầng 8 (3 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2489 | LEARNERCORE-0063, G07-T31 | specs: LEARNERCORE-0063 amendment 4, review pages with personal notes  | #2463, #2469, #2461, #2460, #2468, #2484 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) |
| #2648 | G05-T12 | G05-T12 màn 1: bước đăng ký /courses/[slug]/enroll | #2463, #2637, #2591, #2598, #2607, #2623 | 2 giao diện · cờ | đang chạy/xếp hàng (6) | local (CR delta khớp head, comment 7102744735) |
| #2573 | G07-T30a | feat(G07-T30a): GET /api/student/assigned (backend half) | #2525, #2463, #2469, #2461, #2468, #2484 | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) |

## Lô 14: xếp chồng tầng 9 (2 PR, CI xanh 0)
| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu |
|---|---|---|---|---|---|---|
| #2580 | G07-T30b | feat(G07-T30b): "Tự luyện bài này" for closed class work (self-practic | #2525, #2573, #2484 | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) |
| #2606 | LEARNERCORE-0063 T31, G07-T31 | feat(LEARNERCORE-0063 T31): review notes and flag-once backend (G07-T3 | #2489 | 4 migration (mig 421) | đang chạy/xếp hàng (6) | local (CR khớp head) |

## Chưa vào lô
Lý do ghi ở cột cuối. "Phụ thuộc PR chưa đủ điều kiện" nghĩa là bản thân PR sạch nhưng PR phải vào trước nó còn vướng.

| PR | Mã | Tiêu đề | Vào trước | Rủi ro | CI hiện tại | Nghiệm thu | Vướng |
|---|---|---|---|---|---|---|---|
| #2475 | G01-T09 | [Đợt A · chờ Andy merge] G01-T09: đóng băng TECH_DEBT.md, specs/ là ba | — | 1 tài liệu | đỏ: Backend pytest shard 3/4 | local (CR khớp head) | CI đỏ |
| #2501 | G04-T18, ACCOUNTDATA-0100 | G04-T18: spec ACCOUNTDATA-0100 tải dữ liệu và yêu cầu xoá tài khoản (a | — | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2473 | G02-T06 | [Đợt A · chờ Andy merge] G02-T06: kết quả chương trình Listening không | — | 2 giao diện · không thấy cờ | đỏ: Backend pytest shard 3/4, Backend PG17 migration/privilege tests (advisory) 3/3 | local (CR khớp head) | CI đỏ |
| #2474 | G02-T07 | [Đợt A · chờ Andy merge] G02-T07: Quick Check mở lại ghi "Lượt này" và | — | 2 giao diện · không thấy cờ | đỏ: Reading-native layout (FR-018) | local (CR khớp head) | CI đỏ |
| #2499 | UIBASE-0056, G03-T09 | UIBASE-0056 G03-T09: BandScore, Timer, QuestionPalette, VocabEntry, An | — | 2 giao diện · cờ | đang chạy/xếp hàng (6) | local (CR khớp head) | nháp |
| #2655 | ADMINIA-0074 T018, G09-T18 | feat(ADMINIA-0074 T018a): AI và mô hình and Công cụ QA pages (G09-T18  | — | 3 backend/CI | đang chạy/xếp hàng (8) | local (CR khớp head) | 1 thread mở |
| #2565 | G09-T31, MOCKORG-0086 | G09-T31 PR1: mock exam audiences, schedule, two mode names (MOCKORG-00 | — | 4 migration (mig 445) | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ; chặn P1 của anh Andy 17:50Z (7109253687), đã sửa e2dfe5e4, CR+SA delta DUYỆT 7109860746; chờ anh gỡ, #2563, bỏ nháp, CI đầy đủ |
| #2486 | G05-T11 | feat(enroll): VietQR payload builder (G05-T11) | — | 5 tiền/lượt/auth/xoá | đỏ: Spec and PR metadata | local (CR khớp head) | nháp; CI đỏ |
| #2483 | SCOREPAIR-0102 | spec(G12-C01): SCOREPAIR-0102 lưu cặp điểm AI–giáo viên Writing bất bi | #2472 | 1 tài liệu | đang chạy/xếp hàng (10) | local (CR khớp head) | nháp |
| #2495 | G08-T06, EXAMREAD-0067 | spec(G08-T06): EXAMREAD-0067 Reading in the shared exam room (draft) | #2487 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | nháp |
| #2506 | G06-T17 | feat(library): G06-T17 sitemap and robots for Library Writing | #2496 | 2 giao diện · không thấy cờ | đỏ: E2E modal smoke (advisory) | local (CR delta khớp head, comment 7109389507 @3ed7c334) | CI đỏ |
| #2599 | G08-T18, 0072 | feat(G08-T18): Speaking mic and recording states in the exam room behi | #2487 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp |
| #2615 | G08-T19, 0072 | feat(G08-T19): Speaking exam room asks in the page before re-recording | #2487 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR ở head cũ) | nháp; cần CR delta (head đổi) |
| #2562 | ACCOUNTDATA-0100, G04-T18 | ACCOUNTDATA-0100 G04-T18 part 1: user-column inventory + migration 500 | #2501 | 4 migration (mig 500) | đang chạy/xếp hàng (4) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2501 |
| #2595 | G09-T31, MOCKORG-0086 | G09-T31 PR2: migration 446 exam_mode rename + audience backfill (MOCKO | #2565, #2563 | 4 migration (mig 445, 446) | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2554 | G04-T07, COURSEACCESS-0055 T007 | G04-T07: móc lượt AI vào chấm Speaking (COURSEACCESS-0055 T007) | #2485 | 5 tiền/lượt/auth/xoá (mig 503) | đang chạy/xếp hàng (4) | local (CR khớp head) | chặn của anh Andy chưa gỡ |
| #2500 | G08-T08, EXAMWRITE-0068 | spec(G08-T08): EXAMWRITE-0068 class Writing assignment in the shared p | #2495, #2487 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | nháp |
| #2608 | EXAMREAD-0067 | spec(EXAMREAD-0067): readiness-review wording fixes into #2495 | #2495 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495 |
| #2620 | COURSELESSON-0064, RESULTSHEET-0065 | chore(migrations): giữ số 506 (COURSELESSON-0064) và 507 (RESULTSHEET- | #2554 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | phải dựng lại sau #2554 (sổ 504/505) |
| #2488 | LIBRARY-0061, G06-T09 | LIBRARY-0061 G06-T09: danh sách Bài mẫu Writing | #2506 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (11) | local (duyệt cũ đã bị chặn lại) | chặn viền focus (2 dòng writing-samples.module.css), chờ chủ nhánh Codex sửa; review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/app/(p) |
| #2517 | EXAMROOM-0066 T003, G08-T04 | EXAMROOM-0066 T003 (G08-T04): shared exam-room question types | #2487, #2507 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp |
| #2518 | EXAMROOM-0066 T002, G08-T03 | EXAMROOM-0066 T002 (G08-T03): ExamRoomShell on FocusShell and G03 comp | #2487, #2507 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:21Z: ## CHẶN MERGE @8c9752ad052cdc9c3747ec8d792936711962d48e: R150-1 (P1) v) |
| #2542 | G08-T14, 0070 | feat(G08-T14): Listening exam-room audio policy and submit outcome (00 | #2487, #2507 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp |
| #2642 | G08-T19b, R139 | G08-T19b (R139): unplugged microphone stops the take, keeps it, and sa | #2487, #2615, #2599 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2599, #2615 |
| #2612 | G09-T33 | G09-T33: mock exam timeline, extra time, room message, release, score  | #2595, #2565, #2563 | 4 migration (mig 445, 446, 447, 448) | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp |
| #2550 | COURSEACCESS-0055 T010, G04-T10 | COURSEACCESS-0055 T010: thời hạn xem nội dung theo quyền học + RETENTI | #2526 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) | chặn của anh Andy chưa gỡ |
| #2574 | G04-T07b, COURSEACCESS-0055 | G04-T07b: course-only learners see the Speaking tabs (COURSEACCESS-005 | #2554, #2485 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2554 |
| #2600 | ACCOUNTDATA-0100, G04-T18 | ACCOUNTDATA-0100 G04-T18 part 2: account routes, deletion gate, erasur | #2554, #2501, #2562, #2526 | 5 tiền/lượt/auth/xoá (mig 504) | đang chạy/xếp hàng (6) | local (CR ở head cũ) | nháp; cần CR delta (head đổi); 4 thread mở; sổ 504 xung đột với dòng reserved của #2554 |
| #2504 | G08-T10, EXAMLISTENP-0069 | spec(G08-T10): EXAMLISTENP-0069 Listening practice in the shared pract | #2495, #2500, #2487 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500 |
| #2609 | EXAMWRITE-0068 | spec(EXAMWRITE-0068): readiness-review fixes into #2500 | #2500 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500 |
| #2528 | EXAMROOM-0066 T004, G08-T05 | EXAMROOM-0066 T004 (G08-T05): exam-room audio policy and Highlight/Not | #2492, #2518, #2507, #2487 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:21Z: ## CHẶN MERGE @79ce8004c23eba050d69032a4791b74d940c44f4: R150-1 (P1) v) |
| #2560 | G09-T08 | G09-T08: new admin frame and navigation registry (behind ADMIN_FRAME_V | #2462, #2516, #2537, #2465 | 2 giao diện · cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | 1 thread mở |
| #2631 | G09-T33b | G09-T33b: mock exam analysis fills top wrong, question types, Writing  | #2612, #2595, #2565, #2563 | 4 migration (mig 445, 446, 447, 448) | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp |
| #2546 | LIBRARY-0061, G06-T16 | LIBRARY-0061 G06-T16: "Của bạn" column on the Writing sample list | #2488, #2519 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) | chặn của anh Andy chưa gỡ |
| #2571 | COURSEACCESS-0055 T005 | COURSEACCESS-0055 T005: admin API for course products, entitlements an | #2550, #2526, #2485 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) | chặn của anh Andy chưa gỡ |
| #2624 | COURSEACCESS-0055, G04-T10b | COURSEACCESS-0055 G04-T10b: xoá nội dung theo hạn khoá học qua RPC có  | #2554, #2550, #2526, #2485, #2620 | 5 tiền/lượt/auth/xoá (mig 505) | đang chạy/xếp hàng (7) | local (CR khớp head) | 1 thread mở; sổ 505 xung đột với dòng reserved của #2554 |
| #2658 | G05-T23 | G05-T23: khối liên hệ chung và GET /api/public/site-info | #2463 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) | 1 thread mở |
| #2508 | G08-T12, EXAMLISTENT-0070 | spec(G08-T12): EXAMLISTENT-0070 Listening test in the shared exam room | #2504, #2487, #2495, #2500 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504 |
| #2538 | EXAMLISTENP-0069 T001, G08-T11 | EXAMLISTENP-0069 T001 (G08-T11): move the legacy Listening practice dr | #2504, #2495, #2500, #2487 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504 |
| #2561 | G09-T16 | G09-T16: Hộp thư sự cố /admin/incidents | #2462, #2516, #2560, #2537, #2465 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | 1 thread mở |
| #2586 | G08-T05, EXAMROOM-0066 | G08-T05 fix: 40-question Part wraps in the exam-room strip; bare-mode  | #2528 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (6) | local (CR khớp head) | xung đột |
| #2626 | G08-T18 | G08-T18 T002 (R85): Speaking journey on /practice/session with a fake  | #2487, #2615, #2599, #2528 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2518, #2528, #2599, #2615 |
| #2503 | G06-T11 | G06-T11: Kiến thức Writing trong Thư viện công khai | #2519, #2546 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR ở head cũ) | cần CR delta (head đổi) |
| #2585 | COURSEACCESS-0055 T013 | COURSEACCESS-0055 T013: convert a legacy-code class to credit metering | #2571, #2552, #2550, #2526, #2485 | 5 tiền/lượt/auth/xoá (mig 385, 387) | đang chạy/xếp hàng (7) | local (CR khớp head) | chặn của anh Andy chưa gỡ |
| #2643 | ADMINIA-0074, G09-T15 | ADMINIA-0074 G09-T15: Sổ lượt AI /admin/credits | #2560, #2537, #2465 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2560 |
| #2654 | ADMINIA-0074, G09-T14 | ADMINIA-0074 G09-T14: shared re-practice grant and revoke forms | #2571 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) | 1 thread mở; chặn của anh Andy chưa gỡ |
| #2509 | G08-T15, EXAMMOCK-0071 | spec(G08-T15): EXAMMOCK-0071 assigned mock tests in the shared exam ro | #2504, #2487, #2495, #2508, #2500 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504, #2508 |
| #2639 | — | docs(specs/0070): ghi kết quả review độc lập T006 lần 1 | #2508 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504, #2508 |
| #2613 | G07-T17, ACCOUNTDATA-0100, R127 | feat(account): pending-deletion notice, data export and delete request | #2572, #2600 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp |
| #2653 | G09-T41 | G09-T41: Báo cáo /admin/reports | #2561, #2465, #2537, #2560 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2549 | EXAMLISTENT-0070 T004 | feat(listening): abandon route for a self-selected Listening test (EXA | #2508 | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) | chặn của anh Andy chưa gỡ |
| #2557 | G08-T14, 0070 | feat(G08-T14): Listening test in the exam room behind a flag (0070 T00 | #2518, #2528, #2504, #2487, #2495, #2508, #2500 | 3 backend/CI | đang chạy/xếp hàng (8) | chưa | nháp; CR yêu cầu sửa |
| #2558 | EXAMLISTENP-0069 T002, G08-T11 | EXAMLISTENP-0069 T002 (G08-T11): exam-room branch of the Listening pra | #2504, #2495, #2500, #2487, #2538, #2528, #2518, #2507, #2492 | 3 backend/CI | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504, #2518, #2528, #2538 |
| #2576 | G09-T10 | G09-T10: Danh bạ học viên /admin/learners | #2561, #2560, #2537, #2465 | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2560, #2561 |
| #2627 | G05-T13 | feat(account): Đơn đăng ký của tôi at /account/orders (G05-T13) | #2463, #2572, #2526 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) | nháp |
| #2511 | G08-T17, EXAMSPEAK-0072 | spec(G08-T17): EXAMSPEAK-0072 Speaking microphone, recording and leave | #2504, #2487, #2495, #2508, #2509, #2500 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | nháp |
| #2625 | — | docs(specs/0071): ghi kết quả review độc lập T007 lần 1 | #2509 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504, #2508, #2509 |
| #2540 | EXAMMOCK-0071 T001, G08-T16 | EXAMMOCK-0071 T001 (G08-T16): mockSubmitOutcome and reconcileMockWriti | #2504, #2487, #2495, #2508, #2509, #2500, #2507 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2587 | G09-T11a | G09-T11a: Hồ sơ học viên /admin/learners/[ref] (Tổng quan, read only) | #2576, #2561, #2560, #2537, #2465 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2560, #2561, #2576 |
| #2568 | G10-T07, LEGACYJS-0075 T003 | G10-T07-W2: retire the 7 mock-cockpit scripts (LEGACYJS-0075 T003) | #2510, #2611 | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp |
| #2584 | G08-T14, 0070 | test(G08-T14): Listening journeys with the exam room on (0070 T003) | #2518, #2528, #2504, #2487, #2495, #2508, #2500, #2557, #2542, #2549 | 3 backend/CI | đang chạy/xếp hàng (8) | chưa | nháp; CR yêu cầu sửa |
| #2592 | G08-T11, EXAMLISTENP-0069 T003 | G08-T11: EXAMLISTENP-0069 T003, Listening programme context journey wi | #2504, #2495, #2500, #2487, #2558, #2538, #2528, #2518, #2507, #2492 | 3 backend/CI | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504, #2518, #2528, #2538 |
| #2581 | EXAMMOCK-0071 T004, G08-T22 | EXAMMOCK-0071 T004 (G08-T22 PR 1): learner gate reads mock_exam_audien | #2565, #2504, #2487, #2495, #2508, #2509, #2500 | 4 migration (mig 445) | đang chạy/xếp hàng (7) | local (CR delta khớp head, comment 7109360886) | nháp |
| #2590 | G05-T20 | feat(auth): sign out everywhere and the displaced-session notice (G05- | #2579, #2556, #2572 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2640 | G09-T32, MOCKORG-0086 | G09-T32: Kỳ thi list and four-step setup behind ADMIN_FRAME_V2 (MOCKOR | #2565, #2611, #2560 | 5 tiền/lượt/auth/xoá (mig 445) | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2641 | G05-T12 | feat(enroll): order page /enroll/[orderCode], screens 2–6 (G05-T12) | #2627, #2526 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) | nháp |
| #2541 | G08-T20, EXAMDRILL-0073 | spec(G08-T20): EXAMDRILL-0073 Quick Check and flashcards in the shared | #2504, #2487, #2495, #2511, #2508, #2509, #2500 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | nháp |
| #2650 | 0072, R152 | spec(0072 T005, R152): independent review evidence for the Speaking ex | #2511 | 1 tài liệu | đang chạy/xếp hàng (4) | local (CR ở head cũ) | cần CR delta (head đổi) |
| #2551 | EXAMMOCK-0071 T002, G08-T16 | EXAMMOCK-0071 T002 part A (G08-T16): mock runner in the shared exam ro | #2504, #2487, #2495, #2508, #2509, #2500, #2518, #2540, #2507 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2605 | G05-T20, R119 | feat(writing): keep unsaved Writing text when the device is signed out | #2590 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | nháp |
| #2601 | G09-T11b | G09-T11b: learner profile Khoá và quyền: role change with a confirm, d | #2587, #2576, #2561, #2560, #2537, #2465 | 3 backend/CI | đang chạy/xếp hàng (7) | local (CR delta khớp head, comment review 6023232695 @cf296d01) | phụ thuộc PR chưa đủ điều kiện: #2560, #2561, #2576, #2587 |
| #2629 | G10-T07, LEGACYJS-0075 T004 | G10-T07-W3a: retire the users/codes scripts (LEGACYJS-0075 T004) | #2568, #2510 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2568 |
| #2661 | G09-T34 | G09-T34 PR 1: trang một kỳ thi (Đề, Thí sinh, Theo dõi, Nhật ký) behin | #2640, #2612 | 5 tiền/lượt/auth/xoá (mig 445, 446, 447, 448) | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp |
| #2662 | 0073, R164 | spec(0073 T004): independent review evidence for the drill room (R164) | #2541 | 1 tài liệu | đang chạy/xếp hàng (4) | chưa | chưa CR |
| #2555 | EXAMMOCK-0071 T002, G08-T16 | EXAMMOCK-0071 T002 part B (G08-T16): mock Writing room, account-bound  | #2504, #2487, #2495, #2508, #2509, #2500, #2551, #2518, #2540 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp; chặn của anh Andy chưa gỡ |
| #2597 | EXAMDRILL-0073 T001 | EXAMDRILL-0073 T001: Quick Check và flashcard trong phòng luyện (cờ dr | #2504, #2487, #2495, #2511, #2508, #2541, #2509, #2500 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** These rules use `ou) |
| #2614 | EXAMDRILL-0073 T002 | EXAMDRILL-0073 T002: hành trình hai nhánh cờ và ảnh flashcard (phòng l | #2504, #2487, #2495, #2511, #2508, #2541, #2509, #2500 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2495, #2500, #2504, #2508, #2509, #2511 |
| #2656 | G09-T23 | G09-T23: Settings page: operations-threshold table, settings log, Thre | #2601, #2587, #2576, #2561, #2560, #2537, #2465 | 2 giao diện · cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2560, #2561, #2576, #2587, #2601 |
| #2543 | G07-T14 | feat(G07-T14): new Today page at /home behind learner_v2 | #2525, #2524, #2484 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/app/(a) |
| #2646 | LEGACYJS-0075 | chore(legacy-js): retire the class and student scripts (LEGACYJS-0075  | #2629, #2568, #2510 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2568, #2629 |
| #2660 | ADMINIA-0074, G09-T14b | ADMINIA-0074 G09-T14b: grant re-practice and revoke access from the le | #2601 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR delta khớp head, comment 7103378673) | phụ thuộc PR chưa đủ điều kiện: #2560, #2561, #2576, #2587, #2601 |
| #2491 | LEARNERCORE-0063, G07-T25, G07-T30c | specs: LEARNERCORE-0063 amendments 5 and 6, skill hubs (G07-T25) and c | #2463, #2469, #2461, #2460, #2468, #2489, #2481, #2482, #2484 | 1 tài liệu | đang chạy/xếp hàng (5) | local (CR khớp head) | OQ17 đã duyệt theo mặc định 17:00Z; chờ tác giả ghi vào spec rồi CR delta |
| #2575 | EXAMMOCK-0071 T003, G08-T16 | EXAMMOCK-0071 T003 (G08-T16): flag-on steps in the mock exam journey | #2504, #2487, #2495, #2508, #2509, #2500, #2555, #2551, #2518, #2540 | 2 giao diện · cờ | đang chạy/xếp hàng (8) | local (CR khớp head) | nháp |
| #2570 | G07-T15 | feat(G07-T15): Lộ trình page at /course behind learner_v2 | #2543 | 3 backend/CI | đang chạy/xếp hàng (6) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/app/(a) |
| #2589 | EXAMMOCK-0071 T005, G08-T22 | EXAMMOCK-0071 T005 (G08-T22 PR 2): self-paced mock runs its sections b | #2565, #2504, #2487, #2495, #2508, #2509, #2500, #2555, #2581 | 4 migration (mig 445) | đang chạy/xếp hàng (8) | local (CR delta khớp head, comment 7109361525) | nháp |
| #2657 | LEGACYJS-0075 | chore(legacy-js): retire the overview, system and traffic scripts (LEG | #2646, #2629, #2568, #2510 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (8) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2568, #2629, #2646 |
| #2583 | G07-T16 | feat(G07-T16): Luyện tập hub at /practice behind learner_v2 | #2570 | 2 giao diện · cờ | đang chạy/xếp hàng (6) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/app/(a) |
| #2647 | LEARNERCORE-0063 T31 | feat(LEARNERCORE-0063 T31): review pages' new tree, "Chỉ câu sai", not | #2606 | 2 giao diện · cờ | đang chạy/xếp hàng (7) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/compon) |
| #2603 | G07-T16 | feat(G07-T16): GET /api/student/tests for the Thi thử page | #2570 | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2543, #2570 |
| #2616 | EXAMMOCK-0071 | fix(mock): same-origin parent only for mock-flush in child papers (EXA | #2565, #2504, #2487, #2495, #2508, #2509, #2500, #2589, #2555, #2581 | 4 migration (mig 445) | đang chạy/xếp hàng (8) | local (CR delta khớp head, comment 7109362052) | nháp |
| #2578 | G07-T25 | feat(G07-T25): skill hubs for Speaking, Writing, Listening and Reading | #2525, #2491, #2524 | 5 tiền/lượt/auth/xoá (mig 420) | đang chạy/xếp hàng (6) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2491 |
| #2588 | LEARNERNAV-0062, G07-T15u | LEARNERNAV-0062 G07-T15u: move My Class under /course/assigned (batch  | #2570, #2525, #2533, #2512, #2460 | 5 tiền/lượt/auth/xoá | xanh | local (CR khớp head) | xung đột |
| #2604 | G07-T26, LEARNERCORE-0063 | feat(G07-T26): open Hôm nay to inactive learner_v2 accounts, "Cần có k | #2491, #2482, #2524, #2525, #2543, #2556, #2572 | 5 tiền/lượt/auth/xoá (mig 420) | đang chạy/xếp hàng (6) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2491, #2543 |
| #2596 | G07-T30a | feat(G07-T30a): "Bài được giao" v2 page at /course/assigned behind lea | #2525, #2461, #2588, #2580, #2573, #2484 | 3 backend/CI | đang chạy/xếp hàng (7) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/app/(a) |
| #2633 | G07-T25s, LEARNERCORE-0063 | feat(G07-T25s): starter paper per skill, set by the admin (LEARNERCORE | #2525, #2461, #2578, #2580 | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2491, #2578 |
| #2602 | LEARNERNAV-0062, G07-T08 | LEARNERNAV-0062 G07-T08: move class exercises, class vocabulary and as | #2588, #2525 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2543, #2570, #2588 |
| #2622 | G07-T30c | feat(G07-T30c): "Buổi học và tài liệu lớp" at /course/class behind lea | #2525, #2461, #2463, #2596, #2588, #2580, #2573, #2484, #2491 | 3 backend/CI | đang chạy/xếp hàng (6) | local (duyệt cũ đã bị chặn lại) | review/CR chặn mới hơn duyệt cũ (13:15Z: **Focus ring is never drawn (P1, accessibility).** In `frontend/app/(a) |
| #2621 | LEARNERNAV-0062, G07-T09 | LEARNERNAV-0062 G07-T09: move Grammar Check-up under /course/grammar-c | #2602, #2525, #2588 | 5 tiền/lượt/auth/xoá | đang chạy/xếp hàng (6) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2543, #2570, #2588, #2602 |
| #2636 | LEARNERNAV-0062, G07-T12a | LEARNERNAV-0062 G07-T12a: move Full Test to /tests and retire /exam (b | #2621, #2525, #2602, #2588 | 3 backend/CI | đang chạy/xếp hàng (6) | local (CR delta khớp head, comment 7109720275 @cfb33599) | phụ thuộc PR chưa đủ điều kiện: #2543, #2570, #2588, #2602, #2621 |
| #2628 | G07-T10 | feat(G07-T10): move Full Test result to /speaking/full-test/result | #2525, #2636, #2621 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2543, #2570, #2588, #2602, #2621, #2636 |
| #2635 | G07-T11 | feat(G07-T11): move mock results under /tests/mock | #2525, #2628, #2636 | 2 giao diện · không thấy cờ | đang chạy/xếp hàng (7) | local (CR khớp head) | phụ thuộc PR chưa đủ điều kiện: #2543, #2570, #2588, #2602, #2621, #2628 |

## Chuỗi xếp chồng
78 PR có base là nhánh của PR khác; ngoài ra một số PR base `staging` nhưng body ghi phải vào sau PR khác. Dưới đây là từng chuỗi, tính từ PR gốc (PR không phụ thuộc PR mở nào). Một PR có thể nằm trong nhiều chuỗi khi nó chồng trên nhiều nhánh.

### Gốc #2460 (LEARNERNAV-0062, G07-T01, thread 94m6ux): 51 PR chồng lên
```
- #2460 LEARNERNAV-0062, G07-T01 [1 tài liệu] ✓
  - #2461 LEARNERCORE-0063, G07-T02 [1 tài liệu] ✓
    - #2463 PUBLICSITE-0059, ENROLL-0060, G05-T01 [1 tài liệu] ✓
      - #2468 COURSELESSON-0064, G07-T03 [1 tài liệu] ✓
        - #2469 RESULTSHEET-0065, G07-T04 [1 tài liệu] ✓
          - #2481 LEARNERCORE-0063, G07-T15, G07-T16 [1 tài liệu] ✓
            - #2482 LEARNERCORE-0063, G07-T17, G07-T26 [1 tài liệu] ✓
              - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
                - #2489 LEARNERCORE-0063, G07-T31 [1 tài liệu] ✓
                  - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
                    - #2578 G07-T25 [5 tiền/lượt/auth/xoá, mig 420] ✗
                      - #2633 G07-T25s, LEARNERCORE-0063 [3 backend/CI] ✗
                    - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
                    - #2622 G07-T30c [3 backend/CI] ✗
                  - #2606 LEARNERCORE-0063 T31, G07-T31 [4 migration, mig 421] ✓
                    - #2647 LEARNERCORE-0063 T31 [2 giao diện] ✗
                - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
                - #2543 G07-T14 [5 tiền/lượt/auth/xoá] ✗
                  - #2570 G07-T15 [3 backend/CI] ✗
                    - #2583 G07-T16 [2 giao diện] ✗
                    - #2588 LEARNERNAV-0062, G07-T15u [5 tiền/lượt/auth/xoá] ✗
                      - #2596 G07-T30a [3 backend/CI] ✗
                        - #2622 G07-T30c [3 backend/CI] ✗
                      - #2602 LEARNERNAV-0062, G07-T08 [5 tiền/lượt/auth/xoá] ✗
                        - #2621 LEARNERNAV-0062, G07-T09 [5 tiền/lượt/auth/xoá] ✗
                          - #2628 G07-T10 [2 giao diện] ✗
                            - #2635 G07-T11 [2 giao diện] ✗
                          - #2636 LEARNERNAV-0062, G07-T12a [3 backend/CI] ✗
                            - #2628 G07-T10 [2 giao diện] ✗
                            - #2635 G07-T11 [2 giao diện] ✗
                        - #2636 LEARNERNAV-0062, G07-T12a [3 backend/CI] ✗
                      - #2621 LEARNERNAV-0062, G07-T09 [5 tiền/lượt/auth/xoá] ✗
                      - #2622 G07-T30c [3 backend/CI] ✗
                      - #2636 LEARNERNAV-0062, G07-T12a [3 backend/CI] ✗
                    - #2603 G07-T16 [3 backend/CI] ✗
                  - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
                - #2573 G07-T30a [3 backend/CI] ✓
                  - #2580 G07-T30b [3 backend/CI] ✓
                    - #2596 G07-T30a [3 backend/CI] ✗
                    - #2622 G07-T30c [3 backend/CI] ✗
                    - #2633 G07-T25s, LEARNERCORE-0063 [3 backend/CI] ✗
                  - #2596 G07-T30a [3 backend/CI] ✗
                  - #2622 G07-T30c [3 backend/CI] ✗
                - #2580 G07-T30b [3 backend/CI] ✓
                - #2596 G07-T30a [3 backend/CI] ✗
                - #2622 G07-T30c [3 backend/CI] ✗
              - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
              - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
            - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
            - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
          - #2482 LEARNERCORE-0063, G07-T17, G07-T26 [1 tài liệu] ✓
          - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
          - #2489 LEARNERCORE-0063, G07-T31 [1 tài liệu] ✓
          - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
          - #2573 G07-T30a [3 backend/CI] ✓
          - #2618 — [1 tài liệu] ✓
        - #2481 LEARNERCORE-0063, G07-T15, G07-T16 [1 tài liệu] ✓
        - #2482 LEARNERCORE-0063, G07-T17, G07-T26 [1 tài liệu] ✓
        - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
        - #2489 LEARNERCORE-0063, G07-T31 [1 tài liệu] ✓
        - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
        - #2573 G07-T30a [3 backend/CI] ✓
        - #2617 — [1 tài liệu] ✓
        - #2618 — [1 tài liệu] ✓
      - #2469 RESULTSHEET-0065, G07-T04 [1 tài liệu] ✓
      - #2481 LEARNERCORE-0063, G07-T15, G07-T16 [1 tài liệu] ✓
      - #2482 LEARNERCORE-0063, G07-T17, G07-T26 [1 tài liệu] ✓
      - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
      - #2489 LEARNERCORE-0063, G07-T31 [1 tài liệu] ✓
      - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
      - #2573 G07-T30a [3 backend/CI] ✓
      - #2591 G05-T22 [5 tiền/lượt/auth/xoá, mig 394] ✓
        - #2598 G05-T22 [3 backend/CI] ✓
          - #2607 G05-T02 [2 giao diện] ✓
            - #2623 G05-T04 [2 giao diện] ✓
              - #2637 G05-T05 [2 giao diện] ✓
                - #2648 G05-T12 [2 giao diện] ✓
              - #2648 G05-T12 [2 giao diện] ✓
            - #2637 G05-T05 [2 giao diện] ✓
            - #2648 G05-T12 [2 giao diện] ✓
          - #2623 G05-T04 [2 giao diện] ✓
          - #2637 G05-T05 [2 giao diện] ✓
          - #2648 G05-T12 [2 giao diện] ✓
        - #2607 G05-T02 [2 giao diện] ✓
        - #2623 G05-T04 [2 giao diện] ✓
        - #2637 G05-T05 [2 giao diện] ✓
        - #2648 G05-T12 [2 giao diện] ✓
      - #2598 G05-T22 [3 backend/CI] ✓
      - #2607 G05-T02 [2 giao diện] ✓
      - #2618 — [1 tài liệu] ✓
      - #2622 G07-T30c [3 backend/CI] ✗
      - #2623 G05-T04 [2 giao diện] ✓
      - #2627 G05-T13 [5 tiền/lượt/auth/xoá] ✗
        - #2641 G05-T12 [5 tiền/lượt/auth/xoá] ✗
      - #2637 G05-T05 [2 giao diện] ✓
      - #2648 G05-T12 [2 giao diện] ✓
      - #2658 G05-T23 [5 tiền/lượt/auth/xoá] ✗
    - #2468 COURSELESSON-0064, G07-T03 [1 tài liệu] ✓
    - #2469 RESULTSHEET-0065, G07-T04 [1 tài liệu] ✓
    - #2481 LEARNERCORE-0063, G07-T15, G07-T16 [1 tài liệu] ✓
    - #2482 LEARNERCORE-0063, G07-T17, G07-T26 [1 tài liệu] ✓
    - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
    - #2489 LEARNERCORE-0063, G07-T31 [1 tài liệu] ✓
    - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
    - #2524 G07-T05 [5 tiền/lượt/auth/xoá] ✓
      - #2525 G07-T13 [4 migration, mig 420] ✓
        - #2543 G07-T14 [5 tiền/lượt/auth/xoá] ✗
        - #2573 G07-T30a [3 backend/CI] ✓
        - #2578 G07-T25 [5 tiền/lượt/auth/xoá, mig 420] ✗
        - #2580 G07-T30b [3 backend/CI] ✓
        - #2588 LEARNERNAV-0062, G07-T15u [5 tiền/lượt/auth/xoá] ✗
        - #2596 G07-T30a [3 backend/CI] ✗
        - #2602 LEARNERNAV-0062, G07-T08 [5 tiền/lượt/auth/xoá] ✗
        - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
        - #2621 LEARNERNAV-0062, G07-T09 [5 tiền/lượt/auth/xoá] ✗
        - #2622 G07-T30c [3 backend/CI] ✗
        - #2628 G07-T10 [2 giao diện] ✗
        - #2633 G07-T25s, LEARNERCORE-0063 [3 backend/CI] ✗
        - #2635 G07-T11 [2 giao diện] ✗
        - #2636 LEARNERNAV-0062, G07-T12a [3 backend/CI] ✗
      - #2543 G07-T14 [5 tiền/lượt/auth/xoá] ✗
      - #2556 G07-T17 [5 tiền/lượt/auth/xoá] ✓
        - #2572 G07-T17 [2 giao diện] ✓
          - #2579 G07-T17 [5 tiền/lượt/auth/xoá] ✓
            - #2590 G05-T20 [5 tiền/lượt/auth/xoá] ✗
              - #2605 G05-T20, R119 [2 giao diện] ✗
          - #2590 G05-T20 [5 tiền/lượt/auth/xoá] ✗
          - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
          - #2613 G07-T17, ACCOUNTDATA-0100, R127 [2 giao diện] ✗
          - #2627 G05-T13 [5 tiền/lượt/auth/xoá] ✗
        - #2590 G05-T20 [5 tiền/lượt/auth/xoá] ✗
        - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
      - #2578 G07-T25 [5 tiền/lượt/auth/xoá, mig 420] ✗
      - #2604 G07-T26, LEARNERCORE-0063 [5 tiền/lượt/auth/xoá, mig 420] ✗
    - #2525 G07-T13 [4 migration, mig 420] ✓
    - #2556 G07-T17 [5 tiền/lượt/auth/xoá] ✓
    - #2573 G07-T30a [3 backend/CI] ✓
    - #2596 G07-T30a [3 backend/CI] ✗
    - #2618 — [1 tài liệu] ✓
    - #2622 G07-T30c [3 backend/CI] ✗
    - #2633 G07-T25s, LEARNERCORE-0063 [3 backend/CI] ✗
  - #2463 PUBLICSITE-0059, ENROLL-0060, G05-T01 [1 tài liệu] ✓
  - #2468 COURSELESSON-0064, G07-T03 [1 tài liệu] ✓
  - #2469 RESULTSHEET-0065, G07-T04 [1 tài liệu] ✓
  - #2481 LEARNERCORE-0063, G07-T15, G07-T16 [1 tài liệu] ✓
  - #2482 LEARNERCORE-0063, G07-T17, G07-T26 [1 tài liệu] ✓
  - #2484 LEARNERCORE-0063, G07-T30 [1 tài liệu] ✓
  - #2489 LEARNERCORE-0063, G07-T31 [1 tài liệu] ✓
  - #2491 LEARNERCORE-0063, G07-T25, G07-T30c [1 tài liệu] ✗
  - #2512 LEARNERNAV-0062, G07-T06 [2 giao diện] ✓
    - #2533 LEARNERNAV-0062, G07-T07 [5 tiền/lượt/auth/xoá] ✓
      - #2588 LEARNERNAV-0062, G07-T15u [5 tiền/lượt/auth/xoá] ✗
    - #2588 LEARNERNAV-0062, G07-T15u [5 tiền/lượt/auth/xoá] ✗
  - #2523 LEARNERNAV-0062, G07-T03s [2 giao diện] ✓
    - #2559 LEARNERNAV-0062 [2 giao diện] ✓
  - #2533 LEARNERNAV-0062, G07-T07 [5 tiền/lượt/auth/xoá] ✓
  - #2559 LEARNERNAV-0062 [2 giao diện] ✓
  - #2588 LEARNERNAV-0062, G07-T15u [5 tiền/lượt/auth/xoá] ✗
  - #2618 — [1 tài liệu] ✓
```
### Gốc #2487 (G08-T01, EXAMROOM-0066, thread examro): 41 PR chồng lên
```
- #2487 G08-T01, EXAMROOM-0066 [1 tài liệu] ✓
  - #2495 G08-T06, EXAMREAD-0067 [1 tài liệu] ✗
    - #2500 G08-T08, EXAMWRITE-0068 [1 tài liệu] ✗
      - #2504 G08-T10, EXAMLISTENP-0069 [1 tài liệu] ✗
        - #2508 G08-T12, EXAMLISTENT-0070 [1 tài liệu] ✗
          - #2509 G08-T15, EXAMMOCK-0071 [1 tài liệu] ✗
            - #2511 G08-T17, EXAMSPEAK-0072 [1 tài liệu] ✗
              - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
                - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
                - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
                - #2662 0073, R164 [1 tài liệu] ✗
              - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
              - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
              - #2650 0072, R152 [1 tài liệu] ✗
            - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
              - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
                - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
                  - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
                  - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
                    - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
                  - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
                - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
              - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
              - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
            - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
            - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
            - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
            - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
            - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
              - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
              - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
            - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
            - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
            - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
            - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
            - #2625 — [1 tài liệu] ✗
          - #2511 G08-T17, EXAMSPEAK-0072 [1 tài liệu] ✗
          - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
          - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
          - #2549 EXAMLISTENT-0070 T004 [3 backend/CI] ✗
            - #2584 G08-T14, 0070 [3 backend/CI] ✗
          - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
          - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
          - #2557 G08-T14, 0070 [3 backend/CI] ✗
            - #2584 G08-T14, 0070 [3 backend/CI] ✗
          - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
          - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
          - #2584 G08-T14, 0070 [3 backend/CI] ✗
          - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
          - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
          - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
          - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
          - #2639 — [1 tài liệu] ✗
        - #2509 G08-T15, EXAMMOCK-0071 [1 tài liệu] ✗
        - #2511 G08-T17, EXAMSPEAK-0072 [1 tài liệu] ✗
        - #2538 EXAMLISTENP-0069 T001, G08-T11 [2 giao diện] ✗
          - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
            - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
          - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
        - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
        - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
        - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
        - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
        - #2557 G08-T14, 0070 [3 backend/CI] ✗
        - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
        - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
        - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
        - #2584 G08-T14, 0070 [3 backend/CI] ✗
        - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
        - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
        - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
        - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
        - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
      - #2508 G08-T12, EXAMLISTENT-0070 [1 tài liệu] ✗
      - #2509 G08-T15, EXAMMOCK-0071 [1 tài liệu] ✗
      - #2511 G08-T17, EXAMSPEAK-0072 [1 tài liệu] ✗
      - #2538 EXAMLISTENP-0069 T001, G08-T11 [2 giao diện] ✗
      - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
      - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
      - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
      - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
      - #2557 G08-T14, 0070 [3 backend/CI] ✗
      - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
      - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
      - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
      - #2584 G08-T14, 0070 [3 backend/CI] ✗
      - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
      - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
      - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
      - #2609 EXAMWRITE-0068 [1 tài liệu] ✗
      - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
      - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
    - #2504 G08-T10, EXAMLISTENP-0069 [1 tài liệu] ✗
    - #2508 G08-T12, EXAMLISTENT-0070 [1 tài liệu] ✗
    - #2509 G08-T15, EXAMMOCK-0071 [1 tài liệu] ✗
    - #2511 G08-T17, EXAMSPEAK-0072 [1 tài liệu] ✗
    - #2538 EXAMLISTENP-0069 T001, G08-T11 [2 giao diện] ✗
    - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
    - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
    - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
    - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
    - #2557 G08-T14, 0070 [3 backend/CI] ✗
    - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
    - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
    - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
    - #2584 G08-T14, 0070 [3 backend/CI] ✗
    - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
    - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
    - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
    - #2608 EXAMREAD-0067 [1 tài liệu] ✗
    - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
    - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
  - #2500 G08-T08, EXAMWRITE-0068 [1 tài liệu] ✗
  - #2504 G08-T10, EXAMLISTENP-0069 [1 tài liệu] ✗
  - #2507 EXAMROOM-0066 T001, G08-T02 [2 giao diện] ✓
    - #2517 EXAMROOM-0066 T003, G08-T04 [2 giao diện] ✗
    - #2518 EXAMROOM-0066 T002, G08-T03 [2 giao diện] ✗
      - #2528 EXAMROOM-0066 T004, G08-T05 [2 giao diện] ✗
        - #2557 G08-T14, 0070 [3 backend/CI] ✗
        - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
        - #2584 G08-T14, 0070 [3 backend/CI] ✗
        - #2586 G08-T05, EXAMROOM-0066 [2 giao diện] ✗
        - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
        - #2626 G08-T18 [2 giao diện] ✗
      - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
      - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
      - #2557 G08-T14, 0070 [3 backend/CI] ✗
      - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
      - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
      - #2584 G08-T14, 0070 [3 backend/CI] ✗
      - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
    - #2528 EXAMROOM-0066 T004, G08-T05 [2 giao diện] ✗
    - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
    - #2542 G08-T14, 0070 [2 giao diện] ✗
      - #2584 G08-T14, 0070 [3 backend/CI] ✗
    - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
    - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
    - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
    - #2659 EXAMROOM-0066, R162 [2 giao diện] ✓
  - #2508 G08-T12, EXAMLISTENT-0070 [1 tài liệu] ✗
  - #2509 G08-T15, EXAMMOCK-0071 [1 tài liệu] ✗
  - #2511 G08-T17, EXAMSPEAK-0072 [1 tài liệu] ✗
  - #2517 EXAMROOM-0066 T003, G08-T04 [2 giao diện] ✗
  - #2518 EXAMROOM-0066 T002, G08-T03 [2 giao diện] ✗
  - #2528 EXAMROOM-0066 T004, G08-T05 [2 giao diện] ✗
  - #2538 EXAMLISTENP-0069 T001, G08-T11 [2 giao diện] ✗
  - #2540 EXAMMOCK-0071 T001, G08-T16 [2 giao diện] ✗
  - #2541 G08-T20, EXAMDRILL-0073 [1 tài liệu] ✗
  - #2542 G08-T14, 0070 [2 giao diện] ✗
  - #2551 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
  - #2555 EXAMMOCK-0071 T002, G08-T16 [2 giao diện] ✗
  - #2557 G08-T14, 0070 [3 backend/CI] ✗
  - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
  - #2575 EXAMMOCK-0071 T003, G08-T16 [2 giao diện] ✗
  - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
  - #2584 G08-T14, 0070 [3 backend/CI] ✗
  - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
  - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
  - #2597 EXAMDRILL-0073 T001 [2 giao diện] ✗
  - #2599 G08-T18, 0072 [2 giao diện] ✗
    - #2626 G08-T18 [2 giao diện] ✗
    - #2642 G08-T19b, R139 [2 giao diện] ✗
  - #2614 EXAMDRILL-0073 T002 [2 giao diện] ✗
  - #2615 G08-T19, 0072 [2 giao diện] ✗
    - #2626 G08-T18 [2 giao diện] ✗
    - #2642 G08-T19b, R139 [2 giao diện] ✗
  - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
  - #2626 G08-T18 [2 giao diện] ✗
  - #2642 G08-T19b, R139 [2 giao diện] ✗
  - #2649 G08-T19c, R149 [2 giao diện] ✓
  - #2651 EXAMROOM-0066 T005 [1 tài liệu] ✓
  - #2659 EXAMROOM-0066, R162 [2 giao diện] ✓
```
### Gốc #2485 (COURSEACCESS-0055, G04-T03, thread j1tkzb): 16 PR chồng lên
```
- #2485 COURSEACCESS-0055, G04-T03 [5 tiền/lượt/auth/xoá] ✓
  - #2526 COURSEACCESS-0055, G04-T04 [5 tiền/lượt/auth/xoá] ✓
    - #2550 COURSEACCESS-0055 T010, G04-T10 [5 tiền/lượt/auth/xoá] ✗
      - #2571 COURSEACCESS-0055 T005 [5 tiền/lượt/auth/xoá] ✗
        - #2585 COURSEACCESS-0055 T013 [5 tiền/lượt/auth/xoá, mig 385/387] ✗
        - #2654 ADMINIA-0074, G09-T14 [5 tiền/lượt/auth/xoá] ✗
      - #2585 COURSEACCESS-0055 T013 [5 tiền/lượt/auth/xoá, mig 385/387] ✗
      - #2624 COURSEACCESS-0055, G04-T10b [5 tiền/lượt/auth/xoá, mig 505] ✗
    - #2552 COURSEACCESS-0055, G04-T12 [5 tiền/lượt/auth/xoá, mig 385] ✓
      - #2585 COURSEACCESS-0055 T013 [5 tiền/lượt/auth/xoá, mig 385/387] ✗
    - #2566 COURSEACCESS-0055, G04-T17 [5 tiền/lượt/auth/xoá] ✓
    - #2571 COURSEACCESS-0055 T005 [5 tiền/lượt/auth/xoá] ✗
    - #2585 COURSEACCESS-0055 T013 [5 tiền/lượt/auth/xoá, mig 385/387] ✗
    - #2600 ACCOUNTDATA-0100, G04-T18 [5 tiền/lượt/auth/xoá, mig 504] ✗
      - #2613 G07-T17, ACCOUNTDATA-0100, R127 [2 giao diện] ✗
    - #2624 COURSEACCESS-0055, G04-T10b [5 tiền/lượt/auth/xoá, mig 505] ✗
    - #2627 G05-T13 [5 tiền/lượt/auth/xoá] ✗
      - #2641 G05-T12 [5 tiền/lượt/auth/xoá] ✗
    - #2641 G05-T12 [5 tiền/lượt/auth/xoá] ✗
  - #2554 G04-T07, COURSEACCESS-0055 T007 [5 tiền/lượt/auth/xoá, mig 503] ✗
    - #2574 G04-T07b, COURSEACCESS-0055 [5 tiền/lượt/auth/xoá] ✗
    - #2600 ACCOUNTDATA-0100, G04-T18 [5 tiền/lượt/auth/xoá, mig 504] ✗
    - #2620 COURSELESSON-0064, RESULTSHEET-0065 [1 tài liệu] ✗
      - #2624 COURSEACCESS-0055, G04-T10b [5 tiền/lượt/auth/xoá, mig 505] ✗
    - #2624 COURSEACCESS-0055, G04-T10b [5 tiền/lượt/auth/xoá, mig 505] ✗
  - #2571 COURSEACCESS-0055 T005 [5 tiền/lượt/auth/xoá] ✗
  - #2574 G04-T07b, COURSEACCESS-0055 [5 tiền/lượt/auth/xoá] ✗
  - #2585 COURSEACCESS-0055 T013 [5 tiền/lượt/auth/xoá, mig 385/387] ✗
  - #2593 G04-T08, COURSEACCESS-0055 T008 [5 tiền/lượt/auth/xoá] ✓
    - #2552 COURSEACCESS-0055, G04-T12 [5 tiền/lượt/auth/xoá, mig 385] ✓
  - #2624 COURSEACCESS-0055, G04-T10b [5 tiền/lượt/auth/xoá, mig 505] ✗
```
### Gốc #2464 (G09-T04c, thread codex/g09-t04c): 14 PR chồng lên
```
- #2464 G09-T04c [3 backend/CI] ✓
  - #2467 G09-T04c [3 backend/CI] ✓
  - #2471 G09-T35 [4 migration, mig 442] ✓
    - #2516 G09-T07, ADMINIA-0074 [4 migration, mig 451] ✓
      - #2560 G09-T08 [2 giao diện] ✗
        - #2561 G09-T16 [2 giao diện] ✗
          - #2576 G09-T10 [3 backend/CI] ✗
            - #2587 G09-T11a [2 giao diện] ✗
              - #2601 G09-T11b [3 backend/CI] ✗
                - #2656 G09-T23 [2 giao diện] ✗
                - #2660 ADMINIA-0074, G09-T14b [5 tiền/lượt/auth/xoá] ✗
              - #2656 G09-T23 [2 giao diện] ✗
            - #2601 G09-T11b [3 backend/CI] ✗
            - #2656 G09-T23 [2 giao diện] ✗
          - #2587 G09-T11a [2 giao diện] ✗
          - #2601 G09-T11b [3 backend/CI] ✗
          - #2653 G09-T41 [2 giao diện] ✗
          - #2656 G09-T23 [2 giao diện] ✗
        - #2576 G09-T10 [3 backend/CI] ✗
        - #2587 G09-T11a [2 giao diện] ✗
        - #2601 G09-T11b [3 backend/CI] ✗
        - #2640 G09-T32, MOCKORG-0086 [5 tiền/lượt/auth/xoá, mig 445] ✗
          - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
        - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
        - #2653 G09-T41 [2 giao diện] ✗
        - #2656 G09-T23 [2 giao diện] ✗
      - #2561 G09-T16 [2 giao diện] ✗
```
### Gốc #2466 (G09-T19, thread mlct8t): 13 PR chồng lên
```
- #2466 G09-T19 [2 giao diện] ✓
  - #2465 G03-T16 [2 giao diện] ✓
    - #2537 G03-T16b, G09-T08 [2 giao diện] ✓
      - #2560 G09-T08 [2 giao diện] ✗
        - #2561 G09-T16 [2 giao diện] ✗
          - #2576 G09-T10 [3 backend/CI] ✗
            - #2587 G09-T11a [2 giao diện] ✗
              - #2601 G09-T11b [3 backend/CI] ✗
                - #2656 G09-T23 [2 giao diện] ✗
                - #2660 ADMINIA-0074, G09-T14b [5 tiền/lượt/auth/xoá] ✗
              - #2656 G09-T23 [2 giao diện] ✗
            - #2601 G09-T11b [3 backend/CI] ✗
            - #2656 G09-T23 [2 giao diện] ✗
          - #2587 G09-T11a [2 giao diện] ✗
          - #2601 G09-T11b [3 backend/CI] ✗
          - #2653 G09-T41 [2 giao diện] ✗
          - #2656 G09-T23 [2 giao diện] ✗
        - #2576 G09-T10 [3 backend/CI] ✗
        - #2587 G09-T11a [2 giao diện] ✗
        - #2601 G09-T11b [3 backend/CI] ✗
        - #2640 G09-T32, MOCKORG-0086 [5 tiền/lượt/auth/xoá, mig 445] ✗
          - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
        - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
        - #2653 G09-T41 [2 giao diện] ✗
        - #2656 G09-T23 [2 giao diện] ✗
      - #2561 G09-T16 [2 giao diện] ✗
      - #2576 G09-T10 [3 backend/CI] ✗
      - #2587 G09-T11a [2 giao diện] ✗
      - #2601 G09-T11b [3 backend/CI] ✗
      - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
      - #2653 G09-T41 [2 giao diện] ✗
      - #2656 G09-T23 [2 giao diện] ✗
    - #2560 G09-T08 [2 giao diện] ✗
    - #2561 G09-T16 [2 giao diện] ✗
    - #2576 G09-T10 [3 backend/CI] ✗
    - #2587 G09-T11a [2 giao diện] ✗
    - #2601 G09-T11b [3 backend/CI] ✗
    - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
    - #2653 G09-T41 [2 giao diện] ✗
    - #2656 G09-T23 [2 giao diện] ✗
```
### Gốc #2548 (—, thread 0bvkxt): 13 PR chồng lên
```
- #2548 — [3 backend/CI] ✓
  - #2465 G03-T16 [2 giao diện] ✓
    - #2537 G03-T16b, G09-T08 [2 giao diện] ✓
      - #2560 G09-T08 [2 giao diện] ✗
        - #2561 G09-T16 [2 giao diện] ✗
          - #2576 G09-T10 [3 backend/CI] ✗
            - #2587 G09-T11a [2 giao diện] ✗
              - #2601 G09-T11b [3 backend/CI] ✗
                - #2656 G09-T23 [2 giao diện] ✗
                - #2660 ADMINIA-0074, G09-T14b [5 tiền/lượt/auth/xoá] ✗
              - #2656 G09-T23 [2 giao diện] ✗
            - #2601 G09-T11b [3 backend/CI] ✗
            - #2656 G09-T23 [2 giao diện] ✗
          - #2587 G09-T11a [2 giao diện] ✗
          - #2601 G09-T11b [3 backend/CI] ✗
          - #2653 G09-T41 [2 giao diện] ✗
          - #2656 G09-T23 [2 giao diện] ✗
        - #2576 G09-T10 [3 backend/CI] ✗
        - #2587 G09-T11a [2 giao diện] ✗
        - #2601 G09-T11b [3 backend/CI] ✗
        - #2640 G09-T32, MOCKORG-0086 [5 tiền/lượt/auth/xoá, mig 445] ✗
          - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
        - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
        - #2653 G09-T41 [2 giao diện] ✗
        - #2656 G09-T23 [2 giao diện] ✗
      - #2561 G09-T16 [2 giao diện] ✗
      - #2576 G09-T10 [3 backend/CI] ✗
      - #2587 G09-T11a [2 giao diện] ✗
      - #2601 G09-T11b [3 backend/CI] ✗
      - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
      - #2653 G09-T41 [2 giao diện] ✗
      - #2656 G09-T23 [2 giao diện] ✗
    - #2560 G09-T08 [2 giao diện] ✗
    - #2561 G09-T16 [2 giao diện] ✗
    - #2576 G09-T10 [3 backend/CI] ✗
    - #2587 G09-T11a [2 giao diện] ✗
    - #2601 G09-T11b [3 backend/CI] ✗
    - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
    - #2653 G09-T41 [2 giao diện] ✗
    - #2656 G09-T23 [2 giao diện] ✗
```
### Gốc #2480 (G10-T15, ADMINGROUP-0077 T002, thread 75nt2j): 11 PR chồng lên
```
- #2480 G10-T15, ADMINGROUP-0077 T002 [3 backend/CI] ✓
  - #2535 G10-T15, ADMINGROUP-0077 T003 [2 giao diện] ✓
    - #2553 G10-T15, ADMINGROUP-0077 T004 [2 giao diện] ✓
      - #2567 G10-T15, ADMINGROUP-0077 T005 [2 giao diện] ✓
        - #2594 G10-T15, ADMINGROUP-0077 T006 [2 giao diện] ✓
          - #2611 ADMINGROUP-0077 T007 [2 giao diện] ✓
            - #2568 G10-T07, LEGACYJS-0075 T003 [3 backend/CI] ✗
              - #2629 G10-T07, LEGACYJS-0075 T004 [5 tiền/lượt/auth/xoá] ✗
                - #2646 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
                  - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
                - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
              - #2646 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
              - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
            - #2640 G09-T32, MOCKORG-0086 [5 tiền/lượt/auth/xoá, mig 445] ✗
              - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
        - #2611 ADMINGROUP-0077 T007 [2 giao diện] ✓
      - #2594 G10-T15, ADMINGROUP-0077 T006 [2 giao diện] ✓
      - #2611 ADMINGROUP-0077 T007 [2 giao diện] ✓
    - #2567 G10-T15, ADMINGROUP-0077 T005 [2 giao diện] ✓
    - #2594 G10-T15, ADMINGROUP-0077 T006 [2 giao diện] ✓
    - #2611 ADMINGROUP-0077 T007 [2 giao diện] ✓
  - #2553 G10-T15, ADMINGROUP-0077 T004 [2 giao diện] ✓
  - #2567 G10-T15, ADMINGROUP-0077 T005 [2 giao diện] ✓
  - #2594 G10-T15, ADMINGROUP-0077 T006 [2 giao diện] ✓
  - #2611 ADMINGROUP-0077 T007 [2 giao diện] ✓
```
### Gốc #2462 (G09-T06, thread qk9jb5): 11 PR chồng lên
```
- #2462 G09-T06 [5 tiền/lượt/auth/xoá] ✓
  - #2560 G09-T08 [2 giao diện] ✗
    - #2561 G09-T16 [2 giao diện] ✗
      - #2576 G09-T10 [3 backend/CI] ✗
        - #2587 G09-T11a [2 giao diện] ✗
          - #2601 G09-T11b [3 backend/CI] ✗
            - #2656 G09-T23 [2 giao diện] ✗
            - #2660 ADMINIA-0074, G09-T14b [5 tiền/lượt/auth/xoá] ✗
          - #2656 G09-T23 [2 giao diện] ✗
        - #2601 G09-T11b [3 backend/CI] ✗
        - #2656 G09-T23 [2 giao diện] ✗
      - #2587 G09-T11a [2 giao diện] ✗
      - #2601 G09-T11b [3 backend/CI] ✗
      - #2653 G09-T41 [2 giao diện] ✗
      - #2656 G09-T23 [2 giao diện] ✗
    - #2576 G09-T10 [3 backend/CI] ✗
    - #2587 G09-T11a [2 giao diện] ✗
    - #2601 G09-T11b [3 backend/CI] ✗
    - #2640 G09-T32, MOCKORG-0086 [5 tiền/lượt/auth/xoá, mig 445] ✗
      - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
    - #2643 ADMINIA-0074, G09-T15 [5 tiền/lượt/auth/xoá] ✗
    - #2653 G09-T41 [2 giao diện] ✗
    - #2656 G09-T23 [2 giao diện] ✗
  - #2561 G09-T16 [2 giao diện] ✗
```
### Gốc #2492 (G03-T10, thread sgp64h): 8 PR chồng lên
```
- #2492 G03-T10 [2 giao diện] ✓
  - #2494 G03-T08 [2 giao diện] ✓
  - #2528 EXAMROOM-0066 T004, G08-T05 [2 giao diện] ✗
    - #2557 G08-T14, 0070 [3 backend/CI] ✗
      - #2584 G08-T14, 0070 [3 backend/CI] ✗
    - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
      - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
    - #2584 G08-T14, 0070 [3 backend/CI] ✗
    - #2586 G08-T05, EXAMROOM-0066 [2 giao diện] ✗
    - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
    - #2626 G08-T18 [2 giao diện] ✗
  - #2558 EXAMLISTENP-0069 T002, G08-T11 [3 backend/CI] ✗
  - #2592 G08-T11, EXAMLISTENP-0069 T003 [3 backend/CI] ✗
```
### Gốc #2565 (G09-T31, MOCKORG-0086, thread qk9jb5): 8 PR chồng lên
```
- #2565 G09-T31, MOCKORG-0086 [4 migration, mig 445] ✗
  - #2581 EXAMMOCK-0071 T004, G08-T22 [4 migration, mig 445] ✗
    - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
      - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
    - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
  - #2589 EXAMMOCK-0071 T005, G08-T22 [4 migration, mig 445] ✗
  - #2595 G09-T31, MOCKORG-0086 [4 migration, mig 445/446] ✗
    - #2612 G09-T33 [4 migration, mig 445/446/447/448] ✗
      - #2631 G09-T33b [4 migration, mig 445/446/447/448] ✗
      - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
    - #2631 G09-T33b [4 migration, mig 445/446/447/448] ✗
  - #2612 G09-T33 [4 migration, mig 445/446/447/448] ✗
  - #2616 EXAMMOCK-0071 [4 migration, mig 445] ✗
  - #2631 G09-T33b [4 migration, mig 445/446/447/448] ✗
  - #2640 G09-T32, MOCKORG-0086 [5 tiền/lượt/auth/xoá, mig 445] ✗
    - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
```
### Gốc #2451 (G06-T06, thread mytq2y): 7 PR chồng lên
```
- #2451 G06-T06 [3 backend/CI] ✓
  - #2458 G06-T06 [3 backend/CI] ✓
  - #2519 LIBRARY-0061, G06-T16 [5 tiền/lượt/auth/xoá] ✓
    - #2503 G06-T11 [5 tiền/lượt/auth/xoá] ✗
    - #2521 LIBRARY-0061, G06-T13 [3 backend/CI] ✓
      - #2536 LIBRARY-0061, G06-T13 [5 tiền/lượt/auth/xoá] ✓
      - #2539 LIBRARY-0061, G06-T13 [3 backend/CI] ✓
    - #2546 LIBRARY-0061, G06-T16 [5 tiền/lượt/auth/xoá] ✗
      - #2503 G06-T11 [5 tiền/lượt/auth/xoá] ✗
```
### Gốc #2496 (G06-T10, thread qk9jb5): 5 PR chồng lên
```
- #2496 G06-T10 [2 giao diện] ✓
  - #2502 G06-T10 [3 backend/CI] ✓
  - #2506 G06-T17 [2 giao diện] ✗
    - #2488 LIBRARY-0061, G06-T09 [2 giao diện] ✗
      - #2546 LIBRARY-0061, G06-T16 [5 tiền/lượt/auth/xoá] ✗
        - #2503 G06-T11 [5 tiền/lượt/auth/xoá] ✗
```
### Gốc #2510 (G10-T07, LEGACYJS-0075 T002, thread 75nt2j): 4 PR chồng lên
```
- #2510 G10-T07, LEGACYJS-0075 T002 [3 backend/CI] ✓
  - #2568 G10-T07, LEGACYJS-0075 T003 [3 backend/CI] ✗
    - #2629 G10-T07, LEGACYJS-0075 T004 [5 tiền/lượt/auth/xoá] ✗
      - #2646 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
        - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
      - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
    - #2646 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
    - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
  - #2629 G10-T07, LEGACYJS-0075 T004 [5 tiền/lượt/auth/xoá] ✗
  - #2646 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
  - #2657 LEGACYJS-0075 [5 tiền/lượt/auth/xoá] ✗
```
### Gốc #2563 (MOCKORG-0086, thread qk9jb5): 4 PR chồng lên
```
- #2563 MOCKORG-0086 [1 tài liệu] ✓
  - #2595 G09-T31, MOCKORG-0086 [4 migration, mig 445/446] ✗
    - #2612 G09-T33 [4 migration, mig 445/446/447/448] ✗
      - #2631 G09-T33b [4 migration, mig 445/446/447/448] ✗
      - #2661 G09-T34 [5 tiền/lượt/auth/xoá, mig 445/446/447/448] ✗
    - #2631 G09-T33b [4 migration, mig 445/446/447/448] ✗
  - #2612 G09-T33 [4 migration, mig 445/446/447/448] ✗
  - #2631 G09-T33b [4 migration, mig 445/446/447/448] ✗
```
### Gốc #2490 (0076, thread m9iarw): 3 PR chồng lên
```
- #2490 0076 [3 backend/CI] ✓
  - #2505 0076 [3 backend/CI] ✓
    - #2529 0076 [5 tiền/lượt/auth/xoá] ✓
      - #2456 — [3 backend/CI] ✓
  - #2529 0076 [5 tiền/lượt/auth/xoá] ✓
```
### Gốc #2501 (G04-T18, ACCOUNTDATA-0100, thread claude/g04-t18-spec-): 3 PR chồng lên
```
- #2501 G04-T18, ACCOUNTDATA-0100 [1 tài liệu] ✗
  - #2562 ACCOUNTDATA-0100, G04-T18 [4 migration, mig 500] ✗
    - #2600 ACCOUNTDATA-0100, G04-T18 [5 tiền/lượt/auth/xoá, mig 504] ✗
      - #2613 G07-T17, ACCOUNTDATA-0100, R127 [2 giao diện] ✗
  - #2600 ACCOUNTDATA-0100, G04-T18 [5 tiền/lượt/auth/xoá, mig 504] ✗
```
### Gốc #2513 (G06-T14, thread sgp64h): 2 PR chồng lên
```
- #2513 G06-T14 [2 giao diện] ✓
  - #2531 G06-T14 [2 giao diện] ✓
    - #2545 G06-T14 [2 giao diện] ✓
  - #2545 G06-T14 [2 giao diện] ✓
```
### Gốc #2515 (G06-T14, thread oifdm9): 2 PR chồng lên
```
- #2515 G06-T14 [2 giao diện] ✓
  - #2531 G06-T14 [2 giao diện] ✓
    - #2545 G06-T14 [2 giao diện] ✓
  - #2545 G06-T14 [2 giao diện] ✓
```
### Gốc #2514 (G04-T13, thread 1gi7il): 2 PR chồng lên
```
- #2514 G04-T13 [5 tiền/lượt/auth/xoá, mig 502] ✓
  - #2544 G04-T09 [5 tiền/lượt/auth/xoá, mig 388] ✓
    - #2577 G04-T16 [5 tiền/lượt/auth/xoá, mig 389] ✓
```
### Gốc #2455 (—, thread ezcetm): 1 PR chồng lên
```
- #2455 — [3 backend/CI] ✓
  - #2456 — [3 backend/CI] ✓
```
### Gốc #2472 (—, thread 97v4ag): 1 PR chồng lên
```
- #2472 — [1 tài liệu] ✓
  - #2483 SCOREPAIR-0102 [1 tài liệu] ✗
```
✓ = đã vào lô, ✗ = còn vướng (xem "Chưa vào lô").
## Đề nghị gộp chuỗi (chỉ đề nghị, chưa gộp)
Nguyên tắc: chỉ nên gộp khi các PR cùng mã nhiệm vụ, nối thẳng một hàng, không có migration, rủi ro ≤ 2, và **chưa** có CR khớp head. Gộp một chuỗi đã CR xong làm mất CR đó và chạy lại CI, nên tốn hơn để nguyên.

| Chuỗi | Đề nghị | Lý do |
|---|---|---|
| #2511 → #2650 (EXAMSPEAK-0072: spec + bằng chứng review T005) | **Gộp được** #2650 vào #2511 | Cùng spec, chỉ tài liệu, cùng chuỗi thread; #2511 còn vướng nên CR một lần cho cả hai |
| #2541 → #2662 (EXAMDRILL-0073: spec + review R164) | **Gộp được** #2662 vào #2541 | Như trên, chỉ tài liệu |
| #2472 → #2483 (đổi số 0088 → 0102 + spec SCOREPAIR-0102) | **Gộp được** | Hai PR tài liệu cùng mục đích (spec cặp điểm); #2483 chưa đủ điều kiện |
| #2557 → #2584 (G08-T14, Listening/0070) | **Gộp được** | Cùng mã nhiệm vụ, cùng thread, cả hai đang vướng, nối thẳng |
| #2599 / #2615 → #2626, #2642 (G08-T18/T19, thread 97v4ag) | Không gộp | Hai gốc khác nhiệm vụ, hai con chồng trên cả hai; gộp thành một PR giao diện rất lớn, khó đọc |
| #2513 / #2515 → #2531 → #2545 (G06-T14) | Không gộp | Cả chuỗi đã vào lô (CR khớp head); gộp phải CR lại |
| #2451 → #2458, #2464 → #2467 | Không gộp | Đã vào lô |
| Chuỗi G04 (gốc #2485, mig 385/387/503/504/505) | Không gộp | Mỗi migration phải áp và kiểm riêng trên staging; tiền/lượt |
| Chuỗi kỳ thi thử #2563 → #2565 (445) → #2595 (446) → #2612 (447, 448) → #2631; #2640, #2661 | Không gộp | Theo `lots-input-g09-mock.md`: từng migration áp và kiểm riêng theo rollout.md; SA đã duyệt #2612 riêng |
| Chuỗi spec gốc (#2460, #2463, #2468, #2469, #2482, #2487) | Không gộp | Là spec mà nhiều PR mã cần có trên `staging` để qua cổng spec; merge spec trước (đều ở lô 1) là đủ |
| #2544 (mig 388/389, single-session) | Không gộp | Migration + auth |

## Kiểm tay trên staging cho lô 1 (sau khi merge, trước lô 2)
Làm trên `staging` bằng tài khoản QA của anh (Browser 1, Mac mini), ghi SHA staging vào kết quả. Không gọi AI trả phí ngoài một lượt chấm Speaking bình thường nếu cần.

| PR | Kiểm gì | Cách làm | Đạt khi |
|---|---|---|---|
| #2630 (concurrency CI, đầu lô 1) | Run cũ của một PR bị huỷ khi có push mới; PR nháp bỏ qua job nặng; check bắt buộc vẫn chạy khi nháp → sẵn sàng | Push hai commit liên tiếp lên một PR thử vào staging; chuyển một PR nháp sang Ready for review; xem tab Actions | Run của commit cũ hiện Cancelled, run mới chạy đủ; PR nháp chỉ chạy job nhẹ; sau Ready for review đủ check bắt buộc chạy lại và xanh. Push lên `staging`/`main` không bị huỷ |
| #2632 (R136, `practice.js`, **không cờ**) | Bản ghi P1/P3 lưu lỗi hoặc quá ngắn không còn kẹt "Đang gửi bản ghi..." | 1) Mở một phiên Speaking P1 (`/practice/session?session_id=…`). 2) Ghi dưới số giây tối thiểu rồi bấm Gửi. 3) Ghi lại câu khác đủ dài, tắt mạng (DevTools Offline) rồi bấm Gửi. 4) Bật mạng, bấm Gửi lại. 5) Lặp bước 2–4 với P3. 6) Một phiên P2: lưu lỗi và bản ghi ngắn vẫn như cũ. | Bước 2: quay về màn ghi âm, còn nút nghe lại và dòng nhắc độ dài, nút Gửi tắt. Bước 3: quay về màn ghi âm với bản ghi cũ, có thông báo lỗi và nút Gửi để thử lại; trang không trắng, không kẹt "Đang gửi bản ghi...". Bước 4: gửi được, lên màn chấm. P2: lưu lỗi hiện thẻ đề có nút thử lại, bản ghi ngắn quay về `p2a`. Console không có lỗi `showState`. |
| #2532 (viền focus margin-note) | Viền focus của số ghi chú lề trong Thư viện hiện lại | Mở một bài Thư viện có ghi chú lề (`/library/...`), bấm Tab tới số ghi chú (nút `sup` và nút số), thử cả màn rộng và màn hẹp, sáng và tối | Có viền 3px theo token `--av2-focus` quanh nút đang focus; DevTools Computed `outline-style` là `solid`, không phải `none` |
| #2454 #2460 #2470 #2472 #2487 #2563 #2564 #2610 #2638 #2652 (chỉ `specs/`, `docs/`) | Không có gì chạy trên trang | Sau khi merge: CI push `staging` xanh trên đúng SHA (gồm "Spec and PR metadata" và Staging E2E) | CI xanh; `validate_specs` trên staging pass. Không cần kiểm giao diện |

Ghi kết quả vào hàng của từng PR (đạt/chưa đạt, SHA staging, giờ). Một mục chưa đạt thì dừng trước lô 2 và báo anh.

## Kiểm tay trên staging cho lô 2 và lô 3 (sau khi merge, trước lô kế tiếp)

Thread t9dexw, 23/11/2026, khoảng 14:15Z. Soạn theo mẫu "Kiểm tay trên staging cho lô 1" trong `MERGE-LOTS-20261123.md`. Danh sách PR lấy theo bảng tóm tắt lô lúc 14:10Z:
- lô 2: 9 PR;
- lô 3: 17 PR.

#2494 đã ra khỏi lô 2, #2630 đã lên lô 1.

**Chung cho mọi dòng:**
- Kiểm trên `staging` bằng tài khoản QA của anh (Browser 1, Mac mini). Ghi SHA staging và giờ vào kết quả.
- Trước khi kiểm tay: CI push `staging` phải xanh trên đúng SHA đó, gồm Staging E2E.
- **Không chạy AI trả phí.** Không có dòng nào dưới đây cần chấm bài.
- **Không đổi env hay cờ trên Railway/Vercel** nếu anh chưa gõ duyệt. Các dòng có cờ ghi rõ: kiểm ở trạng thái cờ mặc định, và bước bật cờ là tuỳ chọn, cần anh duyệt.
- Mục nào chưa đạt thì dừng trước lô kế tiếp và báo anh.
- Kiểm cả ba chỗ: console trình duyệt không có lỗi đỏ mới, Network không có 5xx, và Railway log của backend staging không có traceback mới trong lúc kiểm.

### Lô 2 (giao diện, PR gốc)

| PR | Kiểm gì | Cờ | Cách làm | Đạt khi |
|---|---|---|---|---|
| #2459 (chrome `aver-chrome.js`, **không cờ**, chrome dùng chung) | Link "Sang khu giáo viên" và "Sang khu quản trị" trong menu tài khoản chỉ hiện đúng vai trò | không | 1) Đăng nhập admin, mở menu tài khoản trên một trang học viên dùng chrome cũ, ví dụ `/home`. 2) Mở cùng trang bằng một tài khoản giáo viên thử (nếu có) và một tài khoản học viên thử. 3) DevTools Elements: tìm `a[href="/admin"]` và `a[href="/instructor"]`. 4) Thu hẹp màn xuống khoảng 375px. | Admin thấy cả hai link, nằm trước "Đăng xuất". Giáo viên chỉ thấy "Sang khu giáo viên". Học viên không thấy link nào, và **DOM không có** `href="/admin"` hay `href="/instructor"`. Màn hẹp không tràn ngang. Console sạch |
| #2466 (G09-T19, Ctrl/⌘K, backend `POST /admin/search`) | Tìm nhanh cho admin và giáo viên | không | 1) Trên `/admin`, bấm Ctrl/⌘K, gõ tên một học viên thử, rồi một mã lớp. 2) Gõ nhanh hai từ liên tiếp. 3) Mở `/instructor` bằng tài khoản giáo viên (nếu có), làm lại bước 1. 4) Học viên: Ctrl/⌘K không mở gì. | Hộp tìm mở và Esc đóng được. Kết quả theo đúng **từ khoá cuối**, không hiện kết quả của từ khoá trước (HOLD FR-010). Giáo viên chỉ thấy học viên và lớp của mình. Bấm một kết quả thì mở đúng trang. Network: `POST /admin/search` 200, không 5xx |
| #2476 (G01-T11, xoá `source_material/`, dời `commission/`) | Không có gì chạy trên trang | không | Chỉ cần CI push `staging` xanh trên đúng SHA | CI xanh |
| #2492 (G03-T10, AudioPlayer và VideoFrame trong `/ui-library`) | Hai component mới trên trang mẫu | `/ui-library` chỉ mở khi `AVER_ENABLE_UI_LIBRARY` bật | Nếu staging đã bật cờ: mở `/ui-library`, tới mục media. 1) Phát, tạm dừng, tua AudioPlayer; Tab tới các nút. 2) VideoFrame: bấm "Xem trên YouTube". Nếu staging chưa bật cờ: chỉ cần CI xanh, **không tự bật** (bật cần anh duyệt) | AudioPlayer phát và tua được, có viền focus, có nhãn cho trình đọc màn hình. "Xem trên YouTube" chỉ mở `youtube.com` hoặc `youtu.be` (HOLD `safeYoutube`). Sáng và tối đều đọc được |
| #2513 (G06-T14a, trang bài Grammar, công khai) | Trang bài Grammar trên khuôn đọc mới | không | 1) Không đăng nhập, mở 2–3 bài `/grammar/<category>/<slug>` (có một bài dài). 2) Màn hẹp khoảng 375px. 3) Đăng nhập rồi bấm lưu bài. 4) Mở một slug sai. | Bài hiện đủ nội dung, mục lục và liên kết "bài tiếp". Màn hẹp không có thanh mời khách che nội dung. Lưu bài được khi đã đăng nhập. Slug sai ra trang không tìm thấy. Console sạch |
| #2515 (G06-T14b, trang chủ Grammar Wiki, công khai) | Chỉ mục nhóm, A–Z, tìm không dấu | không | 1) Mở `/grammar`. 2) Gõ một từ **không dấu** (ví dụ "menh de"). 3) Bấm một nhóm, rồi bấm "Lỗi hay gặp". 4) Tải lại trang. | Tìm không dấu ra bài có dấu. Nhóm được đánh số 1…N. Nhóm đang chọn nằm trên URL và giữ nguyên sau khi tải lại. Liên kết mở đúng bài |
| #2520 (G06-T15, Từ vựng `/vocabulary`, công khai) | Tra từ, trang từ, nút nghe | không | 1) Không đăng nhập, mở `/vocabulary`, tìm một từ có thật. 2) Mở trang của từ đó, bấm nút nghe. 3) Tìm một từ không có. | Có kết quả. Trang từ có nghĩa, phát âm và nút nghe phát được. Từ không có hiện khối "không tìm thấy", không trắng trang. Danh sách không bị cắt ngắn: số từ hiện ra khớp tổng ghi trên trang. Lỗi đọc danh sách hiện lỗi, không hiện danh sách thiếu |
| #2569 (R99, phiếu duyệt thi thử admin) | Chú thích dưới ô band được hiện lại | không | 1) `/admin/mock-reviews`, mở một hồ sơ ở trạng thái chưa trả kết quả (chỉ xem, **không bấm "Lưu & chốt band" hay "Trả kết quả"**). 2) Xem dưới từng ô band. | Mỗi ô band có dòng chú thích nguồn (band gợi ý, chưa có, hoặc vì sao được để trống, ví dụ Speaking). Hồ sơ đã trả kết quả thì các ô bị khoá. Không có request ghi nào trong Network |
| #2644 (G09-T12, sổ mã kích hoạt `/admin/activation-codes`) | Trang sổ mã và bộ lọc trạng thái | không | 1) Mở `/admin/activation-codes`. 2) Lọc lần lượt chưa dùng, đã dùng, hết hạn nhập, đã thu hồi. 3) Mở `/admin/activation-codes/new`. 4) Từ `/admin/users`, bảng mã: chỉ xem, **không thu hồi**. | Trang mở trong shell admin (có thanh bên). Mỗi trạng thái lọc đúng; mã đã dùng có người và ngày. Không có nút "tạo mã" ở đây (mã cấp từ trang lớp). `/new` ra trang không tìm thấy. Nếu không đọc được ngưỡng thì trang báo, không đoán. Xem thêm: sau khi #2535 vào, trang phải dời vào `(authed-admin)` (`lots-input-lot10-11-diff.md`) |

### Lô 3 (backend/CI, PR gốc)

| PR | Kiểm gì | Cờ | Cách làm | Đạt khi |
|---|---|---|---|---|
| #2451 (G06-T06, giới hạn media Thư viện theo IP) | Media Thư viện vẫn tải bình thường; vượt giới hạn thì nhận 429 | không | 1) Mở một bài Thư viện có ảnh hoặc âm thanh, tải lại vài lần. 2) Tuỳ chọn, từ một máy (không phải trình duyệt QA), gọi nhanh hơn 120 lần/phút vào một URL media của `/api/library/...`, rồi dừng 1 phút. | Bước 1: media hiện bình thường, không 429. Bước 2: sau khoảng 120 lần thì 429 có `Retry-After`, sau 1 phút lại 200. Thân 429 không lộ id hay đường dẫn item |
| #2455 (Writing Deep: ghi model theo từng pass) | Ghi model chấm đúng | không | **Không chạy bài Deep mới để kiểm** (trả phí). Chỉ cần CI xanh. Khi có lượt Deep tự nhiên tiếp theo (hoặc lần chạy lại bài b2d02b25 ngày 2/12 đã lên lịch): mở bản ghi chi phí AI của lượt đó trong `/admin/usage` | `model_used` là model của Pass 1 (Claude hoặc Gemini). `tier_metadata` có model của pass 2/3. Chi phí ghi theo đúng nhà cung cấp |
| #2464 (G09-T04c, API chi phí AI và nhật ký của học viên, chỉ GET) | Hai route mới cho admin | không | Trên trình duyệt đã đăng nhập admin, mở trực tiếp `/api/admin/learners/<ref>/ai-cost` và `/api/admin/learners/<ref>/log` bằng `<ref>` của học viên thử (hoặc qua tab có dùng API này, nếu đã có). Tài khoản học viên gọi cùng URL | Admin nhận 200 JSON. Nhật ký chỉ hiện **mã kích hoạt đã che** (HOLD FR-027), không bao giờ hiện nguyên mã. Học viên nhận 403 |
| #2477 (G01-T12, xoá 14 script một lần) | Không có gì chạy trên trang | không | Chỉ cần CI xanh | CI xanh |
| #2478 (G01-T13, bỏ build Tailwind thứ hai) | CI build và các trang dùng CSS Tailwind | không | 1) CI xanh, gồm job build. 2) Mở nhanh `/home`, một trang luyện, `/admin`; so giao diện với trước khi merge. | Không có trang nào mất style. Network không có 404 cho `tailwind.inter.css` |
| #2479 (G01-T15, xoá SQL apply cũ của Reading) | Không có gì chạy trên trang | không | Chỉ cần CI xanh. Không phải migration, không áp gì | CI xanh |
| #2480 (G10-T15-1, dời `/admin` và `/admin/usage` vào `(authed-admin)`) | Hai trang admin trong route group mới | không | 1) Mở `/admin`, rồi chuyển sang `/admin/usage` bằng thanh bên (điều hướng phía client), rồi tải lại. 2) Tài khoản học viên mở `/admin`. | Cả hai trang có shell admin, có số liệu, không trắng. Chuyển client và tải lại đều ra cùng nội dung. Học viên bị chặn như cũ. Console sạch |
| #2490 (0076, `routers/admin` thành package, **đổi import mọi router admin**) | Backend admin vẫn trả đủ | không | Merge riêng một mình. Sau khi deploy: 1) Mở `/admin`, `/admin/users`, `/admin/usage`, bảng mã trong `/admin/users`, `/admin/mock-reviews`. 2) Xem Railway log lúc khởi động. | Mọi trang tải được dữ liệu, không 404 hay 5xx ở `/api/admin/*`. Log khởi động không có `ImportError`. `/docs` (nếu mở) vẫn liệt kê route admin |
| #2493 (MEDIAOUT-0078, rewrite media Advanced Vocab cũ, **sau cờ**) | Khi tắt cờ thì không đổi gì | `AVER_ADVANCED_VOCAB_LEGACY_REWRITE` (mặc định tắt) | Cờ tắt: mở một bài Advanced Vocab có ảnh hoặc âm thanh. Bước bật cờ chỉ làm khi anh duyệt env riêng | Cờ tắt: media tải như trước, không có rewrite (URL vẫn là `/assets/advanced-vocab/...`). Script sync không chạy khi merge |
| #2497 (G06-T20, `/admin/library`, admin ghi nội dung) | Trang quản lý Thư viện | không | 1) Mở `/admin/library`, lọc, mở một bài. 2) **Chỉ xem.** Không publish hay sửa bài thật. Nếu cần kiểm ghi, dùng một bài nháp thử và anh đồng ý trước. 3) Thử publish một bài chưa duyệt (nếu có bài thử). | Trang có shell admin và danh sách đúng. Bài chưa duyệt không publish được và báo `E_NOT_APPROVED` đúng chữ (HOLD). Không publish được slug `index`. Tài khoản học viên bị chặn |
| #2498 (G06-T03b, script nhập bài mẫu Writing) | Không chạy gì khi merge | không | Chỉ cần CI xanh. **Không chạy `--execute`** trên staging hay prod nếu anh chưa duyệt riêng | CI xanh |
| #2502 (G06-T10, `proxy.ts`: 404/308 thật cho bài mẫu Writing; bảo mật/định tuyến) | Mã HTTP thật | không | Dùng `curl -sI` (không cần đăng nhập) vào: 1) một `/library/writing-samples/<slug>` có thật; 2) một slug sai; 3) một slug cũ đã đổi (lấy từ API hoặc sổ đổi slug, nếu có); 4) một trang Thư viện khác và `/home`. | (1) 200. (2) **404 thật**, không phải 200 kèm trang lỗi. (3) **308** tới đúng `Location` mà API trả (HOLD FR-019). (4) Không đổi: header CSP và mã trạng thái như trước |
| #2510 (G10-T07-W1, bỏ 15 `admin-listening-*.js`) | Các trang admin Listening chạy bằng bản Next | không | Mở `/admin/listening`, `/admin/listening/attempts`, `/admin/listening/audit`, mở chi tiết một audit và một nội dung. Chỉ xem | Mọi trang có dữ liệu. Network không có 404 cho `/js/admin-listening-*.js`. Console sạch |
| #2522 (G06-T13, CSP cho YouTube trên trang đề Speaking; bảo mật) | CSP chỉ nới cho một route | không | `curl -sI` vào `/library/speaking/<slug>` và một trang khác (ví dụ `/grammar`). Nếu #2521 chưa vào (route chưa có trang), chỉ kiểm header | Route Speaking: `script-src` có `https://www.youtube.com/iframe_api` và `https://www.youtube.com/s/player/`, `frame-src` có `https://www.youtube-nocookie.com`. Trang khác: **không** có `youtube`. Sau khi #2521 vào: video phát, console không có lỗi CSP |
| #2534 (gói audit Cambridge B, offline) | Không có gì chạy trên trang | không | Chỉ cần CI xanh | CI xanh |
| #2548 (Q46, `dependabot.yml`) | Không có gì chạy trên trang | không | CI xanh. Tab Insights › Dependency graph › Dependabot không báo lỗi cấu hình | CI xanh, Dependabot đọc được cấu hình |
| #2645 (G09-T39, hàng yêu cầu chấm lại Writing) | Trang `/admin/writing/regrade-requests` | không | 1) Mở trang, lọc theo trạng thái và lớp. 2) **Không quyết định yêu cầu thật.** Mở hộp "Giữ nguyên điểm", gõ dưới 40 ký tự rồi xem nút. 3) Để trang mở 2–3 phút. | Danh sách có cột thời gian chờ, chạy theo thời gian thật. Yêu cầu quá `regrade_hours` được đánh dấu quá hạn. Nếu không đọc được ngưỡng thì trang báo "chưa đọc được ngưỡng". "Giữ nguyên điểm" dưới 40 ký tự thì không gửi được. Không có request ghi nào trong Network |

Ghi kết quả vào hàng của từng PR: đạt hay chưa đạt, SHA staging, giờ. Các PR chỉ cần CI xanh:
- lô 2: #2476;
- lô 3: #2455, #2477, #2479, #2498, #2534, #2548.

**Thêm sau 14:10Z:** #2619 vào lô 2 (CR delta giữ duyệt, comment 7103401327, chỉ thêm `box-sizing: border-box`): mở trang có thành phần đó ở màn hẹp, không bị tràn ngang; còn lại chỉ cần CI xanh.

## Chặn của anh Andy (comment từ tài khoản anh, không có chân Claude)
| PR | Trạng thái | Chặn gần nhất (rút gọn) |
|---|---|---|
| #2451 | đã gỡ | **HOLD contract media (`b6bed344`)**: [LIBRARY-0061 §5.5](https://github.com/andyvinhtran1 |
| #2460 | đã gỡ | **HOLD duyệt đặc tả FR-003, không chặn việc soạn draft:** FR-003 yêu cầu LearnerShell có l |
| #2461 | đã gỡ | **HOLD duyệt FR-025/FR-078: tải trang không đồng nghĩa học viên đã xem kết quả.** [Plan ở  |
| #2462 | đã gỡ | **HOLD FR-104: Writing/chấm lại chưa giới hạn theo lớp của giáo viên.** Ở `d4468bd5`, [`_s |
| #2463 | đã gỡ | **HOLD duyệt FR-059 tại PR gốc (`14a6b494`).** Đã đối chiếu các phát hiện Codex trên stack |
| #2464 | đã gỡ | **HOLD FR-027: không đưa mã kích hoạt nguyên vẹn vào Nhật ký hệ thống.** Ở `1bf856c4`, [ng |
| #2465 | đã gỡ | **HOLD FR-010: ô tìm nhanh vẫn mở được kết quả của từ khóa trước.** Ở `14c7a12d`, [`run()` |
| #2467 | đã gỡ | **HOLD FR-025: điểm Reading/Listening không nên tự gắn mẫu số 40.** Ở `0fc3aae3`, [`_test( |
| #2468 | đã gỡ | **HOLD duyệt phần video riêng (FR-041/042/049).** [Plan ở `a00008ff`](https://github.com/a |
| #2469 | đã gỡ | **HOLD — RESULTSHEET-0065 cần một đường lùi không mất dữ liệu** (`0145519`, `specs/0065-re |
| #2471 | đã gỡ | **HOLD FR-032: kết quả ghi chú phải phản ánh đúng dữ liệu đã lưu** (`845ddd41`, `backend/s |
| #2480 | đã gỡ | **HOLD merge — thiếu bằng chứng FR-005 cho hai route mới (`e64c2561`, base `cc6dd4c8`).**  |
| #2481 | đã gỡ | **HOLD duyệt FR-082 — cần khóa công bố điểm mock ở API kết quả (`1b4bf6ce`).**  Plan đưa c |
| #2482 | đã gỡ | **HOLD duyệt bản sửa đổi 2 — FR-094 chưa ràng buộc 2 ngoại lệ với cờ ở máy chủ (`7c711f79` |
| #2483 | đã gỡ | **HOLD duyệt thiết kế migration 480 (`59adf8f5`) — hai đường xoá chưa khớp FR-003.**  1. ` |
| #2484 | đã gỡ | **HOLD duyệt FR-100 — lối tự luyện cần ghi rõ hai cổng truy cập (`1a3b200a`).**  - Sở hữu  |
| #2485 | đã gỡ | **HOLD FR-002 — API công khai có thể hiện học phí đã nhập trước của khóa “sắp mở” (`37de4c |
| #2487 | đã gỡ | **HOLD duyệt EXAMROOM-0066 (`7885ad12`) — cần tách hết giờ và đã nộp.** FR-018 hiển thị “Y |
| #2488 | đã gỡ | **HOLD FR-010/011 — link thư viện cũ có thể báo sai là không có đề (`6567e41c`).** API giữ |
| #2489 | đã gỡ | **Bổ sung HOLD FR-110 ở PR gốc: cách xử lý trùng của Q14 chưa thể mở khoá migration.** Q14 |
| #2491 | đã gỡ | **HOLD FR-119/124 — không hiện tài liệu khi chưa xác minh lớp còn hoạt động (`ae7792f3`).* |
| #2492 | đã gỡ | **HOLD VideoFrame — nút “Xem trên YouTube” chưa ràng buộc đích (`2e8704f4`).** `safeYoutub |
| #2493 | đã gỡ | **HOLD bằng chứng phục hồi FR-005 (`71f9f18b`).** `restore_legacy()` nhận thư mục nguồn nế |
| #2494 | đã gỡ | **HOLD `TimeField` — giờ bị khoá vẫn được nhận khi gõ tay (`2e04fae4`).** `unavailable` ch |
| #2495 | đã gỡ | **HOLD FR-012 — điều kiện hết giờ phải có ở lần ghi `abandon` (`a17aa04b`).** Contract yêu |
| #2497 | đã gỡ | **HOLD xuất bản Writing mẫu — có `source_review_status` không đồng nghĩa đã duyệt (`bec4b7 |
| #2498 | đã gỡ | **HOLD định tuyến bài mẫu Writing (`9c764f9d`) — dành riêng slug `index` ngay ở đường nhập |
| #2499 | đã gỡ | **HOLD `OverallBlock` trước khi nối trang điểm (`5843e3f5`).** Điều kiện hiện Overall chỉ  |
| #2500 | đã gỡ | **HOLD FR-008/010/011 — không hứa giữ bản nháp nếu chưa xác nhận ghi được (`bab86c25`).**  |
| #2501 | **còn** | **Cần sửa số migration trong amendment 2 (`3973f1c4`) trước khi chốt tài liệu.** `backend/ |
| #2502 | đã gỡ | **HOLD FR-019: chỉ phát 308 từ đích chuẩn của API (`543f2804`).** PR nói bỏ qua `Location` |
| #2504 | đã gỡ | **HOLD FR-009 — bản nháp cũ không có mốc để tự gửi lại (`e8d45a68`).** `createProgrammeAns |
| #2507 | đã gỡ | **HOLD FR-035 trên `3be7cde2`: giữ kiểu dữ liệu khi lưu và so `baseValue`.** Spec 0066 yêu |
| #2509 | đã gỡ | **HOLD FR-007 — xác nhận lưu cuối không phải xác nhận đã nộp (`03d0cfc4`).** Nhánh `confir |
| #2510 | đã gỡ | **HOLD bằng chứng lớp 2 FR-001 trước khi gỡ 15 script W1 (`651cbd05`).** Báo cáo thu reque |
| #2511 | đã gỡ | **HOLD FR-008: phân biệt bản ghi lần đầu và bản ghi lại (`9c346dbe`).** Hộp mới nói sẽ dùn |
| #2516 | đã gỡ | **HOLD FR-071 trên `430e25cf`: không đánh dấu đã xử lý lỗi mới trong lượt quét bù.** Mốc ` |
| #2518 | đã gỡ | **Chặn phần `exit.locked` trên `007e6a2b`: thao tác rời phòng đang chờ lưu vẫn có thể điều |
| #2519 | đã gỡ | **HOLD FR-060/061 — tải lại trong lúc đổi dấu có thể khoá nút vĩnh viễn (`b7aa7b80`).** `l |
| #2528 | đã gỡ | **HOLD FR-030 (`8686dccc`): khóa chỉnh Highlight/Note ngay khi hết giờ hoặc chuyển sang ch |
| #2538 | đã gỡ | **HOLD FR-009 (`6d890f87`): không để bản nháp cũ ghi đè bản sao hiện tại.** `migrateLegacy |
| #2539 | đã gỡ | **HOLD FR-019 (`7d0c17a5`): kiểm tra HTTP sau khi ẩn một đề đã được cache.** Khi `speaking |
| #2540 | **còn** | **HOLD FR-007 (`a06bacf6`): thiếu dữ liệu máy chủ không có nghĩa kỳ thi đã đóng.** `mockSu |
| #2543 | đã gỡ | **HOLD (`1de1cfb7`): cô lập dữ liệu Today theo tài khoản.** `HomeTreeSwitch` giữ cùng inst |
| #2544 | đã gỡ | **HOLD FR-040/041 (`b0f74e8c`): bảo vệ lượt thi có giờ trong suốt thao tác thu hồi phiên.* |
| #2546 | **còn** | **HOLD FR-060 (`cd91b8d8`): cột “Của bạn” phải theo đúng ID tài khoản.** Trang chỉ truyền  |
| #2549 | **còn** | **HOLD FR-012 trên `67d26657`: lượt đã bỏ không nên còn hiện trong lịch sử Listening.** PR |
| #2550 | **còn** | Cập nhật HOLD FR-048 trên `7dfdeef3`: lần đọc lại đã thu hẹp khoảng hở, nhưng `_still_purg |
| #2551 | **còn** | **HOLD FR-007 (`6f6aa802`): theo dõi cả lượt giám thị thu, không chỉ lượt tab tự nộp.** Nh |
| #2554 | **còn** | `a11f4b73` đã xử lý ca thiếu lượt sau khi lưu điểm. **Còn chặn FR-015 ở chiều ngược lại:** |
| #2555 | **còn** | **Chặn merge trên `3323036a`: chuyển quyền giữa hai tab có thể nộp bản Writing cũ thay cho |
| #2557 | **còn** | **Chặn merge @ `69ef254a`: Listening có thể kẹt ở trạng thái chưa xác nhận sau lỗi nộp bài |
| #2558 | đã gỡ | **Chặn merge @ `db662db2`: luồng Listening có thể mở quyền ghi từ bản đáp án cũ.** Bản mở  |
| #2561 | **còn** | **Chặn merge trên `a26ddc8`: nút “Chỉ lưu ghi chú” có thể đổi trạng thái nhóm và đóng cả b |
| #2565 | **còn** | **Chặn migration 445 trên `85ce42df`: hai FK `ON DELETE SET NULL` tạo trạng thái mà CHECK  |
| #2571 | **còn** | **Chặn merge trên `8d17b4be`: kiểm tra “đã lưu trữ thì không sửa được” chưa nằm trong lệnh |
| #2572 | đã gỡ | **Chặn merge trên `2785ae5a`: phần dữ liệu riêng ở `/account` và `/progress` chưa gắn với  |
| #2585 | **còn** | **Chặn merge trên `ea022085`: gửi lại cùng `request_key` có thể cấp quyền và lượt mới.** R |
| #2590 | **còn** | **Chặn merge @ `05b4ccf0`: hộp thoại đăng xuất báo đã lưu nháp nhưng chưa có đường lưu.**  |
| #2595 | **còn** | **Chặn merge @ `bf732dca`: backfill 446 có thể mở rộng danh sách thi đã chốt.** `446_mock_ |
| #2598 | đã gỡ | **Chặn merge @ `5ef971b5`: trạng thái «đã đăng ký» không gắn với tài khoản.** `OpenAlertTo |
| #2600 | đã gỡ | **Chặn merge @ `ccff5d6e`: luồng xoá tài khoản xoá luôn dấu vết lease export trước khi kiể |
| #2612 | đã gỡ | **Chặn merge @ `bb679451`: trả từng phần có thể báo đã trả dù không cập nhật được lượt thi |
| #2613 | đã gỡ | **Chặn merge @ `1364b572`: mục «Dữ liệu của tôi» kẹt tải dưới React Strict Mode.** `DataEx |
| #2624 | đã gỡ | **Chặn merge @ `cd44eb78`: lỗi đọc cờ có thể chọn đường xoá không khoá.** Ở `backend/jobs/ |
| #2627 | đã gỡ | **Chặn merge @ `b79529e7`: danh sách đơn không được gắn với tài khoản hiện tại.** `OrdersP |
| #2633 | đã gỡ | **Chặn merge @ `7d88e8a4`: lần cấu hình ban đầu có thể ghi đè đề của kỹ năng không có tron |
| #2640 | **còn** | **Chặn merge @ `41bc3404`: lưu hạn thi tự làm có thể báo thành công nhưng học viên vẫn nhậ |
| #2643 | đã gỡ | **Chặn merge @ `87db3598`: có thể trộn sổ lượt hoặc ghi nhầm học viên khi đổi người đang x |
| #2649 | đã gỡ | **Chặn merge @ `4dd96c66`: tab chưa được cấp quyền vẫn có thể bắt đầu ghi hoặc gửi.** `use |
| #2653 | **còn** | **Chặn merge @ `e5723e5c`: CSV chưa bảo đảm ô văn bản được mở dưới dạng văn bản.** `activi |
| #2654 | **còn** | **Chặn merge @ `70496166`: bước xác nhận có thể cấp quyền theo danh sách học viên cũ.** Tr |
| #2655 | đã gỡ | **Chặn merge @ `91fae480`: công cụ QA báo đã gửi lỗi thử ngay cả khi POST không tới máy ch |
| #2658 | đã gỡ | **Chặn merge @ `9dacdeaa`: request công khai có thể chặn event loop khi cache hết hạn.** ` |
| #2660 | đã gỡ | **Chặn merge @ `f112084a`: gắn cấp/thu hồi quyền với đúng admin và học viên.** `openGrant( |
| #2661 | đã gỡ | **Chặn merge @ `205ab0fe`: hộp xác nhận giám thị có thể gửi lệnh khác với nội dung đang hi |

"Đã gỡ" chỉ tính khi có lời gỡ của anh **sau** comment chặn cuối: lệnh 10:19Z (35 PR andy-holds), 10:57Z, 11:14Z #2511, 11:39Z #2544, 11:48Z #2572, 13:21Z (#2558 #2600 #2612 #2613 #2624 #2627 #2633 #2643), 13:23Z #2598, 13:40Z #2658 #2661, 13:41Z #2655. Nhiều chặn "còn" đã có bản sửa và CR delta duyệt; chúng vẫn chờ anh gõ gỡ.

## Chưa kiểm được trong bảng này
- **Đọc diff thật lô 2 và 3** (thread CR/SA, `team/queue/lots-input-lot2-3-diff.md`, 13:52Z): không có chuỗi xếp chồng ẩn, không migration. Merge thử lô 1 → 2 → 3 chỉ vướng **#2494 xung đột với #2492** (ui-library `page.tsx`, `ui-library.module.css`, `components/ui/index.ts`): #2494 đã chuyển ra sau #2492, tác giả merge staging vào rồi chờ CI. Cây gộp 35 PR: tsc sạch, validate_specs pass, vitest 1401/1401, pytest 22 file lô 3 được 1275 pass. Chỉnh rủi ro: #2502 (`proxy.ts`) và #2522 (CSP) là bảo mật/định tuyến, kiểm 404/308 trên staging sau merge; #2490 đổi import mọi router admin, merge riêng một mình; #2459 là chrome dùng chung, không cờ; #2464 và #2497 là route chỉ admin (`require_admin`), #2497 ghi nội dung Library; #2630 và #2478 đổi CI (đã kiểm: check bắt buộc vẫn chạy lại khi draft → ready).
- **Đọc diff thật lô 4 và 5** (thread RFJd, `team/queue/lots-input-lot4-5-diff.md`, 13:55Z): không có chuỗi xếp chồng ẩn; chín PR chồng trên head cũ của #2485. Xung đột khi merge thử (đều là hai phía cùng thêm dòng, tác giả PR sau merge staging vào): #2516 sau #2471 (`register.tsv`, `forward-policy.tsv`), #2521 sau #2519 (`library.py`, danh sách miễn `activation_gate`), #2544 sau #2514 (`migrations/README`, câu trạng thái sửa tay), và khi lô 1–3 vào trước: #2471 sau #2464 (models, sinh lại `api.d.ts`), #2519 sau #2451 (fake db của test). Các thứ tự này đã vào cột "Vào trước". Mức rủi ro thật: #2466 #2644 là giao diện (mức 2); #2455 #2521 #2645 là mức 3; bảng đã chỉnh. #2502 (`proxy.ts`) và #2522 (CSP) xếp mức 3 (bảo mật/định tuyến). Migration 442, 451, 401, 502, 388 chưa áp trên staging; 388 có ở #2577 vì chồng trên #2544 (file giống hệt). #2521 và #2451 là PR của thread RFJd nên các dòng đó cần người khác xác nhận.
- **Đọc diff thật lô 8 và 9** (thread CR/SA, `team/queue/lots-input-lot8-9-diff.md`, 13:56Z): 8 PR merge riêng lên staging đều sạch; merge chồng lên lô 1–7 có xung đột, chủ yếu ở sổ migration và route ledger (file ghi rõ PR nào). #2525 **không** chứa #2524 (hai PR anh em cùng chồng trên #2461); bảng vẫn giữ "#2525 sau #2524" theo thứ tự tác giả G07 đề xuất (cờ `learner_v2` trước), không phải vì chứa nhánh. Chuỗi thật: #2591 trên #2463 → #2461 → #2460; #2617 trên #2468 → #2463 → #2461 → #2460. **Chuỗi ẩn:** 12 PR mang head cũ `e164f5f7` của #2525 (#2573 #2578 #2580 #2588 #2596 #2602 #2621 #2622 #2628 #2633 #2635 #2636), đã ghi "vào sau #2525"; cả 12 phải merge staging vào sau khi #2525 merge. #2567 và #2594 hạ xuống mức 2 (chỉ dời layout admin, quyền vẫn ở `(authed-admin)/layout.tsx`, không backend). Migration 420 (#2525) và 394 (#2591) là `pending_feature`, có dòng trong sổ, không trùng số.
- **Kiểm lại hai dòng của thread RFJd** (thread tiếp quản, 13:58Z): #2521 giữ mức 3: backend `library.py` thêm 3 route GET công khai `/api/library/speaking*`, thêm đúng 3 dòng miễn "public Library" trong `activation_gate.py` (chỉ trả hàng `published`), script import, giao diện Thư viện và `next-native-browser.yml`; không migration, không tiền/auth khác. #2451 giữ mức 3: `library.py` + `services/library_media.py` + test, không migration. Thứ tự "#2521 sau #2519" và "#2519 sau #2451" khớp file chạm chung (`library.py`, fake db test).
- **#2665** (mở sau lúc quét, chưa có trong bảng chính): anh Andy đã gỡ chặn lúc 13:59Z. Phải merge **sau #2644**; câu "merge #2665" nghĩa là anh Andy chấp nhận **Deviations 2** của PR đó.
- **#2630 đã merge vào staging** lúc 17:01:57Z 23/11 (merge commit `caf42e6b`), theo lời anh Andy "merge #2630", trước lô 0. Đã merge, chưa nghiệm thu: kiểm trên staging CI rằng run cũ của PR bị huỷ khi có push mới, còn push `staging`/`main` không bị huỷ (dòng #2630 trong bảng kiểm tay lô 1).
- **#2470 (lô 1), comment của anh Andy 05:20Z (Hold 4 của #2450):** "48h: pending" đã ghi ở db2f2389 (CR R1 duyệt 10:33Z). Điều kiện không merge trước promote #2450 tự thoả vì mọi lô chạy sau #2450. Sau promote, `verification.md` của #2470 vẫn ghi "48h: pending", nên có thể phải cập nhật kết quả 48 giờ trước khi merge lô 1. Rà lô 1–3 (39 PR) không thấy chặn mới nào của anh sau 13:33Z.
- **Đọc diff thật lô 6 và 7** (`team/queue/lots-input-lot6-7-diff.md`, merge thử lô 1 → 7 trên staging `cc6dd4c8`):
  - Chuỗi ẩn #2461 giữa #2460 và #2463 (khớp với lô 10–11). Tiêu đề #2461 vẫn ghi "chờ Andy duyệt", cần sửa tiêu đề trước khi merge.
  - #2465/#2466, #2531/#2515, #2456/#2455: "Vào trước" chỉ là phụ thuộc logic, PR sau không chứa commit của PR trước.
  - **Bảy PR chồng trên bản cũ của PR cha, phải merge staging vào trước khi merge:** #2507 và #2659 (trên #2487), #2526 (trên #2485), #2577 (trên #2544), #2552 và #2566 (trên #2526).
  - **Xung đột khi merge thử:** chỉ `api.d.ts` (sinh lại): #2526, #2566. ui-library với #2492: #2465, #2537. Route ledger: #2535, #2553. `proxy.ts`: #2539. Sổ migration: #2577 (cùng lỗi #2544). `admin/__init__.py`: #2529 với #2456, nên #2456 đã chuyển ra **sau #2529**. **`credits.py` (xung đột code thật): #2552.** Lô trước còn #2494, #2471, #2519, #2544.
  - #2577 mang cả migration 388 của #2544; migration riêng của nó chỉ có 389.
  - Hạ rủi ro: #2659, #2535, #2553 xuống mức 2; #2539 xuống mức 3.
- **Đọc diff thật lô 12–14** (`team/queue/lots-input-lot12-14-diff.md`): 8 PR merge sạch, kể cả khi chồng lên head hiện tại của PR cha. #2556 **không** chứa #2482; chuỗi thật là #2460 → #2461 → #2524 → #2556 (đã sửa cột "Vào trước"). #2573 và #2580 chồng trên bản cũ của #2525 và #2484, nên merge staging vào sau khi hai PR đó vào. Migration 421 (#2606) là pending_feature, không trùng số.
- **PR chưa xếp dưới #2560:** **#2536** đã đưa vào lô (2/2 thread đã resolve lúc 14:04Z, CR khớp head, không HOLD; sau #2521). #2474 (lô 2) và #2475 (lô 1) chờ CI xong mới vào lô. #2543 @865eebfc: Review A giữ duyệt, không cần CR delta; HOLD 10:28Z của anh Andy còn. #2462 @d5cc21d0: CR delta đạt (review 6022997021, as_instructor chỉ lấy lớp của giáo viên đó, mục tiêu sai bị từ chối 403/503, audit fail-closed, local 286 pass, 0 thread mở); anh Andy gỡ HOLD lúc 14:04:35Z, nên #2462 đã vào lô 5 (PR gốc, mức 5 vì auth giáo viên). #2649 (a8b43c62): CR delta duyệt 13:45Z, 0 thread mở, anh Andy gỡ chặn 14:04:35Z, đã vào lô theo #2487.
- **Rà PR chưa xếp, nửa trên** (`team/queue/lots-input-unplaced-hi.md`): đưa vào lô #2619 (lô 2), #2623 → #2637 → #2648 (lô 11–13, mức 2 sau cờ `AVER_PUBLIC_COMMERCE` tắt mặc định; chỉ bật cờ sau khi #2485 lên). #2660: anh Andy gỡ chặn 13:49Z, CR delta @39bbac14 duyệt, thread đã resolve, nhưng vẫn chờ #2601 vào lô. #2601: anh Andy gỡ cả hai chặn (13:57Z, 14:04Z) lúc 14:19:38Z, head mới cf296d01 (CR delta đạt, review 6023232695, 0 thread mở); #2601 vẫn chưa vào lô vì chuỗi bên dưới còn #2560 (1 thread mở) và #2561 (1 thread mở, chặn của anh chưa gỡ). Tác giả #2660 đã được báo merge #2601 @cf296d01 vào. Cần CR delta: #2655 #2658 #2570 #2583. Còn lỗi viền focus: #2597 #2622 #2596 #2647. #2649: nội dung chặn đã sửa, CR duyệt, chờ anh Andy gỡ chặn. #2586 và #2588 merge-tree sạch với staging nhưng vẫn phụ thuộc #2528 / #2570, #2543.
- **#2573 (G07-T30a backend, lô 13): "Spec and PR metadata" đỏ không do code của PR** (issuecomment-7104065309). Base của nó là #2525 (`94m6ux-g07-t13`), không mang các duyệt amendment 0063 và spec 0064/0065 mà nhánh `94m6ux-g07-t30` mang theo. Vì vậy #2573 phải merge **sau chuỗi amendment** #2460 → #2461 → #2463 → #2468 → #2469 → #2481 → #2482 → #2484, và sau #2525. Bảng đã xếp #2573 ở lô 13, sau #2484 (lô 12). Khi các PR đó vào staging: đổi base #2573 sang `staging`, chạy lại check, kiểm check xanh rồi mới báo "merge #2573". Không sửa spec trong #2573.
- **#2518 và #2528** đi sau #2487 (spec 0066) rồi #2507; check "Spec and PR metadata" của hai PR này sẽ đỏ cho tới khi #2487 vào staging. Đọc lại check sau khi #2487 merge. Cả hai hiện vẫn ngoài lô vì CHẶN MERGE R150-1 (P1) mới hơn lần duyệt.
- **#2560 và #2561 (G09, y6b53y) vào sau #2462 và #2516.** Codex P1 (typed adapter) cần các endpoint của hai PR đó có trong `api.d.ts`. Theo phương án A, sau khi #2462 và #2516 merge, tác giả y6b53y sinh lại `api.d.ts`, push, rồi CR delta. **#2516 mang migration 451: merge không áp migration; đến lượt áp lên staging hay production thì cần anh Andy gõ duyệt riêng.**
- **Đọc diff thật lô 10 và 11** (thread CR/SA, `team/queue/lots-input-lot10-11-diff.md`): cột "Vào trước" đúng, không chuỗi ẩn. Merge thử riêng chuỗi 17 PR: không xung đột, validate_specs pass (83 spec), tsc sạch, node test 155/155.
  - **Chuỗi A sửa lại:** #2460 → #2461 → #2463 → #2468 → #2469 → #2481 → #2482. Head #2482 `e3b0b07f` chứa cả #2461 và #2481, nên "merge #2482" là merge luôn hai PR đó. #2618 chứa #2460, #2461, #2463, #2468, #2469 (không chứa #2481); cột "Vào trước" của #2618 đã sửa.
  - #2481 và #2482 có 11–20 PR chồng lên head cũ (ví dụ #2556 #2572 #2573 #2579 #2580 #2590 #2596 #2605 #2613 #2627 #2641): sau khi #2481/#2482 vào, các PR đó merge staging vào và chạy lại CI.
  - **#2607** kéo theo #2591 (migration 394): merge #2607 trước #2591 là mang luôn file 394. #2591 xung đột `migrations/README.md` với #2514 (lô 5).
  - **#2611** hạ từ mức 5 xuống **2**: chỉ dời 3 group admin (mock-tests, writing, writing-new) vào `(authed-admin)`, cùng `AuthedShell chrome="admin"`, không đổi auth hay tiền.
  - **Bắt buộc khi giải xung đột #2535 (lô 6) với #2644 (lô 5):** #2535 xoá `(authed-admin-users)/layout.tsx`, còn #2644 thêm trang `/admin/activation-codes` vào group cũ đó. Git để trang ở lại thư mục cũ, không layout, nên trang render không có shell admin mà không test nào báo. Ai merge sau thì dời `activation-codes/page.tsx` và `admin-activation-codes.tsx` vào `(authed-admin)/(users)/admin/activation-codes/`, sửa `owner` trong `route-registry.mjs`, rồi chạy `verify-admin-route-group-flow.mjs` và `verify-admin-users-flow.mjs`.
- **Đối chiếu migration (mục 5):** xem `team/queue/MIGRATION-AUDIT-20261123.md` (thread 2zft, 13:45Z). Đã đưa vào bảng: 445 có hai bản (#2581, #2589, #2616 mang bản cũ, phải đi sau #2565 và merge staging vào); 504/505 xung đột sổ giữa #2554 và #2600/#2624; #2620 dựng lại sau #2554. Ngoài 6 số của #2450 (383, 384, 400, 440, 441, 452), mọi số khác mới chỉ có file, **chưa áp trên staging**. 453 chưa có PR giữ chỗ.
- **Kế hoạch 6 migration của #2450** (mục 6): `team/release/MUC6-6-MIGRATION-PROD-2450.md` (thread 6ygN), xem lô 0.
- **Đọc diff thật lô 1** (thread CR/SA, `team/queue/lots-input-lot1-diff.md`, 13:45Z, so `origin/staging...head` của 19 PR lô 1 bản đầu):
  - Không PR nào mang migration, backend, CI hay mã tiền/lượt chấm/auth. #2532 chỉ một file CSS. #2632 sửa `frontend/public/js/practice.js`: luồng Speaking đang chạy thật, **không có cờ**, nên kiểm tay trên staging ngay sau khi merge.
  - Merge thử cả 19 PR theo thứ tự: không xung đột, `validate_specs` pass.
  - Hai chuỗi spec gộp dồn (#2460 ⊂ #2463 ⊂ #2468 ⊂ #2469 ⊂ #2482; #2487 ⊂ #2504 ⊂ #2508 ⊂ #2509) đã xếp theo phụ thuộc trong bảng này, nên chỉ đầu chuỗi (#2460, #2487) ở lô 1.
  - Tiêu đề #2460 còn ghi "chờ Andy duyệt" dù 0062 đã duyệt 20/11–23/11: tác giả nên sửa tiêu đề trước khi merge.
  - Thread đó chưa kiểm CI và thread mở theo head; cột CI ở bảng này là lúc quét 13:33–13:35Z.
- Đầu vào chuỗi G04 (`lots-input-g04.md`, thread j1tkzb, 13:38Z) đã đối chiếu: merge lần lượt, không gộp; #2526 phải merge `staging` vào sau khi #2485 vào (chưa có `3c9f9f24`); #2624 rẽ từ #2550, chờ anh quyết thread 505; 385/387 (#2585) và 505 (#2624) chỉ có file. Chuỗi G07-T17 (thread sgp64h, 13:38Z): #2461 → #2524 → #2482 → #2556 (base `sgp64h-g07-t17-base` không có PR, chỉ là merge của #2524 + #2482; khi hai PR này vào, tác giả merge staging vào #2556 rồi đổi base) → #2572 → (#2613, #2627 → #2641) và (#2579 → #2590 → #2605). Đầu vào G07 (`lots-input-g07.md`, 13:45Z) đã đưa vào: spec #2460 → #2461 → #2463 → #2468 → #2469 → #2481 → #2482 → #2484; code 0063 #2524 → **áp mig 420 lên staging (cần anh gõ duyệt)** → #2525 → #2543 → #2570 → #2583 và #2603; code 0062 #2588 → #2602 → #2621 → #2636 sau #2570. #2588 đang xung đột sau khi #2570 nhận sửa viền focus (thread oifdm9 merge base mới vào). Bốn PR #2543 #2570 #2583 #2603 nằm sau cờ `learner_v2` (mặc định tắt), có thể merge liền nhau; không gộp PR. Chuỗi trong bảng dựng từ base nhánh và câu "stacked on/sau #N" trong body PR, nên có thể thiếu phụ thuộc chỉ ghi ở nơi khác.
- CI: phần lớn head mới đẩy 13:16Z trở đi còn `queued`. "Xanh" ở bảng là trạng thái lúc quét; trước "merge lô N" phải kiểm lại trên đúng head.
- Mức rủi ro dựng từ đường dẫn file, chưa đọc từng diff; một PR chỉ đổi CSS trong thư mục `credits` vẫn bị xếp mức 5. Cờ "sau cờ tắt" dựa vào lời PR, chưa kiểm mã.
- `mergeable_state` của GitHub có thể báo xung đột muộn với dòng `.tsv` sổ migration; kiểm lại ngay trước merge.
- #2462: lỗi auth `/instructor/attention` chưa nhận `as_instructor` (FsZ7 báo): admin "xem như giáo viên" nhận toàn bộ dữ liệu. Xếp mức 5, phải sửa trước merge.
- **#2502 phải đi sau #2496** (23/11 17:35Z, 2zft rà lô 3–4): hai PR xung đột ngữ nghĩa, `csp-nonce-enforce.test.mjs:178` fail ở `/library/writing-samples/sample` khi có cả hai. Tác giả #2502 merge nhánh #2496 vào, thêm ngoại lệ `/library/writing-samples/` cạnh `/grammar/` trong test enforce, chạy lại CI rồi xin CR delta.

- **#2552 phải đi sau #2593 (đã chứa #2485)** (23/11 17:38Z): `credits.py` chỉ xung đột với hai PR này (grant_extra của #2552 cùng chỗ với settle-by-resource của #2593; giữ cả hai). Chủ nhánh đã giải thử local trên e26ea860 (112 passed, 50 skipped); sẽ merge staging vào và push sau khi #2593 vào staging, rồi CR delta.

- **Kết quả rà sẵn sàng 17:25–17:43Z** (chỉ đọc, local): lô 1–2 `lots-input-lot1-2-ready-1725.md`, lô 3–4 `lots-input-lot3-4-ready-1755.md`, lô 5–6 `lots-input-lot5-6-ready-1734.md`, lô 7 `lots-input-lot7-ready-1735.md`, lô 8–9 `lots-input-lot8-9-ready-1735.md`, lô 10–14 `lots-input-lot10-14-ready-1738.md`, chưa xếp `lots-input-unplaced-a-1805.md` / `-b-1755.md`, chuỗi credits `lots-input-credits-chain-trial-1742.md` (0 xung đột ngữ nghĩa). Tổng hợp: `team/queue/TONG-HOP-SANG-20261124.md`. Gần như mọi head có CI bị huỷ đợt 14:03Z: chạy lại một lần ngay trước khi xin "merge lô N".
- **#2557:** anh Andy gỡ chặn lúc 13:41:30Z ("gỡ chặn #2557", ngay sau tin 13:41:03Z "gỡ chặn #2655"); đã ghi lên PR. **#2654** vẫn chờ anh gỡ chặn 13:21Z (đã sửa ca55ea82/c8503f51, 2zft xác nhận đóng đủ).

- **Chuỗi G07 merge thử (17:44Z, local):** xung đột ngữ nghĩa #2583 × #2636 (`learner-shell.test.tsx:328` fail khi có #2636): #2636 phải merge #2583 vào và sửa dòng test. Xung đột dòng liền kề, giải khi merge staging vào: #2588/#2636 × #2583 (route-registry), #2596 × #2603 (`student_home.py`), #2622 × #2602 (route-registry).

- **#2560/#2561 còn 1 thread Codex mở mỗi PR (đọc lại 18:07Z)**: P1 "dùng typed adapter / browser-api". Tác giả hoãn có lý do: đường `/admin/attention` và incident chưa có trong `api.d.ts` cho tới khi #2462 / #2516 vào base. Việc còn lại: sau khi #2462 + #2516 merge, sinh lại `api.d.ts`, chuyển sang `getBrowserJson`/`postBrowserJsonAt`, resolve thread, CR delta. Staging chặn merge khi còn thread mở.

- **Chuỗi G06 merge thử (18:11Z, local):** xung đột ngữ nghĩa #2506 × #2488/#2546 (`next-metadata.test.mjs`: sitemap 7 mục khi `/library/writing-samples` live, test #2506 chờ 6). Chốt **#2488 sau #2506**; #2488 merge #2506 vào và đổi kỳ vọng thành 7 (gộp vào lần push đang chờ anh duyệt). #2503 xung đột 7 file với staging: tác giả merge staging vào rồi CR delta.

- **Chuỗi spec phòng thi merge thử (18:12Z, local, `lots-input-examspec-chain-trial-1812Z.md`):** #2487→#2511, #2541, #2549 sạch. **#2557 và #2584 phải vào sau #2518 và #2528** (lỗi ngữ nghĩa). Chồng G08-T16 (#2540→#2551→#2555→#2575) xung đột 12 file spec do mang bản spec cũ; không có xung đột code; tự hết khi merge staging vào sau khi các PR spec đã vào. #2511, #2541 đủ điều kiện bỏ nháp (việc của chủ nhánh).
- **Chồng G08-T16, soạn sẵn (18:17Z, `team/queue/prep-g08-t16-stack.md`):** sau khi staging có #2509 và #2507, merge staging vào #2540 thì 11 file trong `specs/` xung đột; giải bằng `git checkout --theirs` (phía staging), không phải `--ours`. #2551 #2555 #2575 sạch. #2511 và #2541 bỏ nháp 18:18Z (CR khớp head 0e9e2672 / 20c2ccc5).
- **#2503 soạn sẵn (18:16Z, `team/queue/prep-2503-after-2519-2546.patch`):** staging → #2519 @778c5d0f → #2546 @aeee5706 → #2503; 5 file giải tay giữ cả hai bên.
- **Chuỗi G09 merge thử (18:15Z, local, `lots-input-g09-chain-trial-1815Z.md`):** xung đột cơ học ở #2471 (model admin_learner_profile + api.d.ts), #2516 (register.tsv/forward-policy.tsv dòng 442, 451), #2660 (api.d.ts). #2659 chồng trên bản #2507 cũ (8 test agent-launcher đỏ): tác giả merge #2507 @93a85443 vào. Ở tip có #2507: tsc, vitest 1446, csp 32/32, validate_specs, pytest admin 1525 pass.
- **Chuỗi G10 merge thử (18:15Z, local, `lots-input-g10-chain-trial-1815.md`):** xung đột ngữ nghĩa #2568 × #2611 (test của #2568 đọc TSX ở `(authed-admin-mock-*)`, #2611 chuyển vào `(authed-admin)/(mock-*)`; tip lỗi 16 node + 2 pytest ENOENT). Chốt **#2568 sau #2611**, #2568 đổi đường dẫn (patch soạn sẵn: `team/queue/prep-2568-after-2611.patch`). #2497 chỉ xung đột chữ ở route-registry.
- **#2488:** commit local `cf347dc4` (focus + merge #2506 @3ed7c334, sitemap 7 mục); chờ anh Andy duyệt push nhánh `codex/g06-t09-writing-samples-list`.
- **Lô 5–9 merge thử (18:20Z, 2zft, `lots-input-lot5-9-trial-1835.md`): merge từng lô**, lô sau merge staging vào rồi CR delta. Lỗi thật đã giao tác giả sửa trong đêm: #2456 (chuyển phần sửa vào package `routers/admin/` sau #2490), #2521 (V2_SET khai báo 2 lần), #2465 (ký tự ⌘ ngoài subset font, gặp khi có #2548), #2649 (viền focus + `chrome-navigation-bridge`). Lỗi chỉ khi gộp, giải khi PR kia đã vào staging: #2644×#2535, #2649×#2632 (`_roomTooShort`), proxy/nonce, #2502×#2539, #2529.
- **Đề xuất lô 15 (18:22Z, thread đợt B, `lots-input-lot15-22-trial-1835.md`, local):** #2655 (PR gốc, có thể đưa sớm vào lô 3), #2658 sau #2463, #2647 sau #2606; 13 PR merge sạch trên caf42e6b, tip 9c71b17a xanh (tsc, vitest 1370, csp 32/32, validate_specs, pytest 265). #2647 mang mig 421 (cần anh duyệt áp).
- **#2568:** patch đổi đường dẫn soạn sẵn `team/queue/prep-2568-after-2611.patch` (16 file test); chủ nhánh (thread đợt B) áp sau khi #2611 vào staging.
