"""Evaluate the two Black Eye PostgREST OR filters in in-memory DB doubles."""
import re


def matches_blackeye_filter(row, expression):
    if expression == "programme_id.eq.blackeye-v5-upper-listening,metadata->blackeye.not.is.null":
        return row.get("programme_id") == "blackeye-v5-upper-listening" or "blackeye" in (row.get("metadata") or {})
    match = re.fullmatch(r"([a-z_]+)\.is\.null,\1\.not\.in\.\(([^)]+)\)", expression)
    assert match, expression
    return row.get(match[1]) is None or str(row[match[1]]) not in match[2].split(",")
