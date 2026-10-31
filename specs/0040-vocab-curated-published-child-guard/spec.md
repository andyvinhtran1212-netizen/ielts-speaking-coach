---
id: VOCABGUARD-0040
title: A review or task of a published curated vocabulary version can never be moved to another version
status: approved
risk: high
owner: product
---

# A review or task of a published curated vocabulary version can never be moved to another version

Approval: Vinh, 2026-10-30 06:59 (UTC+7), verbatim "Ok với đề xuất", relayed by the Leader
(see [`approval-decision.md`](approval-decision.md)). Spec number 0040 and
migration number **355** assigned by the Leader.
Origin: PC-J267; the reparent bypass was found by the curated vocabulary
PostgreSQL test job (PC-J260, see [`research.md`](research.md)).

## Tóm tắt (tiếng Việt)
Bài Vocab curated đã xuất bản phải giữ nguyên review và task. Hiện guard ở DB chỉ xét version đích khi UPDATE, nên một review/task có thể bị chuyển từ version đã xuất bản sang bản nháp. Migration 355 cho guard xét cả version cũ lẫn version mới.

## Problem
`fn_guard_published_vocab_review` (234) and `fn_guard_published_vocab_task` (235) check only NEW.version_id on UPDATE. Updating a published child's version_id to a draft version succeeds, removing it from the published version without an immutable error.

## Scope
- Migration 355 replaces both guard functions; no data, trigger, or grant changes.
- Regression tests on local PostgreSQL.

## Non-goals
- Changing publish, rollback, attempt, or recommendation behaviour.

## Requirements
- **FR-001:** An UPDATE of a curated vocabulary review or task is rejected with its existing immutable error when either its current version or its new version is published; DELETE keeps checking the current version and INSERT keeps checking the new version.

## Acceptance scenarios
### Scenario 1
- **Given** a published version with approved reviews and tasks and a draft version of the same unit
- **When** a review's or task's version_id is updated to the draft version
- **Then** the update fails with published_vocab_review_is_immutable or published_vocab_task_is_immutable and no row changes

### Scenario 2
- **Given** a draft version with reviews and tasks
- **When** they are edited or deleted
- **Then** the changes succeed as today

## Edge cases
- Moving a child between two drafts stays allowed. Moving a draft child into a published version stays rejected (existing behaviour).

## Success criteria
- Both reparenting regression cases pass; every existing curated vocabulary test keeps its result.

## Open questions
- None.
