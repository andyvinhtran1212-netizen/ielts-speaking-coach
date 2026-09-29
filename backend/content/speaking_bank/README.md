# Speaking bank from the supplied Word file

`2026-09-source.json` is a structured extraction of prompts and dates from the supplied
`Ngan_hang_de_IELTS_Speaking_Day_du.docx`. Its SHA-256 is recorded in the JSON.
The converter rejects changed section shapes and expects 57 Part 1 topics,
84 Part 2 cue cards, and 69 Part 3 discussion groups (1,203 stored questions
when the two rounding-off prompts on each cue card are included).

`2026-09-part1-reviewed.txt` and `2026-09-part3-reviewed.txt` contain four
edited practice prompts per topic. Run `python backend/scripts/build_reviewed_speaking_bank.py`
from the repository root to regenerate `2026-09-reviewed.json` (126 topics,
504 questions). The reviewed manifest retains each source ID, source document
hash and supplied date window; editorial file hashes record the exact wording.
The raw extraction remains unchanged for comparison.

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
- Use `2026-09-reviewed.json` for Part 1/3 imports. The source has templated
  wording, including malformed Part 3 questions; do not import its Part 1/3
  questions directly. Keep the source extraction as provenance.
- Part 1 and Part 3 require audio matching the reviewed wording and topic title
  before activation or assignment. The importer requires both `render_audio=True`
  and an explicit `approved_source_ids` set before asking the admin audio endpoint
  to render a current topic and activate it. The endpoint verifies its output;
  the assignment gate checks the audio fingerprint again at handoff.

The source windows should be revisited when a learner's actual test date falls
outside them. Questions from an older range can still train Speaking skills;
their date label should not be presented as current exam evidence.
