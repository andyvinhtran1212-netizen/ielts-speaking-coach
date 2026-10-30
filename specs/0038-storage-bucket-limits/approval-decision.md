# Approved intent decision

**State: APPROVED by the human owner.** Vinh (repository owner) approved this
work on 2026-10-29 at 14:44 (UTC+7), item (b) of
`handoff/leader/20261029-1442-fd-questions-vinh.md`. Verbatim reply: "Duyệt cả
5 theo đề xuất". The Leader verified the reply directly in the Leader chat and
recorded: "(b) A-ST: duyệt, migration 343." and "Mọi thay đổi prod vẫn cần anh
Vinh duyệt riêng lúc promote."

The proposal approved under (b):

1. Each bucket (audio-responses, listening-audio, vocab-audio, writing-images…)
   gets a size and MIME limit, never lower than the limit in today's code.
2. Errors return 413 `file_too_large` or 415 `unsupported_media_type`, never
   500.
3. One migration; the Leader assigned number 343 (spec number 0038 confirmed
   2026-10-29 14:53 UTC+7).
4. Changing production is a production configuration change that the owner
   approves separately at promotion.

Scope: staging only. The Leader applies 343 to staging under the advisory
lock. This does not authorize applying 343 to production or running the
production census; both need the owner's explicit authorization at the
`staging` → `main` promotion.
