"""Preserve spoken text and every non-target field in the Cam19 follow-up."""
from copy import deepcopy

import pytest

from content_mock_correction.cam19_audit_20261024 import repair_followup


def bundle():
    def exercise(identity, numbers, solutions):
        return {"id": identity, "payload": {
            "questions": [{"q_num": n, "prompt": f"Question {n}"} for n in numbers],
            "answers": {str(n): "B" for n in numbers},
            "audio_windows": {str(n): {"start": n, "end": n + 1} for n in numbers},
            "solutions": solutions,
        }}

    return {
        "MOCK0016-PROD-20261006-ILR-LIS-CAM-B19-T1-REV01": {
            "test": {"id": "test1", "status": "published", "audio_url": "unchanged.mp3"},
            "children": [{"transcript": "**Colin:** Original transcript stays unchanged."}],
            "items": [exercise("pair1", [21, 22], {
                str(n): {"script": "**Colin:** Yes. It's been hard work.\n\n**Marie:** Keep **other emphasis** intact.", "why_correct": "unchanged"}
                for n in (21, 22)
            }), exercise("pair2", [23, 24], {
                str(n): {"script": "**Marie:** No, things like milk and juice as well.\n\n**Colin:** Right.", "why_correct": "unchanged"}
                for n in (23, 24)
            })],
        },
        "MOCK0016-PROD-20261006-ILR-LIS-CAM-B19-T4-REV01": {
            "test": {"id": "test4", "status": "published", "audio_url": "unchanged4.mp3"},
            "children": [{"transcript": "Original words"}],
            "items": [exercise("q7", [7, 8], {"7": {
                "vocab_focus": "- **sell-by date** /ˈsel.baɪ deɪt/ (n) — hạn dùng ghi trên bao bì\n- sell-by date: mốc để cửa hàng bán hàng; không đồng nghĩa use-by date (hạn sử dụng).",
                "script": "KAEDEN: Put a yellow one on the package.",
            }, "8": {"script": "Unrelated **speaker** and text"}})],
        },
        "unrelated": {"test": {"id": "other"}, "items": [{"id": "other-q"}]},
    }


def leaves_changed(a, b, path=()):
    if isinstance(a, dict):
        assert a.keys() == b.keys()
        return [p for k in a for p in leaves_changed(a[k], b[k], path + (k,))]
    if isinstance(a, list):
        assert len(a) == len(b)
        return [p for i, v in enumerate(a) for p in leaves_changed(v, b[i], path + (i,))]
    return [path] if a != b else []


def test_only_four_script_fields_and_one_gloss_change_without_mutating_input():
    before = bundle()
    original = deepcopy(before)
    after = repair_followup(before)
    assert before == original
    changed = leaves_changed(before, after)
    assert len(changed) == 5
    assert sorted(p[-1] for p in changed) == ["script"] * 4 + ["vocab_focus"]
    for path in changed:
        a, b = before, after
        for part in path:
            a, b = a[part], b[part]
        if path[-1] == "script":
            assert b == a.replace("**Colin:**", "Colin:").replace("**Marie:**", "Marie:")
            assert b.replace("Colin:", "**Colin:**").replace("Marie:", "**Marie:**") == a
        else:
            assert "— hạn bán (ngày cuối được bày bán)" in b
            assert "không đồng nghĩa use-by date (hạn sử dụng)." in b


def test_retry_is_idempotent():
    once = repair_followup(bundle())
    assert repair_followup(once) == once


def test_unreviewed_gloss_is_rejected_without_mutating_any_input():
    before = bundle()
    before["MOCK0016-PROD-20261006-ILR-LIS-CAM-B19-T4-REV01"]["items"][0]["payload"]["solutions"]["7"]["vocab_focus"] = "Different editorial content"
    original = deepcopy(before)
    with pytest.raises(ValueError, match="differs from the reviewed source"):
        repair_followup(before)
    assert before == original
