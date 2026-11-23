"""Per-learner data inventory for account erasure and export (ACCOUNTDATA-0100).

Every column that points at a user (FR-006 rule, see
``scripts/account_data_inventory_scan.py``) has exactly one entry here.
``tests/test_account_data_inventory.py`` replays ``backend/migrations/*.sql``
and fails when a user-pointing column has no entry, or an entry names a
column that no longer exists, so a new table cannot slip past erasure.

Actions:

* ``delete``     – rows owned by the learner are deleted on erasure.
* ``anonymize``  – the row stays; personal fields go NULL/tombstone.
* ``keep``       – the row stays and keeps pointing at the anonymised id
                   (commerce records, audit logs; they hold ids only).
* ``staff_actor``– a staff member's actor column; learners never hold it,
                   so erasure never touches it.
* ``staff_only`` – the table only holds staff rows; staff accounts cannot
                   self-delete (FR-001).

``export`` marks the columns whose rows go into the learner's download
(FR-011). ``storage`` names the private bucket whose objects the rows point
at; those objects are deleted before the rows (FR-005 b).

Tables created before the migration system (``users``, ``sessions``,
``access_codes``) are listed in ``PRE_MIGRATION`` and reconciled against the
staging catalog by T001 gate 2 before the erasure code ships.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

Action = Literal["delete", "anonymize", "keep", "staff_actor", "staff_only"]
ACTIONS: frozenset[str] = frozenset({"delete", "anonymize", "keep", "staff_actor", "staff_only"})

INVENTORY_VERSION = "2026-11-23.1"


@dataclass(frozen=True)
class Entry:
    table: str
    column: str
    action: Action
    export: bool = False
    storage: Optional[str] = None
    note: str = ""


@dataclass(frozen=True)
class JsonPath:
    """A JSON path that carries a user id inside a ``keep`` log row."""

    table: str
    column: str
    path: str
    action: Action
    note: str = ""


def _many(action: Action, pairs: str, *, export: bool = False, note: str = "") -> list[Entry]:
    """``"t.c t2.c2"`` → entries; keeps the table below readable."""
    out = []
    for pair in pairs.split():
        table, column = pair.split(".")
        out.append(Entry(table, column, action, export=export, note=note))
    return out


_DELETE_EXPORT = _many(
    "delete",
    """
    sessions.user_id
    grammar_recommendations.user_id speaking_progress_marks.user_id
    writing_essays.student_id writing_drafts.student_id writing_assignments.student_id
    essay_regrade_requests.student_id core_writing_origins.student_id
    course_writing_submissions.user_id course_writing_drafts.user_id
    course_section_submissions.user_id
    class_assignment_items.student_id grammar_lesson_attempts.user_id exam_attempts.user_id
    reading_test_attempts.user_id listening_attempts.user_id listening_sessions.user_id
    listening_test_attempts.user_id dictation_sessions.user_id dictation_attempts.user_id
    mock_exam_assignments.user_id mock_exam_sittings.user_id mock_item_attempts.learner_id
    mock_post_test_captures.learner_id mock_correction_sessions.learner_id
    mock_error_hypotheses.learner_id
    user_vocabulary.user_id vocabulary_exercise_attempts.user_id d1_sessions.user_id
    user_d1_questions.user_id flashcard_stacks.user_id flashcard_reviews.user_id
    flashcard_review_log.user_id quiz_sessions.user_id quiz_attempts.user_id
    quiz_word_stats.user_id vocab_unit_attempts.user_id user_kp_dimension_mastery.user_id
    user_kp_mastery.user_id kp_evidence.user_id vocab_unit_recommendations.user_id
    advanced_vocab_stage_progress.user_id advanced_vocab_question_attempts.user_id
    advanced_vocab_listening_attempts.user_id advanced_vocab_practice_selections.user_id
    advanced_vocab_rewrite_submissions.user_id
    grammar_diagnostic_sessions.user_id grammar_diagnostic_responses.user_id
    grammar_diagnostic_reports.user_id grammar_exposure_events.user_id
    vocabulary_shared_progress.user_id vocabulary_set_receipts.user_id
    vocabulary_set_sessions.user_id
    article_views.user_id saved_articles.user_id library_marks.user_id
    user_feedback.created_by
    learner_goal_events.user_id learner_goal_events.student_id
    """,
    export=True,
)

_DELETE_INTERNAL = _many(
    "delete",
    """
    grading_attempts.user_id ai_deferred_grading_jobs.user_id
    mock_runtime_events.learner_id vocab_curated_cohort_events.user_id
    error_logs.user_id analytics_events.user_id activation_attempts.user_id
    learner_email_outbox.user_id credit_cluster_members.user_id
    account_data_exports.user_id
    """,
    note="internal operational rows, not part of the download",
)

_ANONYMIZE = [
    Entry("users", "id", "anonymize", export=True, note="keep id, role, created_at"),
    Entry("students", "user_id", "anonymize", export=True,
          note="keep row for class statistics; clear name, email, phone (open question 5)"),
]

_KEEP = _many(
    "keep",
    """
    enrollment_orders.user_id entitlements.user_id credit_ledger.user_id
    """,
    export=True,
    note="commerce record, COMMERCE_RECORD_RETENTION_YEARS",
) + _many(
    "keep",
    """
    credit_reservations.user_id credit_covered_requests.user_id
    ai_budget_reservations.user_id ai_usage_logs.user_id
    access_codes.used_by user_code_assignments.user_id
    exercise_book_grant_owners.user_id exercise_book_cohort_grants.grantee_id
    exercise_book_cohort_grant_log.grantee_id student_cohort_memberships.student_id
    class_action_log.student_id class_action_log.actor_user_id
    class_lifecycle_audit.actor_user_id
    student_lifecycle_audit.student_id student_lifecycle_audit.user_id
    student_lifecycle_audit.actor_user_id
    access_code_audit.target_user_id access_code_audit.actor_user_id
    staff_security_audit.target_user_id staff_security_audit.actor_user_id
    staff_privilege_evidence.target_user_id staff_privilege_evidence.actor_user_id
    enrollment_orders.cancelled_by account_deletion_requests.user_id
    """,
    note="ids only; points at the anonymised id",
)

_STAFF_ONLY = _many("staff_only", "staff_mfa_factor_snapshot.user_id staff_mfa_status_throttle.user_id")

_STAFF_ACTOR = _many(
    "staff_actor",
    """
    access_codes.issued_by class_assignments.assigned_by class_lessons.created_by
    cohorts.archived_by cohorts.created_by cohorts.instructor_id
    course_products.archived_by course_products.created_by courses.created_by
    credit_ledger.actor_id enrollment_orders.confirmed_by
    entitlements.granted_by entitlements.revoked_by error_logs.dismissed_by
    essay_regrade_requests.admin_id exam_content_cohorts.created_by
    exercise_book_cohort_grant_log.actor_id exercise_book_cohort_grants.actor_id
    grammar_content_releases.imported_by instructor_reviews.claimed_by
    instructor_writing_assignment_requests.assigned_by lemma_overrides.created_by
    listening_content.created_by listening_content_packages.imported_by
    listening_content_packages.status_changed_by listening_tests.web_explanations_released_by
    mock_correction_release_events.actor_id mock_exams.web_explanations_released_by
    reading_passages.created_by reading_tests.created_by
    reading_tests.web_explanations_released_by speaking_lesson_sets.created_by
    student_cohort_memberships.added_by students.archived_by students.created_by
    students.instructor_id user_feedback.resolved_by vocab_context_lookup_terms.created_by
    vocab_curated_cohort_events.changed_by vocab_learning_units.created_by
    vocab_pathways.created_by vocab_speaking_signal_maps.created_by
    vocab_unit_publication_events.actor_id vocab_unit_version_reviews.reviewer_id
    vocab_unit_versions.authored_by vocab_unit_versions.published_by
    vocabulary_exercises.created_by vocabulary_exercises.reviewed_by
    vocabulary_sets.created_by web_explanation_objects.imported_by
    writing_assignment_requests.assigned_by writing_assignments.assigned_by
    writing_essays.last_edited_by writing_essays.last_regraded_by
    writing_essays.submitted_by_admin writing_prompts.created_by writing_tips.created_by
    """,
)

# The one bucket of learner files the erasure deletes before rows; the
# export bucket is swept by prefix ``<user_id>/`` (FR-005 b, FR-014).
_STORAGE = {
    ("sessions", "user_id"): "audio-responses",
    ("course_pronunciation_submissions", "user_id"): "audio-responses",
}

_DELETE_STORAGE = [
    Entry("course_pronunciation_submissions", "user_id", "delete", export=True,
          storage="audio-responses"),
]

INVENTORY: tuple[Entry, ...] = tuple(
    Entry(e.table, e.column, e.action, e.export, _STORAGE.get((e.table, e.column), e.storage), e.note)
    for e in (
        _DELETE_EXPORT + _DELETE_INTERNAL + _DELETE_STORAGE + _ANONYMIZE + _KEEP
        + _STAFF_ONLY + _STAFF_ACTOR
    )
)

JSON_PATHS: tuple[JsonPath, ...] = (
    JsonPath("access_code_audit", "before", "assigned_user", "keep", "id only"),
    JsonPath("access_code_audit", "after", "assigned_user", "keep", "id only"),
)

# Columns from tables older than the migration system. FR-006: listed by
# hand, reconciled with a read-only staging catalog query (T001 gate 2).
PRE_MIGRATION: frozenset[tuple[str, str]] = frozenset(
    {("users", "id"), ("sessions", "user_id"), ("access_codes", "used_by")}
)

# Tables reached only through a parent's foreign key (no user column of
# their own). Erasure deletes them before the parent. T001 completes this
# list from the catalog; the FR-006 test does not cover it.
CHILD_TABLES: dict[str, str] = {
    "responses": "sessions",
    "dictation_attempt_answers": "dictation_attempts",
    "instructor_reviews": "writing_essays",
}

# Classified ahead of packages not merged yet. Each moves into the lists above
# in the pull request that adds its migration; the FR-006 test fails if one
# appears in migrations while still listed here.
UPCOMING: tuple[Entry, ...] = (
    Entry("learner_care_notes", "student_id", "delete",
          note="mig 442 (#2471); staff notes, never exported (open question 7)"),
    Entry("learner_care_notes", "user_id", "delete",
          note="mig 442 (#2471); author_id/done_by are staff actors (not matched by FR-006)"),
    Entry("learner_active_sessions", "user_id", "delete", note="G04-T09 (not merged)"),
    Entry("learner_login_events", "user_id", "anonymize", note="G04-T16; clear IP, user agent, location"),
)

BUCKETS: frozenset[str] = frozenset({"audio-responses", "account-exports"})

_INDEX: dict[tuple[str, str], Entry] = {}
for _e in INVENTORY:
    if (_e.table, _e.column) in _INDEX:  # pragma: no cover - guarded by test
        raise RuntimeError(f"duplicate inventory entry {_e.table}.{_e.column}")
    _INDEX[(_e.table, _e.column)] = _e


def entry_for(table: str, column: str) -> Optional[Entry]:
    return _INDEX.get((table, column))


def action_for(table: str, column: str) -> Optional[str]:
    entry = _INDEX.get((table, column))
    return entry.action if entry else None


def entries(action: Optional[str] = None) -> tuple[Entry, ...]:
    if action is None:
        return INVENTORY
    return tuple(e for e in INVENTORY if e.action == action)
