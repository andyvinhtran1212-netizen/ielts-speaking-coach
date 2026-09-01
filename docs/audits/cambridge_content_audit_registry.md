# Cambridge Listening / Reading content audit registry

Canonical audit state is stored on each test at `metadata.content_audit`.
Listening additionally uses the existing `listening_audit` row because that is
the source rendered by `/admin/listening/audit`.  Do not infer a manual pass
from `published`; an automated candidate is not a confirmed defect or pass.

## Manually verified

| Test | Scope | Status | Date | Notes |
|---|---|---|---|---|
| `ILR-LIS-CAM-B17-T4` | 40 questions, types, answers, templates, audio object/windows, transcript, solutions | `passed_after_fix` | 2026-08-29 | Fixed shifted choice banks, split notes, OCR punctuation and a Part 4 transcript gap. |
| `ILR-RDG-CAM-B17-T4` | 3 passages, 40 questions, types, answers, grouped-MCQ grading, templates, solutions | `passed_after_fix` | 2026-08-29 | Fixed truncated Q23–26, a fake Q19 blank, stale OCR notes and quotation punctuation. |

## Reusable defect signatures

- `L2` / `R2 template_junk`: literal underscore blanks, page numbers or OCR
  punctuation survive next to a canonical input token.
- `L7`: a shared choice-bank item duplicates the tail of its prompt.
- `L8` / `R3`: a PDF-verified prompt or option bank no longer matches its
  canonical source text.
- Generic dangling-line detection is deliberately conservative.  English may
  validly end a stem or option with a preposition (`built with`, `used to`), so
  those endings are not treated as defects without an exact source baseline.

## Automated follow-up queue (not yet manually confirmed)

The 2026-08-29 read-only full-library run found 20 candidate findings across 15
tests after false-positive reduction:

- Listening: `B14-T3`, `B18-T3`, `B19-T3`, `B20-T1`, `B21-T3`.
- Reading: `B13-T4`, `B14-T2`, `B16-T3`, `B17-T2`, `B17-T3`, `B18-T1`,
  `B19-T1`, `B19-T2`, `B19-T3`, `B21-T3`.

Do not mark these tests passed or patch them from the detector alone.  Open the
source page, confirm the rendered block, then persist a scoped audit marker.

Regenerate the queue from `backend/`:

```bash
python scripts/audit_imported_test_content.py
```
