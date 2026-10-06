"""Allowlisted reads and asset attestations for immutable source-book lessons."""
from __future__ import annotations

import hashlib
from typing import Any, Callable
from fastapi import HTTPException
from pydantic import ValidationError
from models.listening_source_collection import (
    SOURCE_COLLECTION, SOURCE_CONTRACT, SOURCE_PROGRAMME, SourceBlock,
    SourceStudyBlock, SourceExplanation, SourcePosition, SourceResponseField,
)
from services.listening_package_import import PackageValidationError

GROUP_TITLES = {
    "short_practice": "Bài nghe ngắn · Day 1–50",
    "teaching": "Luyện kỹ năng · Day 51–60",
    "vocabulary": "Từ vựng · Day 61–70",
    "mock": "Đề mô phỏng từ sách · Day 71–80",
}

SOURCE_ONLY_UNRESOLVED = "Chưa đủ dữ kiện đáng tin cậy để mở câu này thành bài luyện."
SOURCE_ONLY_MISSING_AUDIO = "Câu này chưa có bản ghi gốc phù hợp để xác minh và mở luyện."
SOURCE_ONLY_STUDY = "Câu này chưa đủ điều kiện làm bài luyện độc lập."
UNOPENED_STUDY_DESCRIPTION = "Tài liệu tự học từ nguồn. Mở để xem nội dung đối chiếu."
UNOPENED_STUDY_INSTRUCTION = "Đây là tài liệu tự học; mở nội dung sẽ chuyển sang chế độ có hỗ trợ."


def published_package(db: Any) -> dict:
    rows = (db.table("listening_content_packages")
            .select("id,package_id,manifest_sha256,title,validation_summary")
            .eq("programme_id", SOURCE_PROGRAMME).eq("status", "published").execute().data or [])
    if not rows:
        raise HTTPException(404, "Bộ 80 ngày chưa được xuất bản.")
    if len(rows) != 1 or (rows[0].get("validation_summary") or {}).get("source_contract") != SOURCE_CONTRACT:
        raise HTTPException(503, "Không xác định được phiên bản nội dung; hãy thử lại.")
    return rows[0]


def source_lessons(db: Any, package: dict, day: int | None = None) -> list[dict]:
    query = (db.table("listening_lessons")
             .select("id,source_lesson_id,title,sequence_num,metadata")
             .eq("package_id", package["id"]).eq("programme_id", SOURCE_PROGRAMME)
             .eq("status", "published"))
    if day is not None:
        query = query.eq("sequence_num", day)
    return query.order("sequence_num").execute().data or []


def source_forms(db: Any, package: dict) -> list[dict]:
    return (db.table("listening_tests")
            .select("id,source_form_id,title,listening_lesson_id,source_item_count,full_audio_duration_seconds,metadata")
            .eq("content_package_id", package["id"]).eq("programme_id", SOURCE_PROGRAMME)
            .eq("status", "published").eq("is_public", True).eq("scoring_policy", "report_only")
            .execute().data or [])


def source_metadata(lesson: dict) -> dict:
    metadata = (lesson.get("metadata") or {}).get("source_book")
    if not isinstance(metadata, dict) or metadata.get("source_contract") != SOURCE_CONTRACT:
        raise HTTPException(503, "Nội dung nguồn chưa hợp lệ; hãy thử lại.")
    return metadata


def safe_source_block_metadata(block: dict, *, study_opened: bool = False) -> dict:
    from models.listening_source_collection import SourceInstruction, SourceOption, SourceImage
    if block.get("display_kind") == "source_study" and not study_opened:
        # Resource titles/headings can themselves contain solved keys. Preserve
        # their full authoring only after the deliberate study request.
        block = {**block, "description": UNOPENED_STUDY_DESCRIPTION,
                 "instruction": {"source_en": "", "student_vi": UNOPENED_STUDY_INSTRUCTION},
                 "shared_options": [], "images": []}
    allowed = {key: block[key] for key in ("block_id", "part_id", "kind", "item_ids", "source_question_numbers", "description", "display_kind", "study_available") if key in block}
    allowed = {key: value for key, value in allowed.items() if not isinstance(value, dict)}
    allowed["instruction"] = SourceInstruction.model_validate(block.get("instruction") or {}).model_dump()
    allowed["shared_options"] = [SourceOption.model_validate(option).model_dump() for option in block.get("shared_options") or []]
    allowed = SourceBlock.model_validate(allowed | {"images": []}).model_dump()
    allowed["images"] = []
    for asset in block.get("images") or []:
        image = SourceImage.model_validate({key: asset.get(key) for key in ("asset_id", "width", "height", "alt_vi")} | {"url": asset.get("storage_path")}).model_dump()
        allowed["images"].append({key: image[key] for key in ("asset_id", "width", "height", "alt_vi")} | {"storage_path": image["url"]})
    return allowed


def sign_source_block(block: dict, signer: Callable[[str], str | None], *, study_opened: bool = False,
                      presentation_source: dict | None = None, manifest_sha256: str | None = None,
                      runtime_questions: list[dict] | None = None) -> dict:
    """Build a new block from safe fields; never echo raw nested authoring JSON."""
    try:
        from services.listening_source_native import native_presentation, native_instruction_vi
        source_block = presentation_source if presentation_source is not None else block
        native = native_presentation(source_block, study_opened=study_opened, manifest_sha256=manifest_sha256,
                                     runtime_questions=runtime_questions)
        instruction_vi = native_instruction_vi(source_block, manifest_sha256=manifest_sha256) if native is not None else None
        images = []
        if native is not None and native["figures"]:
            from services.listening_source_figures import signed_figures
            images = signed_figures(native, manifest_sha256, signer)
            native = {**native, "figures": []}
        block = safe_source_block_metadata(block, study_opened=study_opened)
        if instruction_vi is not None:
            block["instruction"]["student_vi"] = instruction_vi
    except (ValidationError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(503, "Thông tin bài nguồn chưa hợp lệ.") from exc
    # Archival PDF crops remain source evidence, never learner question content.
    # Generated images are signed only after the exact native revision is bound.
    try:
        return SourceBlock.model_validate({
            key: block[key] for key in ("block_id", "part_id", "kind", "instruction", "item_ids",
                "source_question_numbers", "shared_options", "description", "display_kind", "study_available") if key in block
        } | {"images": images, "native": native}).model_dump()
    except (ValidationError, KeyError, TypeError) as exc:
        raise HTTPException(503, "Thông tin bài nguồn chưa hợp lệ.") from exc


def day_card(lesson: dict, forms: list[dict], states: dict) -> dict:
    meta = source_metadata(lesson)
    own = [form for form in forms if str(form.get("listening_lesson_id")) == str(lesson["id"])]
    return {
        "day": lesson["sequence_num"], "lesson_id": str(lesson["id"]),
        "title": "Mock 7 · Nghe audio buổi học" if lesson["sequence_num"] == 77 else lesson["title"],
        "group": meta["group"], "availability": meta["availability"],
        "source_position_count": meta["source_position_count"],
        "practice_item_count": sum(int(form.get("source_item_count") or 0) for form in own),
        "source_only_count": meta["source_only_count"], "form_count": len(own),
        "completed_form_count": sum(bool(states.get(str(form["id"]), {}).get("completed")) for form in own),
        "independent_completed_form_count": sum(bool(states.get(str(form["id"]), {}).get("independent_completed")) for form in own),
        "in_progress_form_count": sum(bool(states.get(str(form["id"]), {}).get("in_progress")) for form in own),
        "href": f"/listening/ielts/80-days/{lesson['sequence_num']}",
    }


def public_source_position(position: dict, parts: list[dict], manifest_sha256: str | None = None) -> dict:
    """Limitations are public states, not excerpts from protected explanations."""
    try:
        safe = SourcePosition.model_validate({key: position[key] for key in (
            "item_id", "source_display_number", "part_id", "block_id", "review_status")}).model_dump()
        part = next(part for part in parts if part["part_id"] == safe["part_id"])
        safe["reason_vi"] = (SOURCE_ONLY_UNRESOLVED if safe["review_status"] == "UNRESOLVED"
                             else SOURCE_ONLY_MISSING_AUDIO if part["audio_status"] == "missing"
                             else SOURCE_ONLY_STUDY)
        if (manifest_sha256 == "29819c11a65c71762d7912c919c459df306ed61209a36311a8e23c0d21f83841"
                and safe["item_id"] == "80-days:day-29:main:q-13"
                and safe["review_status"] == "UNRESOLVED"):
            safe["reason_vi"] = "Audio không nêu giờ khởi hành được hỏi ở câu này; chưa đủ dữ kiện để mở luyện."
        return safe
    except (ValidationError, KeyError, TypeError, StopIteration) as exc:
        raise HTTPException(503, "Thông tin vị trí nguồn chưa hợp lệ.") from exc


def day_response(package: dict, lesson: dict, forms: list[dict], states: dict,
                 signer: Callable[[str], str | None], partial: bool) -> dict:
    meta = source_metadata(lesson)
    own = {str(form["source_form_id"]): form for form in forms
           if str(form.get("listening_lesson_id")) == str(lesson["id"])}
    parts = []
    for part in meta["parts"]:
        form = own.get(str(part.get("source_form_id") or ""))
        public_form = None
        if form:
            state = states.get(str(form["id"]), {})
            attempt = state.get("in_progress") or state.get("completed") or {}
            status = "in_progress" if state.get("in_progress") else "completed" if state.get("completed") else "new"
            public_form = {"id": str(form["id"]), "source_form_id": form["source_form_id"],
                "title": form["title"], "item_count": form["source_item_count"],
                "duration_seconds": form.get("full_audio_duration_seconds") or 0,
                "status": status, "assisted": bool(attempt.get("assisted")),
                "attempt_id": str(attempt["id"]) if attempt else None,
                "href": (f"/listening/programmes/result/{attempt['id']}" if status == "completed"
                         else f"/listening/programmes/form/{form['id']}")}
        parts.append({key: part[key] for key in ("part_id", "source_label", "item_count",
            "source_position_count", "audio_status", "timing_granularity")} | {"form": public_form})
    card = day_card(lesson, forms, states)
    return {"collection_id": SOURCE_COLLECTION, "package_id": package["package_id"],
        "manifest_sha256": package["manifest_sha256"], **{key: card[key] for key in (
            "day", "lesson_id", "title", "group", "availability", "source_position_count", "practice_item_count", "source_only_count")},
        "parts": parts, "blocks": [sign_source_block(block, signer, manifest_sha256=package.get("manifest_sha256"))
                                    for block in meta["blocks"]],
        "vocabulary_groups": meta.get("vocabulary_groups") or [],
        "source_only_positions": [public_source_position(position, parts, package.get("manifest_sha256"))
                                  for position in meta.get("source_only_positions") or []], "partial_data": partial}


def study_response(lesson: dict, block_ids: list[str], signer: Callable[[str], str | None], *,
                   manifest_sha256: str | None = None) -> dict:
    meta = source_metadata(lesson)
    study = (lesson.get("metadata") or {}).get("source_study") or {}
    blocks = {block["block_id"]: block for block in meta["blocks"]}
    if len(set(block_ids)) != len(block_ids):
        raise HTTPException(422, "Không lặp lại mục tài liệu.")
    selected = []
    for block_id in block_ids:
        block = blocks.get(block_id)
        if not block or not block.get("study_available"):
            raise HTTPException(422, "Chỉ mở đối chiếu tài liệu tham khảo ở chế độ này.")
        raw = study.get(block_id)
        if not isinstance(raw, dict):
            raise HTTPException(503, "Chưa tải được tài liệu đối chiếu; hãy thử lại.")
        excluded = {position["item_id"] for position in meta.get("source_only_positions") or []}
        raw_ids = [item.get("item_id") for item in raw.get("items") or []]
        resource = (raw.get("resource_only") is True and block.get("display_kind") == "source_study"
                    and not block["item_ids"] and not block["source_question_numbers"])
        if ((not raw_ids and not resource) or len(set(raw_ids)) != len(raw_ids)
                or not set(raw_ids).issubset(excluded & set(block["item_ids"])) or (resource and raw_ids)):
            raise HTTPException(503, "Tài liệu đối chiếu chứa mục luyện tập chưa được mở.")
        mixed = block.get("display_kind") != "source_study"
        safe_block = {**block, "item_ids": raw_ids, "images": [] if mixed else block.get("images") or []}
        if resource:
            safe_block["description"] = str(raw.get("description") or "")
        try:
            native_block = sign_source_block(safe_block, signer, study_opened=True, presentation_source=block,
                                            manifest_sha256=manifest_sha256)
            if mixed and native_block.get("native"):
                # An explicitly opened mixed block contains only excluded study
                # positions; it must not duplicate eligible practice positions.
                native_block["native"]["questions"] = [question for question in native_block["native"]["questions"]
                                                        if question["item_id"] in raw_ids]
            selected.append(SourceStudyBlock.model_validate(native_block | {
                "items": [{**item, "explanation": source_explanation(item.get("explanation"), item_id=item.get("item_id"))}
                          for item in raw.get("items") or []],
                "transcript": [] if mixed else raw.get("transcript") or [],
            }).model_dump())
        except ValidationError as exc:
            raise HTTPException(503, "Tài liệu đối chiếu chưa hợp lệ.") from exc
    return {"mode": "source_study", "independent_practice": False, "day": lesson["sequence_num"], "blocks": selected}


def safe_source_transcript(rows: Any) -> list[dict]:
    """Untimed source text and citations only; no arbitrary nested authoring."""
    from models.listening_source_collection import SourceEvidence
    if not isinstance(rows, list):
        return []
    output = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        evidence = SourceEvidence.model_validate(row).model_dump(exclude_none=True)
        if "line_index_1_based" in row and row["line_index_1_based"] is None:
            evidence["line_index_1_based"] = None
        evidence.pop("start", None)
        evidence.pop("end", None)
        output.append(evidence | {"text": str(row.get("text") or evidence["quote"])})
    return output


def source_explanation(raw: Any, *, item_id: str | None = None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    try:
        explanation = SourceExplanation.model_validate(raw).model_dump()
        if item_id:
            from services.listening_source_editorial import revised_explanation
            explanation = SourceExplanation.model_validate(revised_explanation(explanation, item_id)).model_dump()
        return explanation
    except ValidationError:
        return None


def source_response_fields(question: dict, *, reference_answer: Any) -> list[dict]:
    """Preserve the native blank order without exposing nested authoring data.

    A malformed multi-gap definition cannot be replaced by object insertion
    order: that would associate answers with the wrong printed blank.
    """
    if question.get("response_type") != "multi_gap_completion":
        return []
    raw = question.get("fields")
    if not isinstance(raw, list) or not raw:
        raise ValueError("Source multi-gap fields are unavailable")
    output = []
    seen = set()
    for field in raw:
        if not isinstance(field, dict):
            raise ValueError("Source multi-gap field is invalid")
        safe = SourceResponseField.model_validate({
            key: field[key] for key in ("field_id", "prompt", "word_limit") if key in field
        }).model_dump()
        field_id = safe["field_id"]
        if field_id != field_id.strip() or field_id in seen:
            raise ValueError("Source multi-gap field identity is invalid")
        seen.add(field_id)
        output.append(safe)
    if not isinstance(reference_answer, dict) or seen != set(reference_answer):
        raise ValueError("Source multi-gap field/reference identity mismatch")
    return output


def verify_source_package_assets(db: Any, *, package_id: str, manifest_sha256: str, bucket_name: str) -> int:
    rows = (db.table("listening_content_packages")
            .select("id,programme_id,manifest_sha256,source_counts,validation_summary")
            .eq("package_id", package_id).limit(1).execute().data or [])
    if not rows or rows[0].get("programme_id") != SOURCE_PROGRAMME or rows[0].get("manifest_sha256") != manifest_sha256:
        raise PackageValidationError("Source package identity/hash mismatch")
    package = rows[0]
    validation = package.get("validation_summary") or {}
    assets = validation.get("runtime_assets")
    if (validation.get("source_contract") != SOURCE_CONTRACT or validation.get("review_complete") is not True
            or validation.get("day_count") != 80 or not isinstance(assets, list) or not assets):
        raise PackageValidationError("Source package lacks complete reviewed attestation")
    prefix = f"source-collections/{package_id}/{manifest_sha256}/"
    bucket = db.storage.from_(bucket_name)
    seen = set()
    for asset in assets:
        if not isinstance(asset, dict) or not str(asset.get("storage_path") or "").startswith(prefix):
            raise PackageValidationError("Source asset is outside immutable package namespace")
        path = asset["storage_path"]
        if path in seen or ".." in path.split("/"):
            raise PackageValidationError("Source asset identity duplicate/traversal")
        seen.add(path)
        try:
            data = bytes(bucket.download(path))
        except Exception as exc:
            raise PackageValidationError(f"Source asset missing: {path}") from exc
        if len(data) != asset.get("size_bytes") or hashlib.sha256(data).hexdigest() != asset.get("sha256"):
            raise PackageValidationError(f"Source asset attestation mismatch: {path}")
    lessons = (db.table("listening_lessons").select("id,sequence_num,metadata")
               .eq("package_id", package["id"]).execute().data or [])
    if sorted(row.get("sequence_num") for row in lessons) != list(range(1, 81)):
        raise PackageValidationError("Source package does not account for all 80 days")
    try:
        metadata = [source_metadata(row) for row in lessons]
    except HTTPException as exc:
        raise PackageValidationError("Source lesson contract mismatch") from exc
    if sum(row["source_position_count"] for row in metadata) != validation.get("source_position_count"):
        raise PackageValidationError("Source position inventory mismatch")
    forms = (db.table("listening_tests").select("id,programme_id,source_item_count,full_audio_storage_path,metadata")
             .eq("content_package_id", package["id"]).execute().data or [])
    stimuli = (db.table("listening_package_stimuli").select("source_audio_path,source_audio_sha256,controlled_transcript_path,controlled_transcript_sha256")
               .eq("package_id", package["id"]).execute().data or [])
    counts = package.get("source_counts") or {}
    if (len(forms) != counts.get("forms") or len(stimuli) != counts.get("stimuli")
            or len(lessons) != counts.get("lessons") or sum(row.get("source_item_count") or 0 for row in forms) != counts.get("items")):
        raise PackageValidationError("Source canonical row counts mismatch")
    by_path = {asset["storage_path"]: asset for asset in assets}
    for form in forms:
        if (form.get("programme_id") != SOURCE_PROGRAMME
                or (form.get("metadata") or {}).get("source_contract") != SOURCE_CONTRACT
                or form.get("full_audio_storage_path") not in seen):
            raise PackageValidationError("Source form lacks attested audio/contract")
    for row in metadata:
        for block in row.get("blocks") or []:
            if any(image.get("storage_path") not in seen for image in block.get("images") or []):
                raise PackageValidationError("Source crop is outside asset attestation")
    for stimulus in stimuli:
        for path_field, hash_field, kind in [("source_audio_path", "source_audio_sha256", "audio"),
                                             ("controlled_transcript_path", "controlled_transcript_sha256", "transcript")]:
            asset = by_path.get(stimulus.get(path_field)) or {}
            if asset.get("sha256") != stimulus.get(hash_field) or asset.get("kind") != kind:
                raise PackageValidationError("Source stimulus lacks bound audio/transcript attestation")
    return len(seen)
