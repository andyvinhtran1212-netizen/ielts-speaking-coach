# Advanced Vocabulary — Self-paced course contract

Status: approved product contract, implementation foundation
Scope: first release of the Advanced Vocabulary course
Canonical course: `C5` — Course 5

## 1. Locked product decisions

1. The first release contains exactly 30 core lessons: `ADV-T01` through
   `ADV-T30`. `T31`–`T33` are not part of the first release and must not appear
   in its manifest, progress denominator, assignment picker or public catalog.
2. Writing inside a lesson is reference material. It presents the prompt,
   prompt analysis, idea map, outline, useful language, annotated examples and
   common traps. It is not a submission surface and is never graded.
3. A writing response may be submitted or graded only through the existing
   teacher-created `writing_assignments` workflow.
4. Speaking inside a lesson is ungraded practice by default. Recording may be
   offered as a private rehearsal aid, but it must not create a grade or block
   lesson completion. A graded speaking task requires a separate explicit class
   assignment.
5. Release 1 is assignment-led. Public discovery and self-enrolment are a later
   delivery channel over the same immutable lesson versions, not a second
   curriculum implementation.

## 2. Source-of-truth hierarchy

The source course is editorial input. A generated upload package is never an
authoring source.

| Content | Canonical source |
|---|---|
| Topic narrative and Parts 0–8 | `_CORRECTED/Advanced/01_Topics_Upgraded/` |
| Vocabulary cards | `Vocab_Quiz/Advanced_Markdown_Upload/` |
| Adaptive item pools | `Vocab_Quiz/Advanced_banks/` |
| Structured Listening/Reading | `_CORRECTED/Advanced/03_Listening_Reading_v2/` |
| Writing reference banks | `Advanced/03_Writing/` |
| Generated web package | derived artifact only |

Every generated lesson must record SHA-256 source checksums, its converter
version and a SHA-256 content checksum. Rebuilding from identical sources and
converter version must produce the same runtime IDs and content checksum.

## 3. Curriculum shape

The 30 lessons retain the six thematic source clusters (`C1`–`C6`). Review
checkpoints are a separate sequence: `R01` occurs after `T05`, through `R06`
after `T30`. Their source configs use cumulative lesson eligibility while each
checkpoint samples an interleaved subset. A lesson exposes a large item bank,
but a learner sees only an adaptive subset.

```text
Assignment card
  -> entry check
  -> three vocabulary micro-sets
  -> adaptive controlled practice
  -> topic-linked Reading attempt
  -> evidence-based Reading correction
  -> Listening attempt
  -> evidence-based Listening correction
  -> grammar / controlled rewrite
  -> Writing Insight (reference only)
  -> Speaking Lab (ungraded practice)
  -> core completed
  -> D+1 review
  -> lesson completed
  -> D+7 review
  -> retained
```

The next lesson may be opened after `core_completed`. An overdue D+1 or D+7
review remains visible and affects retention reporting, but must not trap the
learner in an infinite remediation loop.

## 4. Activity policies

Every activity has explicit policy fields. Renderers must not infer behavior
from a title such as "Writing" or "Assessment".

| Field | Allowed values |
|---|---|
| `interaction_policy` | `read_only`, `self_check`, `auto_graded`, `practice_recording` |
| `grading_policy` | `none`, `self_check`, `automatic` |
| `completion_policy` | `required`, `optional`, `reference_only` |
| `reveal_policy` | `always`, `after_attempt`, `after_guided_retry`, `admin_only` |

No lesson activity may use `teacher_graded`. Teacher grading belongs to a
separate assignment record and its existing skill pipeline.

### 4.1 Writing Insight

Required contract:

```json
{
  "activity_type": "writing_reference",
  "interaction_policy": "read_only",
  "grading_policy": "none",
  "completion_policy": "reference_only",
  "reveal_policy": "always",
  "submittable": false,
  "teacher_assignment_required_for_grading": true,
  "content": {
    "prompt": {},
    "prompt_analysis": [],
    "idea_map": [],
    "outline": [],
    "useful_language": [],
    "annotated_examples": [],
    "common_traps": [],
    "tasks": {
      "task_1": {
        "prompt": [],
        "source_data": [],
        "illustrations": [],
        "model_answers": [],
        "band_comparison": []
      },
      "task_2": {
        "prompt": [],
        "idea_sections": [],
        "word_bank": [],
        "model_answers": [],
        "band_comparison": []
      }
    }
  }
}
```

The learner may expand, bookmark or mark the reference as viewed. Those actions
are navigation state, not mastery evidence. There is no textarea, autosaved
essay, submit button, AI grading call, mandatory revision or IELTS band.

If a related teacher assignment exists, the lesson may show a separate link:
`Mở bài Writing giáo viên đã giao`. The link targets the existing assignment;
it does not embed the submission in the lesson and does not change lesson
completion.

The canonical Writing references come from
`Advanced/03_Writing/WT1_Question_Bank_Advanced.docx`,
`WT2_Question_Bank_Advanced.docx` and `WT2_Idea_Bank_Advanced.docx`.
Each topic may expose the authored Band 7 and Band 8 model answers as collapsed,
read-only reference panels. Their labels describe the source material; they do
not constitute a learner score or a promise that copying Band 8 complexity will
improve a submission. Task 1 uses the matching SVG illustration as the primary
chart, with the rendered PNG retained as a fallback. Both assets remain tied to
the source checksums.

### 4.2 Speaking Lab

The default policy is:

```json
{
  "activity_type": "speaking_practice",
  "interaction_policy": "practice_recording",
  "grading_policy": "none",
  "completion_policy": "optional",
  "reveal_policy": "always",
  "graded_by_default": false
}
```

A local or protected rehearsal recording may be discarded by the learner.
Recording, transcript generation and playback do not create an IELTS score.
Grading is available only when a separate teacher assignment exists.

The learner-facing presentation turns the authored sentence-upgrade material
into a short rehearsal flow instead of a long document:

- show `choose a situation -> speak naturally -> compare the ladder` as the
  three-step instruction;
- expose every authored example through a compact situation navigator;
- render Band 6 as the baseline, Band 7 as the practical target and Band 8 as
  an optional extension, with the named language technique separated from the
  example sentence;
- never hide examples through an arbitrary UI slice or imply that Band 8
  complexity is required for completion.

### 4.3 Controlled rewrite

Sentence transformation and grammar rewrite remain lesson exercises. They may
be `self_check` or `auto_graded`, but they are not Writing submissions and must
not enter `course_writing_submissions` or `writing_essays`.

## 5. Reading and Listening contracts

### 5.1 Reading

T01–T30 each require the matching structured Reading lesson from
`Reading_Lessons_Web/Source_JSON`.

- The learner sees the full topic-linked passage and all 13–14 questions in
  the canonical source; the converter must not pad or truncate a lesson to
  force a uniform count.
- Answers, evidence, trap analysis and distractor analysis are separated from
  the learner question objects and revealed only after an attempt.
- Reading is required Day-0 practice because it supplies the extended context
  in which the lesson vocabulary is encountered.
- Reading answers are automatically checked, but the result is practice
  evidence only; it is not an IELTS band score.
- On desktop, passage and question panes share a bounded workspace and scroll
  independently so the learner can keep evidence in view while answering.
- On narrow screens, a `Bài đọc / Câu hỏi` switch replaces the squeezed
  two-column view; each pane retains its own scroll position.
- Consecutive questions are grouped by question type. Shared material such as
  a summary used by questions 5–8 is rendered once with one answer control per
  question, rather than repeated four times.
- The question pane shows answered progress, while answer checking remains at
  the end of the pane and does not reveal private solution data early.

### 5.2 Listening

T01–T30 each require one structured Listening object with six questions.

- The first attempt uses one approved `full_test.mp3`.
- Evidence replay uses question-level time spans over that same asset.
- `options` contains learner-visible options only.
- Distractor explanations live in `distractor_rationales`, keyed by option.
- Option keys must be unique within a question.
- Answers, evidence, transcript and rationales are not present in the initial
  learner payload.
- First-attempt score is immutable. Correction results are stored separately.
- Opening an explanation is not correction evidence.

Media state is independent from content publication:

```text
missing -> pending_render -> rendered_review_required -> approved -> retired
                                |-> qc_failed
```

`rendered_review_required` means the audio exists but still has release
blockers. It is never playable in production.

## 6. Writing assignment boundary

The only accepted graded-writing path is:

```text
admin creates writing_assignment
  -> student receives assignment
  -> student submits through Writing workflow
  -> existing grader evaluates it
  -> teacher reviews/delivers feedback
```

Backend enforcement must reject any grading request without a valid active
assignment belonging to the learner. A `course_unit_version_id` or
`recommended_from_lesson_id` may be stored as provenance on a prompt or
assignment, but it is not authorization to grade.

## 7. State model

One vocabulary state machine and one lesson state machine are canonical.

### Lesson

```text
assigned -> in_progress -> core_completed -> completed -> retained
               |               |                 |
               -> paused       -> review_due     -> reopened
               -> overdue
```

- `core_completed`: required Day-0 interactive work is complete.
- `completed`: D+1 passed or its finite repair set was completed.
- `retained`: D+7 evidence meets the retention threshold.
- Writing reference and optional Speaking practice never block these states.

### Lexeme

```text
unseen -> introduced -> recognized -> retrievable -> controlled -> retained
                              |             |             |
                              -> fragile    -> needs_repair -> reopened
```

`controlled` is usage in a constrained vocab/grammar item. It does not claim
that the learner can write an IELTS essay with the lexeme. The course must not
show a learner IELTS band based on this state.

## 8. Data ownership

Reuse:

- `courses`: course/syllabus identity;
- `class_assignments` and `class_assignment_items`: assignment entitlement;
- `writing_assignments`: the only graded-writing authorization and lifecycle.

Add in a later migration after this contract is accepted by implementation:

- reusable `course_units`;
- immutable `course_unit_versions`;
- ordered `course_activities` or an equivalent validated content document;
- learner `learning_runs` and `activity_attempts`;
- lexeme evidence and review schedule.

Do not use `class_lessons` as reusable curriculum. It is a cohort-session note
and deliberately has no submission workflow.

## 9. Publication axes

Do not overload one status with unrelated concerns:

- content lifecycle: `draft`, `ready`, `published`, `retired`, `superseded`;
- audience: `assigned_only`, later `public_catalog`;
- media lifecycle: as defined in section 5;
- learner progress: as defined in section 7.

Release 1 requires `audience=assigned_only` and exactly 30 manifest lessons.
Import never automatically publishes content.

## 10. Validation gates

### Package validity

- manifest contains exactly `ADV-T01`–`ADV-T30` once each;
- lesson IDs, activity IDs, item IDs and lesson-lexeme IDs are unique;
- every lesson has exactly 24 vocabulary entries;
- all referenced lexemes and relative asset paths are valid;
- every vocabulary card in the publishable core package has Kokoro audio for
  both the headword and its example, with file checksums;
- every MCQ has unique option keys and one valid answer;
- activity policies are explicit;
- Writing Insight is non-submittable, ungraded and reference-only;
- Speaking is ungraded by default;
- all six Listening items map to answer, evidence and timing records;
- source and converter provenance are present.

### Publish readiness

`schema_valid` is not `publish_ready`. Publish requires:

- zero validation errors;
- every warning acknowledged or resolved;
- approved media for every required Listening activity;
- no answer/model leakage in the initial learner payload;
- teacher/content-owner sign-off;
- immutable version and checksum.

Missing `common_error`, missing citation metadata, pending media and human-QA
requirements must appear as warnings or blockers. A content-owner approval can
resolve a media warning only when the package keeps the original source status,
the original blockers and an explicit approval reference as immutable audit
metadata; approval must never rewrite the source manifest into a false state.

The core-30 remediation layer is versioned separately from the shared source
folder. It may fill only blank `common_error` fields and must reject unknown or
unused override keys. The current overlay contains 88 lesson-card entries.
Vocabulary audio is generated locally with Kokoro (`bf_emma`) into a
content-addressed bundle. Identical text/voice/model inputs share one clip; every
card still exposes separate `audio_headword` and `audio_example` references.

## 11. Acceptance scenarios

1. Opening or scrolling every section does not complete a lesson.
2. Completing all required Day-0 interactions can reach `core_completed`
   without any Writing or Speaking submission.
3. Writing Insight has no submission endpoint, grading request or revision gate.
4. A writing grading request without a learner-owned teacher assignment is
   rejected.
5. A valid teacher-assigned Writing task still uses the existing Writing
   workflow unchanged.
6. Speaking practice produces no grade by default.
7. An MCQ with duplicate option keys fails package validation.
8. Initial learner payloads contain no answers, evidence transcript or model
   rationales for locked activities.
9. `rendered_review_required` audio is visible to admins but unavailable to
   learners.
10. The first-release progress denominator is 30, never 33.
11. D+1 and D+7 preserve first-attempt history and add new evidence.
12. Rebuilding an unchanged package preserves stable IDs and checksums.

## 12. Delivery phases

1. Contract and package validator.
2. Repair the source converter and rebuild a 30-lesson package.
3. Human QA the Listening assets and correct structured item defects.
4. Add versioned curriculum persistence and assignment entitlement.
5. Build the learner runtime for one pilot lesson and one cluster review.
6. Pilot with a small assigned cohort before importing all 30 lessons.
7. Add public catalog/self-enrolment only after assignment-led analytics are
   stable.

## 13. Reproducible core-30 build

Generate the content-addressed Kokoro bundle first, then assemble a new package:

```bash
cd backend
python scripts/generate_advanced_vocab_audio.py SOURCE_ROOT NEW_AUDIO_BUNDLE --voice bf_emma
python scripts/build_advanced_vocab_package.py SOURCE_ROOT NEW_PACKAGE \
  --vocab-audio-bundle NEW_AUDIO_BUNDLE \
  --media-approval-ref CONTENT_OWNER_APPROVAL_REF
python scripts/validate_advanced_vocab_package.py NEW_PACKAGE
```

Both generators refuse to overwrite an existing destination. The media approval
reference is required to turn source `REVIEW_REQUIRED` Listening files into
learner-playable package assets; the source status and blockers remain recorded.
