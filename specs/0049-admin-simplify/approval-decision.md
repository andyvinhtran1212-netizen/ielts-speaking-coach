# Owner approval

On 2026-11-10 at 12:27 Asia/Saigon (UTC+7), the owner approved this spec in the
Leader chat, answering question t1564s5141. The proposal (item 1 of 7) read:

Assistant: **Spec 0049 (#2254, menu admin):** em đề xuất **duyệt** theo FD, và Q-8 giữ Feedback cùng Speaking Topics trên prod. Rủi ro thấp vì mọi thay đổi nằm sau cờ đang tắt, tắt cờ là về như cũ. Không gọi AI, không có migration. Q-8 giữ trên prod vì số liệu prod cho thấy hai mục này vẫn có người dùng.

Assistant: Anh duyệt 7 mục theo đề xuất của em?

User: Duyệt cả 7 mục theo đề xuất của em

This approves ADMINSIMPLE-0049 phase 1 as written, with Q-2..Q-9 per the FD
recommendations and Q-8 keeping Feedback and Speaking Topics on production while
hiding them on staging. It does not approve merging this PR, phase-2 code
deletion (gated by FR-010), or any migration, permission or environment change.
No student data is included here.
