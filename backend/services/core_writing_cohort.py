"""Current outcomes for a bounded closed Writing admission cohort, not Gate F PASS.

The private SQL RPC supplies one coherent snapshot including unbound episodes.
No observation receipts, raw content, public endpoint or mutation is used here.
"""
from collections import Counter
from datetime import datetime
from uuid import UUID

from services import core_admission
from services.core_attempt_outcomes import writing_outcome

STATES = ('success', 'failed', 'pending', 'unresumable', 'unstarted', 'unstarted_expired', 'unknown')


def _uuid(value):
    return UUID(value) if isinstance(value, str) else None


def _time(value):
    value = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if value.utcoffset() is None: raise ValueError('naive snapshot clock')
    return value


def _outcome(episode, snapshot):
    """Every retained episode receives exactly one state, never inferred abandon."""
    try:
        resource, principal = _uuid(episode['resource_id']), _uuid(episode['principal_id'])
        if not resource or not principal or _uuid(episode['scope_key']) != resource:
            return 'unknown', 'scope_inconsistent'
        source, origin, binding = episode['source'], episode['origin'], episode['binding']
        if not source or _uuid(source['id']) != resource or _uuid(episode['source_owner_id']) != principal:
            return 'unknown', 'source_missing_or_owner_changed'
        if not _uuid(source['student_id']) or not origin or origin['student_id'] != source['student_id'] or origin['invalidated_at'] or origin['deleted_at']:
            return 'unknown', 'provenance_missing_or_invalidated'
        commands = episode['commands']
        if set(commands) != {'accepted', 'bound', 'fenced'} or any(type(v) is not int or v < 0 for v in commands.values()) or not sum(commands.values()):
            return 'unknown', 'command_history_incomplete'
        if binding is None:
            if commands['bound'] or origin['first_activity'] is not None or source['started_at'] is not None or source['status'] != 'pending' or source['essay_id'] is not None:
                return 'unknown', 'unbound_source_activity'
            if commands['accepted']: return 'unstarted', 'command_awaits_execution_or_fencing'
            return 'unstarted_expired', 'commands_fenced_without_start'
        if (binding['domain'] != 'writing_assignment' or _uuid(binding['canonical_id']) != resource
                or _uuid(binding['principal_id']) != principal or origin['first_activity'] != 'admitted'
                or not commands['bound'] or not source['started_at']):
            return 'unknown', 'binding_inconsistent'
        _time(source['started_at'])
        essay = source.get('essay')
        if essay and essay.get('status') == 'failed' and (not isinstance(essay.get('jobs'), list) or len(essay['jobs']) > 1000):
            return 'unknown', 'job_metadata_incomplete'
        outcome = writing_outcome(source, resource)
        if outcome.state == 'pending' and source['status'] in {'pending', 'in_progress'}:
            if source['renderer_affinity'] not in {'legacy', 'next'}:
                return 'unknown', 'renderer_metadata_invalid'
            if _time(source['renderer_affinity_expires_at']) <= snapshot:
                return 'unresumable', 'writing_renderer_lease_expired'
        return outcome.state, outcome.reason
    except (KeyError, TypeError, ValueError, AttributeError):
        return 'unknown', 'source_metadata_invalid'


def summarize_writing_cohort(raw, epoch_id: UUID) -> dict:
    """Reject a malformed/truncated cohort instead of certifying a partial count."""
    try:
        if not isinstance(epoch_id, UUID) or _uuid(raw['epoch_id']) != epoch_id:
            raise ValueError('wrong cohort')
        snapshot, closed = _time(raw['snapshot_at']), _time(raw['closed_at'])
        if snapshot < closed: raise ValueError('snapshot precedes closure')
        episodes, count = raw['episodes'], raw['episode_count']
        if type(count) is not int or not 0 <= count <= 1000 or not isinstance(episodes, list) or len(episodes) != count:
            raise ValueError('incomplete cohort')
        ids = [_uuid(row['episode_id']) for row in episodes]
        if None in ids or len(set(ids)) != count or any(_uuid(row['first_epoch_id']) != epoch_id for row in episodes):
            raise ValueError('duplicate or wrong membership')
        outcomes = [_outcome(row, snapshot) for row in episodes]
        if any(state not in STATES for state, _ in outcomes): raise ValueError('unsupported state')
        states = {state: sum(current == state for current, _ in outcomes) for state in STATES}
        return {'version': 1, 'epoch_id': str(epoch_id), 'snapshot_at': snapshot.isoformat(),
            'closed_at': closed.isoformat(), 'admitted_episode_count': count, 'states': states,
            'reasons': dict(sorted(Counter(reason for _, reason in outcomes).items())),
            'coverage': 'unknown', 'gate_f': 'not_assessed'}
    except (KeyError, TypeError, ValueError, AttributeError):
        raise core_admission.AdmissionUncertain('invalid writing cohort snapshot') from None


async def read_writing_cohort(epoch_id: UUID) -> dict:
    if not isinstance(epoch_id, UUID): raise core_admission.AdmissionInvalid('invalid cohort identity')
    raw = await core_admission._rpc('fn_read_writing_admission_cohort', {'p_epoch_id': str(epoch_id)})
    return summarize_writing_cohort(raw, epoch_id)
