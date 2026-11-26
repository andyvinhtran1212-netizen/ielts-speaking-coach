# Implementation plan after approval

1. Review the three nullable audit columns proposed in PR #2717 (migration 510). Existing rows with a null marker retain their requirements.
2. Add the admin-only POST /admin/mock-exams/sittings/{sitting_id}/writing-not-applicable with a required reason and a typed canonical sitting response. Authorize before handling an idempotent retry. Serialize eligibility with competing writes and conditional first-mark persistence. Reconcile on both first success and retry. Preserve the first actor, timestamp and reason.
3. In mock_exam_service adapt _sitting_sections, sitting_skills and writing_task_states per sitting. In mock_review_workflow include the marker in roster and required-skills reads, then adapt _required_skills_for. Preserve the existing unique review and release protections.
4. Expose writing_not_applicable and writing_na_eligible to the roster. Wire the confirm dialog and canonical refetch into admin-mock-reviews and its model. Keep learner release controls in the existing workflow.
