"""Read-only rollout gate for curated admin tools; independent of learner admission.

Editorial work must remain possible before the learner read switch is enabled.
Require the schema ledger instead; never apply a migration as a side effect.
"""
import time
from fastapi import HTTPException
from database import supabase_admin

REQUIRED_MIGRATIONS = (
    '234_vocab_curated_identity_and_editorial.sql',
    '235_vocab_curated_tasks_attempts_mastery.sql',
    '236_vocab_curated_recommendations_and_flags.sql',
    '237_vocab_curated_speaking_signal_maps.sql',
    '238_vocab_curated_pilot_metrics.sql',
    '239_vocab_curated_context_lookups.sql',
)
_cache = None


def clear_cache():
    global _cache
    _cache = None


def schema_available():
    global _cache
    now = time.monotonic()
    if _cache is not None and now < _cache[1]:
        return _cache[0]
    try:
        result = (supabase_admin.table('_schema_migrations').select('filename')
                  .in_('filename', list(REQUIRED_MIGRATIONS)).execute())
        applied = {row['filename'] for row in (result.data or [])}
        ready = set(REQUIRED_MIGRATIONS).issubset(applied)
    except Exception:
        ready = False
    # Fail closed on lookup failure as well as missing migrations.
    _cache = (ready, now + 15)
    return ready


def require_schema():
    if not schema_available():
        raise HTTPException(503, detail={
            'error_code': 'feature_unavailable',
            'message': 'Công cụ Vocabulary Curated chưa sẵn sàng trên môi trường này. Vui lòng thử lại sau khi hoàn tất triển khai.',
        })
