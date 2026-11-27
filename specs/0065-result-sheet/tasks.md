# Tasks

Mỗi task là một PR vào `staging`, mở sau khi spec `approved`. PR dùng lớp `high-risk`, `Spec: RESULTSHEET-0065`. Mã task giữ theo mã nhiệm vụ của gói.

- [ ] T27 (G07-T27) `credits-empty-notice.tsx`, `fix-link-model.mjs` + `fix-link-map.json`, `band-display-model.mjs`, `result-next-step-model.mjs`; test node và test React (plan 5.1, 5.4, 5.5). `depends: spec approved` `owns: frontend/components/ui/result/credits-empty-notice.tsx, frontend/lib/fix-link-model.mjs, frontend/lib/fix-link-map.json, frontend/lib/band-display-model.mjs, frontend/lib/result-next-step-model.mjs`
- [ ] T20 (G07-T20) Thêm `result-next-steps.tsx`, `result-grading-source.tsx`, `result-pending-review.tsx`, `retry-credit-line.tsx`; áp lên phiếu Writing (cây mới sau cờ `learner_v2`), gắn `CreditsEmptyNotice` và `fixLink`; ghi props trong PR cho G08. `depends: T27, LEARNERCORE-0063 T05` `owns: frontend/components/ui/result/*, frontend/app/(authed-writing-result)/** (cây mới)`
- [ ] T21 (G07-T21, high-risk) Migration `essay_regrade_requests` (plan 5.2) và rollback; `writing_student.py` nhận hai dạng body; `admin_writing_regrade.py` và màn admin có hai cột; `regrade-request.tsx`; pytest, test PG, sinh lại `api.d.ts`. Trước khi áp, chạy truy vấn chỉ đọc trên staging và ghi kết quả vào PR. `depends: T20` `owns: backend/migrations/<số>_essay_regrade_reason_code.sql, backend/migrations/rollback/<số>_*.sql, backend/routers/writing_student.py (khối regrade), backend/routers/admin_writing_regrade.py, frontend/components/ui/result/regrade-request.tsx`
- [ ] T22 (G07-T22) Áp khung lên phiếu Speaking (nguồn chấm luôn "AI chấm, trả ngay", đoạn chấm phát âm, dòng lượt, không có nút chấm lại) và phiếu thi thử (Overall theo plan 5.1; dùng component "Đang chấm" của G08); thêm `is_assigned` vào phản hồi kết quả thi thử nếu chưa có (chỉ đọc). `depends: T20, LEARNERNAV-0062 T11 (đợt 6)` `owns: frontend/app/(authed-speaking-result)/** (cây mới), frontend/app/(authed-mock-result)/** (cây mới)`

Ràng buộc chung:
- Không đổi luồng accept/reject/fulfil.
- Không mở chấm lại cho Speaking.
- Không đổi cách chấm hay cách tính band.
- Không sửa backend Overall (G02).
- Không log `reason` hay `note`.
- Không bật cờ trên production.
