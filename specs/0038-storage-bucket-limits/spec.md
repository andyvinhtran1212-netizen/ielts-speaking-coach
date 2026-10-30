---
id: STORAGELIMITS-0038
title: Each Storage bucket accepts only the file sizes and types the app writes, and an oversize or wrong-type upload gets a clear 413 or 415
status: approved
risk: high
owner: product
---

# Each Storage bucket accepts only the file sizes and types the app writes, and an oversize or wrong-type upload gets a clear 413 or 415

Approval: approved by Vinh on 2026-10-29 at 14:44 (UTC+7), item (b), verbatim
"Duyệt cả 5 theo đề xuất" (see [`approval-decision.md`](approval-decision.md)).
Spec number 0038 and migration number **343**: Leader confirmed 2026-10-29
14:53 (UTC+7).
Origin: tracker row A-ST; Feature Developer brief
`handoff/leader/20261028-0925-feature-developer-brief-a-st-storage-limits.md`,
ready note H-1029-FD5. The "writing-images is public" part of A-ST was fixed in
#1760; this spec covers the remaining size/MIME limits (P2).

## Tóm tắt (tiếng Việt)

Hiện chưa bucket Storage nào có giới hạn kích thước hay loại file; giới hạn chỉ
nằm trong code từng route. Nếu một route quên kiểm tra, hoặc khoá service bị
lộ, Storage nhận mọi file. Migration 343 đặt `file_size_limit` và
`allowed_mime_types` cho 6 bucket theo bảng bên dưới. Giới hạn không bao giờ
chặt hơn code hiện nay (bảng lấy từ khảo sát staging T001 trong
[`research.md`](research.md)), để không bài ghi âm Speaking nào bị mất. Không
đổi bucket nào giữa công khai/riêng tư.

Khi file quá lớn hoặc sai loại, backend trả 413 `file_too_large` hoặc 415
`unsupported_media_type` kèm câu tiếng Việt, kiểm tra trước khi tải lên. Nếu
chính Storage từ chối, lỗi cũng được đổi về hai mã này, không bao giờ là 500.
Học viên nộp bài nói vẫn giữ ghi âm và được báo lý do.

Prod: áp 343 lên prod là đổi cấu hình prod, chỉ làm lúc promote khi anh Vinh
duyệt riêng; khảo sát prod (T004) cũng cần anh Vinh cho phép.

## Problem

On staging every bucket in `storage.buckets` has `file_size_limit = NULL` and
`allowed_mime_types = NULL` (T001 census, 2026-10-29). Size and type are only
checked inside each route (`grading.py:95`, `listening.py:4738`,
`reading_image.py:61`, `writing_prompt_image.py:53`), several scripts and
importers upload with no cap, and `tts_audio.py` has none at all. A route that
forgets its check, or a leaked service-role key, can store any file of any
size and type. Separately, when Storage itself refuses an upload the routes
surface it as a 500 (`listening.py:4855`) or, for Speaking, as a non-fatal
warning or 503 `recording_storage_unavailable` (`grading.py:630-645`), not as
a stable size/type error.

## Scope

- Migration 343: set `file_size_limit` and `allowed_mime_types` on the six
  buckets to the final limit table below; README and `forward-policy.tsv`
  entries; a down script that restores the T001 values.
- New shared helper `backend/services/storage_limits.py`: the limit table in
  code, pre-upload checks, and mapping of a Storage size/type refusal to
  413/415.
- Each existing upload route and upload service checks size and type before
  uploading and returns 413/415 with a stable `error_code`.
- Speaking: non-audio client content types are normalised before upload so a
  recording the route accepts today is never refused by the bucket.
- Scripts under `backend/scripts/` only map the error, with no behaviour
  change.
- Tests: `backend/tests/test_storage_limits.py`,
  `backend/tests/test_migration_343_storage_bucket_limits.py`.

### Final limit table (from T001, [`research.md`](research.md))

| Bucket | `file_size_limit` (bytes) | `allowed_mime_types` | `public` (unchanged) |
| --- | ---: | --- | --- |
| `audio-responses` | 52 428 800 (50 MiB) | `audio/*`, `video/webm`, `video/mp4`, `application/octet-stream` | false |
| `listening-audio` | 134 217 728 (128 MiB) | `audio/*`, `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, `application/json` | false on staging |
| `listening-images` | 10 485 760 (10 MiB) | `image/png`, `image/jpeg`, `image/webp` | false on staging |
| `reading-images` | 5 242 880 (5 MiB) | `image/png`, `image/jpeg`, `image/webp` | false on staging |
| `writing-images` | 5 242 880 (5 MiB) | `image/png`, `image/jpeg`, `image/webp` | false (#1760) |
| `vocab-audio` | 5 242 880 (5 MiB) | `audio/mpeg` | true |

Values before 343 on staging: `NULL`, `NULL` for all six. No other bucket
exists on staging.

## Non-goals

- Moving uploads to the browser (direct-to-Storage uploads).
- Changing any bucket's `public` flag.
- Deleting or re-typing existing objects.
- Raising the project-wide Storage limit (staging: 50 MiB; see
  `research.md`). That is a plan-level owner decision.
- Applying 343 to production, or reading production, in this spec's staging
  work (T004 only, with Vinh's separate authorization at promotion).
- Limits on buckets other than the six (none exist on staging; any found on
  production are reported to Leader first).

## Users and journeys

- A learner submits a Speaking answer (a normal 2 MB webm, or an mp4 from
  Safari): it still uploads and is graded exactly as today.
- A learner submits an audio file over 50 MiB: they see the existing
  "File quá lớn (… MB). Giới hạn là 50 MB." with 413 before transcription, and
  keep their recording in the browser.
- An admin uploads a 7 MB PNG as a Writing Task 1 chart, a Reading image or a
  Listening map: 413 "File quá lớn (tối đa 5 MB)" and no object is created.
- An admin uploads a GIF or PDF as an image: 415 with the allowed types.
- An importer or script hits a bucket limit: it stops with a clear
  `file_too_large`/`unsupported_media_type` error naming the bucket and the
  limit, never a silent partial upload.

## Requirements

- **FR-001:** Migration 343 sets, for exactly the six buckets `audio-responses`, `listening-audio`, `listening-images`, `reading-images`, `writing-images` and `vocab-audio`, `file_size_limit` and `allowed_mime_types` to the values in the final limit table; it changes no other column (in particular not `public`), no other bucket and no object; it is idempotent and re-runnable; it aborts if any of the six buckets is missing; and its postcondition fails unless each of the six rows has a non-null `file_size_limit` and `allowed_mime_types` equal to the table.
- **FR-002:** Migration 343 ships a down script, kept in the file header, that restores the values recorded before apply (on staging `NULL`, `NULL` for all six, from T001) without touching `public`; the production pre-apply values are read by T004, and if any is not `NULL` the down script is amended before the production apply.
- **FR-003:** Every upload route and upload service that writes one of the six buckets checks size and type against the limit table before calling Storage; an oversize file returns HTTP 413 with `{"error_code": "file_too_large", "max_bytes": <int>, "message": <Vietnamese>}` and a type outside the table returns HTTP 415 with `{"error_code": "unsupported_media_type", "allowed": [<types>], "message": <Vietnamese>}`; no Storage object is created; existing Vietnamese messages (for example `grading.py:553`) keep their text.
- **FR-004:** A refusal from Storage itself (HTTP 413, or a mime-type error from the SDK) is mapped by `services/storage_limits.py` to the same 413/415 shapes (or, in importers and scripts, to an error carrying the same `error_code`, bucket and limit); it never surfaces as HTTP 500, an unhandled exception, or a silent success.
- **FR-005:** Speaking keeps every recording the route accepts today: the bucket limits are never stricter than `grading.py` (50 MiB, any audio type with or without parameters); before upload the backend normalises a client content type outside `allowed_mime_types` for `audio-responses` (for example empty, `text/plain`, an unknown type) to the audio type implied by `_guess_ext`; an oversize recording is refused with 413 before transcription; and if Storage still refuses a Speaking upload on size or type the learner gets 413/415 instead of a graded answer with no stored audio.
- **FR-006:** No bucket changes visibility: `writing-images` and the other private buckets stay `public = false`, `vocab-audio` stays `public = true`, and signed-URL reads for `audio-responses` and `writing-images` keep working (no #1760 regression).
- **FR-007:** The largest valid object of each bucket in the T001 census, and a file at each route's own code limit (bounded by the project-wide Storage limit), still uploads after 343.

## Acceptance scenarios

### Scenario 1 — oversize Writing chart

- **Given** 343 is applied on staging and the J133 backend is deployed
- **When** an admin uploads a 7 MB PNG through the Writing prompt image upload
- **Then** the response is 413 with `error_code = "file_too_large"`, `max_bytes = 5242880` and a Vietnamese message, and no `storage.objects` row is created in `writing-images`

### Scenario 2 — wrong type

- **Given** the same deployment
- **When** an admin uploads a GIF to the Reading image upload
- **Then** the response is 415 with `error_code = "unsupported_media_type"` and `allowed = ["image/png","image/jpeg","image/webp"]`, and no object is created

### Scenario 3 — normal Speaking answer

- **Given** 343 is applied on staging
- **When** a learner records and submits an answer in a real browser on `staging.averlearning.com`
- **Then** the recording is stored in `audio-responses`, the answer is graded, and Staging E2E stays green

### Scenario 4 — Storage-side refusal

- **Given** the Storage client is stubbed to refuse with HTTP 413 or a mime error
- **When** any covered upload path runs
- **Then** it returns 413/415 with the stable `error_code` (or raises the mapped importer error), never 500

### Scenario 5 — postcondition and privacy

- **Given** 343 is applied on staging
- **When** the read-only postcheck in the 343 header runs
- **Then** all six buckets show the table values, `writing-images` is still `public = false`, and a signed URL for a Writing chart still loads

## Edge cases

- Content-type parameters (`audio/webm;codecs=opus`): `audio/*` matches the
  type regardless of how Storage treats the parameter.
- Safari/Firefox recorders can label audio as `video/mp4`/`video/webm`; these
  stay allowed in `audio-responses` so applying 343 before the normalisation
  deploy cannot lose a recording.
- `mimetypes.guess_type` answers depend on the host (`audio/wav` vs
  `audio/x-wav`); `listening-audio` uses `audio/*`.
- Effective limit is the smaller of the bucket limit and the project-wide
  limit (staging 50 MiB); `listening-audio` uploads above 50 MiB are already
  refused on staging today and remain so.
- Image routes keep their magic-byte sniff; `allowed_mime_types` checks the
  declared header only.

## Success criteria

- On staging after apply, the 343 postcheck shows the six table rows and
  unchanged `public` values.
- Every covered upload path has a test for oversize, wrong type and Storage
  refusal returning 413/415 with no object created.
- A real-browser Speaking submit on staging stores its recording.

## Decisions

1. Limit = max(code limit, census max); MIME = code types ∪ census types
   (approved rule).
2. `audio/*` for `audio-responses` and `listening-audio` instead of exact
   lists, because client and `guess_type` names vary.
3. Keep `video/webm`, `video/mp4`, `application/octet-stream` in
   `audio-responses` even though the census found none, and normalise anything
   else in the backend (approved: "kept, or the backend normalises them").
4. `listening-images` gets 10 MiB headroom over the 5 MiB route for the
   uncapped repair script; `vocab-audio` gets the 5 MiB floor.

## Open questions

- Leader: production census and production project-wide Storage limit at
  promotion (T004).
- Content Manager: final Vietnamese wording of the new 413/415 messages
  (`ui-states.md`).
