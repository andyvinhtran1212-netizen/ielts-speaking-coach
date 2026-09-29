# Speaking bank from the supplied Word file

`2026-09-source.json` is a structured extraction of prompts and dates from the supplied
`Ngan_hang_de_IELTS_Speaking_Day_du.docx`. Its SHA-256 is recorded in the JSON.
The converter rejects changed section shapes and expects 57 Part 1 topics,
84 Part 2 cue cards, and 69 Part 3 discussion groups (1,203 stored questions
when the two rounding-off prompts on each cue card are included).

The date ranges are **claims in the supplied document**, not verified IELTS
question releases or a promise about an exam. The
[official IELTS Speaking format](https://www.ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-speaking)
has three parts; this bank is practice material, not an official paper.
At the 2026-09-29 import, the document's May–December 2026 and
September 2026–April 2027 ranges overlap the current quarter. The earlier
ranges remain useful for fluency, ideas, and the Part 2 one-minute planning
routine, but are not prioritised as current-period practice.

## Admin import policy

- Import through `scripts/import_speaking_bank_admin.py` with an authenticated
  admin session. Its default is dry-run. It never edits existing blank-category
  topics or deletes an editor's question.
- Keep historical rows inactive. A current Part 2 cue card becomes active only
  after all three rows are read back. On 2026-09-29, 54 current-window cards
  were activated and 30 historical cards were held inactive in production.
- Part 1 and Part 3 need content review and audio that matches the current
  wording before the topic is activated or assigned. Do not turn on a topic
  merely because its text has been imported. The backend assignment gate
  verifies audio for Part 1 and Part 3. The importer requires both
  `render_audio=True` and an explicit `approved_source_ids` set before it asks
  the admin audio endpoint to render a current Part 1/3 topic and activate it.
- The source has templated wording that requires editorial review, especially
  Part 3 subject-verb agreement and some generic cue-card follow-ups. Keep
  these parts inactive until reviewed. Preserve the extraction as provenance;
  put reviewed wording in an explicit revision rather than silently altering
  source text.

The source windows should be revisited when a learner's actual test date falls
outside them. Questions from an older range can still train Speaking skills;
their date label should not be presented as current exam evidence.
