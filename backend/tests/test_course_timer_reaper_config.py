import pytest
from pydantic import ValidationError

from config import Settings


def test_course_timer_reaper_cannot_preempt_the_database_delivery_window():
    with pytest.raises(ValidationError):
        Settings(COURSE_TIMER_REAPER_GRACE_SECONDS=14, _env_file=None)

    configured = Settings(
        COURSE_TIMER_REAPER_GRACE_SECONDS=15,
        _env_file=None,
    )
    assert configured.COURSE_TIMER_REAPER_GRACE_SECONDS == 15
