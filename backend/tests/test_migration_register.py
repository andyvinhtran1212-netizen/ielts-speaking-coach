"""Migration number register (G01-T06).

Compares the ``*.sql`` file names in ``backend/migrations`` with the rows of
``backend/migrations/register.tsv``. It reads file names only, never SQL.
"""

from __future__ import annotations

import re
import warnings
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
MIGRATIONS = BACKEND / "migrations"
REGISTER = MIGRATIONS / "register.tsv"

HEADER = ["number", "filename", "state", "owner", "spec", "note"]
STATES = {"present", "reserved", "abandoned"}
NUMBER_RE = re.compile(r"^\d{3}[a-z]?$")
ROLLBACK_NUMBER_RE = re.compile(r"^\d{3}r$")
FILE_NUMBER_RE = re.compile(r"^(\d{3}[a-z]?)_")
UNKNOWN_OWNER = "unknown-ask-owner"


def _rows() -> list[dict[str, str]]:
    lines = [
        line
        for line in REGISTER.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#")
    ]
    assert lines[0].split("\t") == HEADER
    rows = []
    for line in lines[1:]:
        cells = line.split("\t")
        assert len(cells) == len(HEADER), f"wrong column count: {line!r}"
        rows.append(dict(zip(HEADER, cells)))
    return rows


def _is_rollback(filename: str) -> bool:
    return "_rollback" in filename


def _file_number(filename: str) -> str:
    match = FILE_NUMBER_RE.match(filename)
    assert match, f"{filename} does not start with a three-digit number"
    return match.group(1)


def _next_number(rows: list[dict[str, str]]) -> int:
    held = [
        int(row["number"][:3])
        for row in rows
        if row["state"] in {"present", "reserved"}
        and not ROLLBACK_NUMBER_RE.match(row["number"])
    ]
    return max(held) + 1


def test_register_rows_are_well_formed():
    numbers = set()
    for row in _rows():
        number = row["number"]
        assert NUMBER_RE.match(number) or ROLLBACK_NUMBER_RE.match(number), number
        assert number not in numbers, f"number {number} has two register rows"
        numbers.add(number)
        assert row["state"] in STATES, f"{number}: unknown state {row['state']!r}"
        if row["state"] == "present":
            assert row["filename"] != "-", f"{number} is present without a file name"
        else:
            assert row["filename"] == "-", f"{number} is {row['state']} but names a file"


def test_every_sql_file_has_a_present_register_row():
    by_filename = {row["filename"]: row for row in _rows() if row["filename"] != "-"}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        row = by_filename.get(path.name)
        assert row is not None, f"{path.name} has no register row"
        assert row["state"] == "present", f"{path.name} is listed as {row['state']}"
        if _is_rollback(path.name):
            assert ROLLBACK_NUMBER_RE.match(row["number"]), path.name
        else:
            assert row["number"] == _file_number(path.name), path.name


def test_every_present_row_has_its_file():
    for row in _rows():
        if row["state"] == "present":
            assert (MIGRATIONS / row["filename"]).is_file(), (
                f"{row['number']}: {row['filename']} is listed as present but missing"
            )


def test_no_two_forward_files_share_a_number():
    seen: dict[str, str] = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if _is_rollback(path.name):
            continue
        number = _file_number(path.name)
        assert number not in seen, f"{path.name} and {seen[number]} share number {number}"
        seen[number] = path.name


def test_reserved_numbers_name_an_owner():
    unknown = []
    for row in _rows():
        if row["state"] != "reserved":
            continue
        assert row["owner"] not in {"", "-"}, f"reserved {row['number']} has no owner"
        if row["owner"] == UNKNOWN_OWNER:
            unknown.append(row["number"])
    if unknown:
        warnings.warn(
            "reserved numbers with an unconfirmed owner: " + ", ".join(unknown),
            stacklevel=1,
        )


def test_reports_the_next_number():
    rows = _rows()
    next_number = _next_number(rows)
    taken = {row["number"][:3] for row in rows}
    assert f"{next_number:03d}" not in taken
    print(f"next migration number: {next_number:03d}")
