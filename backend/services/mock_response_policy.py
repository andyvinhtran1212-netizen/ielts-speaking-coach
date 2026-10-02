"""Reviewed, opt-in marking for newly pinned mock item revisions (Spec0016).

These pure helpers never activate a policy from mutable content at submit.
Admission validates authored metadata and freezes it with the effective key;
submit supplies that protected snapshot explicitly. Provenance validation is
structural: it does not replace the independent source/content acceptance gate.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from datetime import date
from decimal import Decimal
from typing import Any


class ResponsePolicyError(ValueError):
    """An authored or pinned marking contract is unsafe or unsupported."""


_KINDS = {"literal", "phone", "number", "date", "option_id"}
_SETTINGS = {
    "literal": {"case_sensitive"},
    "option_id": {"case_sensitive"},
    "date": {"case_sensitive"},
    "phone": {"presentation_separators", "extension_markers"},
    "number": {"locale", "unit", "unit_position"},
}
_MONTHS = {name: n for n, names in enumerate((
    ("jan", "january"), ("feb", "february"), ("mar", "march"),
    ("apr", "april"), ("may",), ("jun", "june"), ("jul", "july"),
    ("aug", "august"), ("sep", "september"), ("oct", "october"),
    ("nov", "november"), ("dec", "december"),
), 1) for name in names}


def _text(value: str, policy: dict) -> str:
    value = " ".join(value.split())
    return value if policy["settings"].get("case_sensitive", False) else value.casefold()


def _number(value: str, settings: dict) -> tuple[bool, Decimal] | None:
    value = value.strip()
    unit = settings.get("unit", "")
    if unit:
        prefix = settings.get("unit_position", "suffix") == "prefix"
        if not (value.startswith(unit) if prefix else value.endswith(unit)):
            return None
        value = (value[len(unit):] if prefix else value[:-len(unit)]).strip()
    decimal, grouping = ((".", ",") if settings["locale"] == "en" else (",", "."))
    # Grouping must consist of complete three-digit groups. Decimal is never a
    # presentation separator; signs, units and the exact Decimal value survive.
    integer = rf"(?:[0-9]+|[0-9]{{1,3}}(?:{re.escape(grouping)}[0-9]{{3}})+)"
    if not re.fullmatch(rf"[+-]?{integer}(?:{re.escape(decimal)}[0-9]+)?", value):
        return None
    canonical = value.replace(grouping, "").replace(decimal, ".")
    return canonical.startswith("-"), Decimal(canonical)


def _phone(value: str, settings: dict) -> tuple[str, str | None] | None:
    value = value.strip()
    separators = settings["presentation_separators"]
    markers = settings.get("extension_markers", [])
    extension = None
    if markers:
        marker = "|".join(re.escape(part) for part in sorted(markers, key=len, reverse=True))
        match = re.search(rf"(?:{marker})\s*([0-9][0-9{re.escape(''.join(separators))}]*)$", value, re.I)
        if match:
            extension = match.group(1)
            value = value[:match.start()].strip()
    table = str.maketrans("", "", "".join(separators))
    digits = value.translate(table)
    ext = extension.translate(table) if extension is not None else None
    if not re.fullmatch(r"\+?[0-9]+", digits) or (ext is not None and not re.fullmatch(r"[0-9]+", ext)):
        return None
    return digits, ext


def _date_form(value: str) -> tuple[int | None, int, int]:
    """Validate only explicit unambiguous forms; never manufacture date aliases."""
    value = " ".join(value.split()).casefold()
    iso = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})", value)
    if iso:
        parsed = date(*map(int, iso.groups()))
        return parsed.year, parsed.month, parsed.day
    numeric = re.fullmatch(r"([0-9]{1,2})/([0-9]{1,2})(?:/([0-9]{4}))?", value)
    if numeric:
        first, second = int(numeric[1]), int(numeric[2])
        if first <= 12 and second <= 12:
            raise ResponsePolicyError("Ambiguous numeric date order")
        day, month = (first, second) if first > 12 else (second, first)
        date(int(numeric[3] or 2000), month, day)
        return int(numeric[3]) if numeric[3] else None, month, day
    named = re.fullmatch(r"([0-9]{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: ([0-9]{4}))?", value)
    reverse = re.fullmatch(r"([a-z]+) ([0-9]{1,2})(?:st|nd|rd|th)?(?:,? ([0-9]{4}))?", value)
    if named and named[2] in _MONTHS:
        date(int(named[3] or 2000), _MONTHS[named[2]], int(named[1]))
        return int(named[3]) if named[3] else None, _MONTHS[named[2]], int(named[1])
    if reverse and reverse[1] in _MONTHS:
        date(int(reverse[3] or 2000), _MONTHS[reverse[1]], int(reverse[2]))
        return int(reverse[3]) if reverse[3] else None, _MONTHS[reverse[1]], int(reverse[2])
    raise ResponsePolicyError("Date accepted form must be explicit and unambiguous")


def validate_response_policy(raw: Any) -> dict:
    required = {"version", "policy_id", "kind", "accepted_answers", "provenance", "settings"}
    if not isinstance(raw, dict) or not required <= raw.keys() or raw.keys() - required - {"max_words"}:
        raise ResponsePolicyError("Invalid response_policy fields")
    if type(raw["version"]) is not int or raw["version"] != 1 or not isinstance(raw["kind"], str) or raw["kind"] not in _KINDS:
        raise ResponsePolicyError("Unsupported response_policy version/kind")
    if not isinstance(raw["policy_id"], str) or not raw["policy_id"].strip() or len(raw["policy_id"]) > 200:
        raise ResponsePolicyError("Missing response_policy identity")
    forms = raw["accepted_answers"]
    if not isinstance(forms, list) or not 1 <= len(forms) <= 64 or any(
        not isinstance(form, str) or not form.strip() or len(form) > 512 for form in forms
    ) or len(set(forms)) != len(forms):
        raise ResponsePolicyError("Invalid reviewed accepted_answers")
    provenance = raw["provenance"]
    provenance_keys = {"source_item_id", "source_sha256", "item_revision", "reviewer", "review_status"}
    if not isinstance(provenance, dict) or provenance.keys() != provenance_keys or any(
        not isinstance(value, str) or not value.strip() for value in provenance.values()
    ) or provenance["review_status"] != "ACCEPTED" or not re.fullmatch(r"[0-9a-f]{64}", provenance["source_sha256"]):
        raise ResponsePolicyError("Missing accepted item/source provenance")
    settings, kind = raw["settings"], raw["kind"]
    if not isinstance(settings, dict) or settings.keys() - _SETTINGS[kind]:
        raise ResponsePolicyError("Invalid response_policy settings")
    if "case_sensitive" in settings and type(settings["case_sensitive"]) is not bool:
        raise ResponsePolicyError("case_sensitive must be boolean")
    max_words = raw.get("max_words")
    if max_words is not None and (type(max_words) is not int or not 1 <= max_words <= 40):
        raise ResponsePolicyError("Invalid word limit")
    try:
        if kind == "number":
            if settings.get("locale") not in {"en", "de"} or not isinstance(settings.get("unit", ""), str) or settings.get("unit_position", "suffix") not in {"prefix", "suffix"}:
                raise ResponsePolicyError("Number policy requires declared locale/unit placement")
            numeric_forms = [_number(form, settings) for form in forms]
            if numeric_forms[0] is None or any(
                parsed != numeric_forms[0] if parsed is not None else not re.fullmatch(r"[^\W\d_]+(?:[ -][^\W\d_]+)*", form, re.UNICODE)
                for form, parsed in zip(forms, numeric_forms)
            ):
                raise ResponsePolicyError("Number forms change meaning or contain invalid grouping/units")
        elif kind == "phone":
            separators = settings.get("presentation_separators")
            markers = settings.get("extension_markers", [])
            if not isinstance(separators, list) or any(separator not in {" ", "-", "(", ")", "."} for separator in separators) or len(set(separators)) != len(separators) or not isinstance(markers, list) or any(marker not in {"x", "ext", "ext."} for marker in markers) or len(set(markers)) != len(markers):
                raise ResponsePolicyError("Phone presentation separators/extension markers must be explicit")
            phones = [_phone(form, settings) for form in forms]
            if phones[0] is None or any(phone != phones[0] for phone in phones):
                raise ResponsePolicyError("Phone forms change digit/extension identity")
        elif kind == "date":
            dates = [_date_form(form) for form in forms]
            if len({(month, day) for _, month, day in dates}) != 1 or len({year for year, _, _ in dates if year is not None}) > 1:
                raise ResponsePolicyError("Date forms change calendar meaning")
        elif kind == "option_id" and any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]*", form) for form in forms):
            raise ResponsePolicyError("Option answers must be explicit single stable IDs")
        if max_words is not None:
            for form in forms:
                # A formatted phone/number remains one numeric response. Any
                # authored word alias and literal/date form obeys the word cap.
                if kind == "phone" or (kind == "number" and _number(form, settings) is not None):
                    count = 1 + len(settings.get("unit", "").split())
                else:
                    count = len(form.split())
                if count > max_words:
                    raise ResponsePolicyError("Accepted form exceeds authored word limit")
    except (ValueError, TypeError, KeyError) as exc:
        if isinstance(exc, ResponsePolicyError):
            raise
        raise ResponsePolicyError("Invalid response_policy accepted form") from exc
    return copy.deepcopy(raw)


def policy_answer_matches(user: str | None, raw_policy: dict) -> bool:
    policy = validate_response_policy(raw_policy)
    if not isinstance(user, str) or not user.strip() or len(user) > 512:
        return False
    kind, settings = policy["kind"], policy["settings"]
    if kind == "number":
        parsed = _number(user, settings)
        if parsed is not None:
            return parsed == _number(policy["accepted_answers"][0], settings)
        # Written numbers are item-reviewed forms, never a blanket conversion.
        return any(_number(form, settings) is None and _text(user, policy) == _text(form, policy) for form in policy["accepted_answers"])
    if kind == "phone":
        return _phone(user, settings) == _phone(policy["accepted_answers"][0], settings)
    if policy.get("max_words") is not None and len(user.split()) > policy["max_words"]:
        return False
    return any(_text(user, policy) == _text(form, policy) for form in policy["accepted_answers"])


def response_policy_ref(raw_policy: dict) -> dict:
    policy = validate_response_policy(raw_policy)
    digest = hashlib.sha256(json.dumps(policy, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    return {"version": 1, "policy_id": policy["policy_id"], "sha256": digest}


def authored_response_policies(skill: str, rows: list[dict]) -> dict[int, dict]:
    """Extract policies during admission from protected source/marking rows."""
    if skill not in {"reading", "listening"}:
        raise ResponsePolicyError("Unsupported marking domain")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ResponsePolicyError("Invalid protected marking rows")
    items: list[tuple[Any, Any]] = []
    for row in rows:
        if skill == "reading":
            answer = row.get("answer") or {}
            if not isinstance(answer, dict):
                raise ResponsePolicyError("Invalid protected Reading answer")
            if "response_policy" in answer:
                items.append((row.get("q_num"), answer["response_policy"]))
        else:
            payload = row.get("payload") or {}
            if not isinstance(payload, dict) or not isinstance(payload.get("answers", []), list):
                raise ResponsePolicyError("Invalid protected Listening answers")
            for answer in payload.get("answers", []):
                if not isinstance(answer, dict):
                    raise ResponsePolicyError("Invalid protected Listening answer")
                if "response_policy" in answer:
                    items.append((answer.get("q_num"), answer["response_policy"]))
    out: dict[int, dict] = {}
    for q_num, raw in items:
        if type(q_num) is not int or q_num < 1 or q_num in out:
            raise ResponsePolicyError("Invalid/duplicate authored policy question identity")
        out[q_num] = validate_response_policy(raw)
    return out


def attach_response_policies(answer_key: list[dict], pinned_policies: dict | None) -> list[dict]:
    """Attach only an explicitly supplied immutable admission map; no guessing."""
    if pinned_policies is None:
        return answer_key
    if not isinstance(pinned_policies, dict):
        raise ResponsePolicyError("Pinned policies must be an object")
    key_by_q = {row["q_num"]: row for row in answer_key}
    policies: dict[int, dict] = {}
    for identity, raw in pinned_policies.items():
        if isinstance(identity, str) and re.fullmatch(r"[1-9][0-9]*", identity):
            identity = int(identity)
        if type(identity) is not int or identity not in key_by_q or identity in policies:
            raise ResponsePolicyError("Pinned policy does not identify one frozen question")
        policy = validate_response_policy(raw)
        row = key_by_q[identity]
        primary = row.get("answer")
        candidates = primary if isinstance(primary, list) else [primary]
        if not candidates or any(not isinstance(value, str) or not policy_answer_matches(value, policy) for value in candidates):
            raise ResponsePolicyError("Pinned accepted forms disagree with the frozen answer key")
        if (row.get("question_type") == "mcq_multi" or row.get("group_key")) and policy["kind"] != "option_id":
            raise ResponsePolicyError("Grouped selections require option_id policy")
        policies[identity] = policy
    result = [dict(row, response_policy=policies[row["q_num"]]) if row["q_num"] in policies else row for row in answer_key]
    groups: dict[str, list[dict]] = {}
    for row in result:
        if row.get("group_key"):
            groups.setdefault(row["group_key"], []).append(row)
    for group in groups.values():
        if any(row.get("response_policy") is not None for row in group):
            validate_option_group(group)
    return result


def policy_alternatives(policy: dict, primary: Any) -> list[str]:
    """Review promises only the forms used by the pinned matcher."""
    canonical = primary if isinstance(primary, list) else [primary]
    return [form for form in policy["accepted_answers"] if form not in canonical]


def option_token(raw: str, policy: dict) -> str:
    if policy["kind"] != "option_id":
        raise ResponsePolicyError("Expected option_id marking policy")
    return _text(raw, policy)


def validate_option_group(group: list[dict]) -> None:
    """A reviewed selection alias can identify only one consumable group key."""
    seen: set[str] = set()
    case_sensitive: bool | None = None
    for row in group:
        policy = validate_response_policy(row.get("response_policy"))
        if policy["kind"] != "option_id":
            raise ResponsePolicyError("Grouped selections require option_id policy")
        current_case = policy["settings"].get("case_sensitive", False)
        if case_sensitive is not None and current_case != case_sensitive:
            raise ResponsePolicyError("Grouped policies disagree about option case identity")
        case_sensitive = current_case
        aliases = {option_token(form, policy) for form in policy["accepted_answers"]}
        if seen & aliases:
            raise ResponsePolicyError("Grouped option policies have ambiguous repeated identities")
        seen.update(aliases)
