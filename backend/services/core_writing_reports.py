"""Private durable report workflow. No public route, activation or Gate F claim.

Caller supplies a durable report UUID and reuses it after uncertainty. SQL owns
the frozen source snapshot and digests; Python classifies only that snapshot.
"""
import re
from datetime import datetime
from uuid import UUID

from services import core_admission
from services.core_writing_cohort import STATES, summarize_writing_cohort

PROFILE = 'writing-current-v1'  # Semantic classifier changes require a new profile.
DIGEST = re.compile(r'^[a-f0-9]{64}$')
REASONS = frozenset({'scope_inconsistent','source_missing_or_owner_changed','provenance_missing_or_invalidated',
    'command_history_incomplete','unbound_source_activity','command_awaits_execution_or_fencing',
    'commands_fenced_without_start','binding_inconsistent','job_metadata_incomplete','renderer_metadata_invalid',
    'writing_renderer_lease_expired','source_metadata_invalid','writing_state_incomplete','writing_not_submitted',
    'writing_current_feedback_persisted','writing_grading_pending','writing_retry_pending','writing_grading_failed'})


def _identity(report_id, epoch_id=None):
    if not isinstance(report_id, UUID) or (epoch_id is not None and not isinstance(epoch_id, UUID)):
        raise core_admission.AdmissionInvalid('invalid report identity')


def _time(value):
    value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.utcoffset() is None: raise ValueError('invalid clock')
    return value


def _artifact(raw, report_id, epoch_id=None):
    try:
        if raw['id'] != str(report_id) or (epoch_id is not None and raw['epoch_id'] != str(epoch_id)):
            raise ValueError('wrong report')
        epoch = UUID(raw['epoch_id'])
        if raw['classifier_profile'] != PROFILE or any(not DIGEST.fullmatch(raw[key]) for key in ['snapshot_digest','policy_digest']):
            raise ValueError('unknown report profile')
        preview = summarize_writing_cohort(raw['source_snapshot'], epoch)
        created, updated = _time(raw['created_at']), _time(raw['updated_at'])
        if updated < created or created < _time(preview['snapshot_at']): raise ValueError('invalid report clocks')
        summary = raw['summary']
        if summary is None:
            if raw['summary_digest'] is not None or raw['finalized_at'] is not None: raise ValueError('incomplete finalization')
        else:
            if not DIGEST.fullmatch(raw['summary_digest']) or not created <= _time(raw['finalized_at']) <= updated:
                raise ValueError('unconfirmed summary')
            if set(summary) != set(preview) or any(summary[k] != preview[k] for k in
                    ['version','epoch_id','snapshot_at','closed_at','admitted_episode_count','coverage','gate_f']):
                raise ValueError('summary metadata mismatch')
            # Historical finalized outcomes are not reclassified with newer code.
            if (set(summary['states']) != set(STATES) or not isinstance(summary['reasons'], dict)
                    or not set(summary['reasons']) <= REASONS or type(summary['version']) is not int
                    or type(summary['admitted_episode_count']) is not int):
                raise ValueError('invalid summary shape')
            for counts in [summary['states'], summary['reasons']]:
                if any(type(v) is not int or v < 0 for v in counts.values()) or sum(counts.values()) != preview['admitted_episode_count']:
                    raise ValueError('incomplete summary counts')
        return raw
    except (KeyError, TypeError, ValueError, AttributeError):
        raise core_admission.AdmissionUncertain('invalid persisted report acknowledgment') from None


def _public_artifact(raw):
    # No frozen per-learner source metadata in the returned report artifact.
    return {key: raw[key] for key in ['id','epoch_id','classifier_profile','policy_digest',
        'snapshot_digest','summary_digest','created_at','updated_at','finalized_at','summary']}


async def get_writing_report(report_id: UUID) -> dict | None:
    _identity(report_id)
    raw = await core_admission._rpc('fn_get_writing_cohort_report', {'p_report_id': str(report_id)})
    return _public_artifact(_artifact(raw, report_id)) if raw is not None else None


async def create_or_resume_writing_report(report_id: UUID, epoch_id: UUID) -> dict:
    _identity(report_id, epoch_id)
    if not isinstance(epoch_id, UUID):
        raise core_admission.AdmissionInvalid('invalid report identity')
    # Read first: recovery-only can finish an existing capture without allowing
    # new captures. An unknown/missing read is not silently retried as a new ID.
    raw = await core_admission._rpc('fn_get_writing_cohort_report', {'p_report_id': str(report_id)})
    if raw is None:
        raw = await core_admission._rpc('fn_capture_writing_cohort_report',
            {'p_report_id': str(report_id), 'p_epoch_id': str(epoch_id)})
    captured = _artifact(raw, report_id, epoch_id)
    if captured['summary'] is not None: return _public_artifact(captured)
    summary = summarize_writing_cohort(captured['source_snapshot'], epoch_id)
    finalized = _artifact(await core_admission._rpc('fn_finalize_writing_cohort_report',
        {'p_report_id': str(report_id), 'p_snapshot_digest': captured['snapshot_digest'], 'p_summary': summary}), report_id, epoch_id)
    if (any(finalized[key] != captured[key] for key in ['id','epoch_id','classifier_profile','policy_digest',
            'source_snapshot','snapshot_digest','created_at']) or finalized['summary'] != summary):
        raise core_admission.AdmissionUncertain('report finalization not confirmed')
    return _public_artifact(finalized)
