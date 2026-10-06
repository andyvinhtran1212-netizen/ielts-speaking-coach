# Full original bank scope correction — 2026-10-06

## Status

The user clarified that each assigned lesson must deliver the original 100-question bank. The production v2 release delivers twelve newly authored multiple-choice questions per lesson. Its content and operational acceptance remain evidence only for that twelve-question activity; the previous conclusion that the user's full-bank request was complete is withdrawn.

No original source file, bank, learner assignment or grading rule was changed in this audit. This checkout is isolated from the primary checkout and other sessions. This audit records the withdrawn mini-practice scope. The separate [full-bank spec](../0018-master30-full-bank-assignments/spec.md) defines correction intent and gates.

## Confirmed source and import evidence

- Thirty canonical `Buoi-xx/KBT-buoi-xx.jsonl` files contain 3,100 records: 2,700 MCQs and 400 writing items. Each lesson retains the original core of 90 MCQs plus 10 writing items; fourteen lessons also retain one to twenty verified written backports. Preserve those additions separately rather than silently deleting them.
- The existing `scripts.import_course_exercise_bank._normalise` validated all thirty files without writing data. This proves import shape, not semantic correctness or hosted readiness.
- Production C5 currently has thirty Advanced Vocabulary banks with NULL lesson numbers, and no original C5-Bxx Grammar banks. Existing C1 banks belong to a separate course and must not be overwritten.
- Independent approval for `master30-assigned-practice/v2.json` covers twelve newly authored MCQs per lesson. It cannot approve the 2,700 original MCQs or 400 writing items by extension.

## Findings and minimal corrections

| Finding | Severity | Location | Minimal correction | Verification |
| --- | --- | --- | --- | --- |
| The delivery scope was narrowed to a separate mini practice package rather than the supplied original bank. | Critical | `grammar_lesson_content.py:20,98–100`; `grammar_lesson_service.catalog`, `prepare_assignment`; spec FR-005 | Extend the existing Grammar lesson contract with typed MCQ/E full-bank snapshots. Keep prior twelve-question attempts readable and identify that activity truthfully. | Compare served IDs/prompts against all ninety original MCQs and ten core writing items for every lesson; distinguish additions. |
| Original source still contains actual answer/prompt/rubric mismatches. | Critical | Examples B13-C1-03, B21-C2-02, B24-D2-02, B29-D3-04, B30-E2-03; source agents' read-only findings | Repair a versioned release copy, retaining original provenance and hashes. Do not edit the supplied library in place or manufacture distractor taxonomy labels. | Read all options, keys, explanations, models and rubrics; independent approval tied to the exact corrected full-bank hashes. |
| Publishing the original practice questions would expose diagnostic evidence currently treated as protected. Five hundred of 733 runtime items match the original ID, prompt and key; protected ID/family closure also overlaps the source. | Critical | `grammar_diagnostic_service.py:399–421`; migration 283 exposure schema/assignment trigger | Exclude actual started full-bank snapshots and complete original/family/parallel mapping from affected IDs/families/parallel sets from diagnostic evidence, or visibly blocks a diagnostic that lacks independent evidence. Do not create fake diagnostic sessions or claim that no diagnostic exposure rows means no exposure. | Complete original practice, then verify the selector does not reuse exposed evidence and fails visibly when insufficient independent items remain. |
| The course writing grader checks grammar/spelling; its clean score does not prove that an E answer met the requested meaning, structure or explanation rubric. | Critical | `quiz_service.submit_course_writing:3854–3862`; weighted writing result near 4263; `course_writing_grader.grade`; importer `_essay_row` | Preserve model, variants, output requirements and rubric; distinguish language feedback from rubric attainment. Do not certify a grammatically clean but task-inappropriate answer as correct E work. Reuse the current report/teacher review contract rather than build a grading platform. | B30-E3-02: a clean sentence retaining `by` when the task requires an endpoint `to`, or omitting its reason, must not be certified as meeting the rubric. |
| Shape validation alone does not make course banks ready; English items require audio, and importer updates match course plus lesson number. | Medium | `class_content._resolve_course_bank` near 821–830; `import_course_exercise_bank.main` | Reuse native Grammar lesson assignments, avoiding unrelated course audio/grader changes. Preserve source/model/rubric in the typed snapshot. | Confirm all items/audio, individual recipient authorization, saved work and teacher/learner immediate and reload state. |

## Implementation decision

The narrower existing Grammar lesson path is chosen after auditing both engines:
add frozen v3 with full source items and non-scoring writing feedback, retaining
v1/v2. Use independently reviewed v2 pre-start notes. Preserve legacy8–20 plus
full100–120 snapshots, atomic MCQ/E writes and objective denominator90. Actual
served attempts and full q-matrix closure protect diagnostics, including pending
and concurrent requests. No course importer/audio or AI grading platform change.

Approve0018 intent on staging before implementation. Independently correct/review
all original items, then verify all thirty full banks locally, on staging and
production at exact SHAs. Until then production is only twelve-question activity.

## Preserved work

- Primary checkout: `/Users/trantrongvinh/code/ielts-speaking-coach` (untouched).
- Source library: `/Users/trantrongvinh/Documents/Co-work/Course 1/06_KHO-BAI-TAP` (read-only).
- Correction checkout: `/Users/trantrongvinh/.codex/worktrees/grammar-full-original-banks/ielts-speaking-coach`, based on `origin/staging`.
- Earlier receipt has been corrected at `/Users/trantrongvinh/.codex/outputs/master30-ready-2026-10-05-1237dc8c7/bao_cao_san_sang_30_bai_grammar.md`.
