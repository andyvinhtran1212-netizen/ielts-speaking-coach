"""Source-bound validation for proposed Listening question translations.

This module validates review drafts only. It does not mark them approved,
modify source packages, or project translations into learner payloads.
"""

from __future__ import annotations

from typing import Any, Iterable


class EditorialValidationError(ValueError):
    """An editorial entry cannot be bound safely to its source question."""


_LANGUAGES = frozenset({"en", "vi"})
_STATUSES = frozenset({"approved_by_owner_not_published", "draft_pending_owner_review"})
_ITEM_FIELDS = frozenset({
    "id", "source_prompt", "source_options", "prompt_en", "prompt_vi",
    "options_en", "options_vi", "unchanged_options_reviewed",
})


def validate_question_batches(
    source_questions: dict[str, dict[str, dict[str, Any]]],
    batches: Iterable[dict[str, Any]],
    *,
    expected_manifest_sha256: dict[str, str],
    actual_manifest_sha256: dict[str, str],
    require_all_drafted: bool = False,
    require_all_approved: bool = False,
) -> dict[str, Any]:
    """Check exact source identity, prompt, options and review state.

    ``source_questions`` is keyed by immutable package ID, then source item ID.
    The caller must build it from a verified package. Manifest locks are
    required separately: matching question text alone cannot prove media and
    timing remained on the approved source revision.
    """
    if set(source_questions) != set(expected_manifest_sha256) or set(source_questions) != set(actual_manifest_sha256):
        raise EditorialValidationError("Source package/manifests không cùng tập ID")
    for package_id, expected in expected_manifest_sha256.items():
        if actual_manifest_sha256[package_id] != expected:
            raise EditorialValidationError(f"Source manifest đã đổi: {package_id}")

    seen: set[tuple[str, str]] = set()
    batch_ids: set[str] = set()
    drafted = approved = 0
    for batch in batches:
        if not isinstance(batch, dict):
            raise EditorialValidationError("Batch không phải object")
        batch_id = batch.get("batch_id")
        package_id = batch.get("source_package_id")
        source_language = batch.get("source_language")
        target_language = batch.get("target_language")
        status = batch.get("status")
        items = batch.get("items")
        if not isinstance(batch_id, str) or not batch_id or batch_id in batch_ids:
            raise EditorialValidationError(f"Batch ID trùng hoặc thiếu: {batch_id}")
        batch_ids.add(batch_id)
        if not isinstance(package_id, str) or package_id not in source_questions:
            raise EditorialValidationError(f"Source package không có trong lock: {batch_id}")
        if (not isinstance(source_language, str) or not isinstance(target_language, str)
                or source_language not in _LANGUAGES or target_language not in _LANGUAGES
                or source_language == target_language):
            raise EditorialValidationError(f"Hướng dịch không hợp lệ: {batch_id}")
        if not isinstance(status, str) or status not in _STATUSES:
            raise EditorialValidationError(f"Review status không hợp lệ: {batch_id}")
        if not isinstance(items, list) or not items:
            raise EditorialValidationError(f"Batch rỗng: {batch_id}")

        for entry in items:
            if not isinstance(entry, dict) or set(entry) - _ITEM_FIELDS:
                raise EditorialValidationError(f"Item có trường lạ: {batch_id}")
            item_id = entry.get("id")
            if not isinstance(item_id, str) or not item_id:
                raise EditorialValidationError(f"Item ID thiếu: {batch_id}")
            identity = (package_id, item_id)
            if identity in seen:
                raise EditorialValidationError(f"Item ID trùng: {package_id}:{item_id}")
            seen.add(identity)
            source = source_questions[package_id].get(item_id)
            if not isinstance(source, dict):
                raise EditorialValidationError(f"Item không có trong source: {package_id}:{item_id}")
            if entry.get("source_prompt") != source.get("prompt"):
                raise EditorialValidationError(f"Source prompt mismatch: {item_id}")
            target_prompt = entry.get(f"prompt_{target_language}")
            if not isinstance(target_prompt, str) or not target_prompt.strip():
                raise EditorialValidationError(f"Target prompt thiếu: {item_id}")
            if f"prompt_{source_language}" in entry or f"options_{source_language}" in entry:
                raise EditorialValidationError(f"Entry ghi đè ngôn ngữ gốc: {item_id}")

            source_options = source.get("options") or {}
            if not isinstance(source_options, dict):
                raise EditorialValidationError(f"Source options không hợp lệ: {item_id}")
            if source_options:
                if entry.get("source_options") != source_options:
                    raise EditorialValidationError(f"Source options mismatch: {item_id}")
                translated = entry.get(f"options_{target_language}")
                unchanged = entry.get("unchanged_options_reviewed") is True
                if unchanged == (translated is not None):
                    raise EditorialValidationError(f"Option review state không rõ: {item_id}")
                if translated is not None and (
                    not isinstance(translated, dict)
                    or set(translated) != set(source_options)
                    or any(not isinstance(value, str) or not value.strip()
                           for value in translated.values())
                ):
                    raise EditorialValidationError(f"Target option keys/labels không hợp lệ: {item_id}")
            elif (entry.get("source_options") not in (None, {})
                  or entry.get(f"options_{target_language}") is not None
                  or "unchanged_options_reviewed" in entry):
                raise EditorialValidationError(f"Item không có options nhưng draft có: {item_id}")
            drafted += 1
            approved += status == "approved_by_owner_not_published"

    source_ids = {(package_id, item_id) for package_id, items in source_questions.items() for item_id in items}
    missing = source_ids - seen
    if require_all_drafted and missing:
        raise EditorialValidationError(f"Thiếu {len(missing)} item draft")
    if require_all_approved and (missing or approved != len(source_ids)):
        raise EditorialValidationError(
            f"Chưa đủ owner approval: {approved}/{len(source_ids)} item"
        )
    return {
        "source_items": len(source_ids),
        "drafted_items": drafted,
        "approved_items": approved,
        "pending_items": drafted - approved,
        "missing_items": len(missing),
        "batch_count": len(batch_ids),
        "source_manifest_sha256": dict(actual_manifest_sha256),
    }
