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

## BUCKET50 a amendment

Vinh t1246u 02/11 06:37 approved option a, relayed by Leader in PC-J522
(replacing PC-J511): `listening-audio` uses 50 MiB / 52 428 800 bytes,
matching the existing staging project cap. This supersedes the original
Listening size calculation and the single-migration assumption: 343 is
already applied on staging, so retain it and add forward migration 362 with
its own rollback and the same held feature group. Align the shared Storage
helper and tests; leave the separate source-importer/full-test/pack ceilings
to 1mg (PC-J484). Leader applies staging under the advisory lock; WM retests.
No remote apply, production read/write or merge is authorized for PC-J522.
