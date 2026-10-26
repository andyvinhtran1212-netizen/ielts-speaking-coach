"""
services/access_code_gen.py — CSPRNG access-code generation (F07).

Access codes are bearer credentials: whoever types one into /auth/activate gets
its entitlement. They were previously minted with `random.choices` (Mersenne
Twister, predictable from observed output) over 36 chars × 8 = ~41 bits. This
module uses `secrets.choice` and a longer format:

    XXXX-XXXX-XXXX   12 symbols from a 31-char alphabet ≈ 59.4 bits

The alphabet drops visually ambiguous characters (0/O, 1/I/L) so codes read
aloud or copied by hand are not mistyped. Activation is an exact match after
`strip().upper()`, so legacy 8-char codes keep working unchanged.

Collision handling (shared by every admin insert site):
  1. dedupe within the batch,
  2. pre-check the batch against existing `access_codes.code`,
  3. on a Postgres unique violation (23505) for `code`, regenerate and retry.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any, Callable

logger = logging.getLogger(__name__)

# 2-9 + A-Z minus I, L, O  → 8 + 23 = 31 symbols.
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
GROUPS = 3
GROUP_LEN = 4

# Insert attempts = 1 initial + this many retries after a code collision.
MAX_INSERT_RETRIES = 3
# Keep PostgREST `code=in.(...)` URLs short.
_PRECHECK_CHUNK = 50


def generate_access_code() -> str:
    """One CSPRNG code in the format XXXX-XXXX-XXXX."""
    return "-".join(
        "".join(secrets.choice(ALPHABET) for _ in range(GROUP_LEN))
        for _ in range(GROUPS)
    )


def generate_unique_codes(count: int, exclude: set[str] | frozenset[str] = frozenset()) -> list[str]:
    """`count` distinct codes, none of which appear in `exclude`."""
    out: list[str] = []
    seen = set(exclude)
    while len(out) < count:
        code = generate_access_code()
        if code not in seen:
            seen.add(code)
            out.append(code)
    return out


def is_unique_violation(exc: Exception) -> bool:
    """True when a supabase-py/postgrest exception is a Postgres 23505."""
    code = getattr(exc, "code", None) or getattr(exc, "pgcode", None)
    if code == "23505":
        return True
    msg = str(exc)
    return "23505" in msg or "duplicate key" in msg.lower()


def _is_code_collision(exc: Exception) -> bool:
    """A 23505 caused by the `code` column. When Postgres names the key
    (`Key (col)=(...)`) and it is some other column, regenerating codes cannot
    help, so it is not treated as a collision."""
    if not is_unique_violation(exc):
        return False
    detail = " ".join(
        str(part) for part in (getattr(exc, "details", None), getattr(exc, "message", None), exc) if part
    )
    if "Key (" in detail and "Key (code)" not in detail:
        return False
    return True


def existing_codes(table: Callable[[], Any], codes: list[str]) -> set[str]:
    """Subset of `codes` already present in access_codes. Best effort: a failed
    pre-check is logged and treated as "none found" — the insert's unique-
    violation retry remains the authoritative guard."""
    found: set[str] = set()
    wanted = set(codes)
    try:
        for i in range(0, len(codes), _PRECHECK_CHUNK):
            chunk = codes[i:i + _PRECHECK_CHUNK]
            res = table().select("code").in_("code", chunk).execute()
            for row in (getattr(res, "data", None) or []):
                value = row.get("code") if isinstance(row, dict) else None
                if value in wanted:
                    found.add(value)
    except Exception as exc:
        logger.warning("access_codes pre-check failed (continuing with insert retry): %s", exc)
    return found


def insert_one_with_unique_code(table: Callable[[], Any], row: dict) -> tuple[Any, str]:
    """Single-row variant of insert_with_unique_codes; inserts `row` as an
    object (not a one-element list), matching the original call shape."""
    result, codes = _insert(table, [row], single=True)
    return result, codes[0]


def insert_with_unique_codes(table: Callable[[], Any], rows: list[dict]) -> tuple[Any, list[str]]:
    """Assign a fresh unique code to each row and insert them in one statement.

    `table` returns a new `access_codes` query builder per call. Returns
    `(execute_result, codes)`. A bulk insert is a single statement, so a 23505
    rolls back the whole batch and every code is regenerated before retrying.
    Re-raises the last error after MAX_INSERT_RETRIES retries, or immediately for
    any non-collision error.
    """
    return _insert(table, rows, single=False)


def _insert(table: Callable[[], Any], rows: list[dict], *, single: bool) -> tuple[Any, list[str]]:
    rejected: set[str] = set()
    attempt = 0
    while True:
        codes = generate_unique_codes(len(rows), exclude=rejected)
        for _ in range(MAX_INSERT_RETRIES):
            taken = existing_codes(table, codes)
            if not taken:
                break
            rejected |= taken
            replacements = iter(generate_unique_codes(len(taken), exclude=rejected | set(codes)))
            codes = [next(replacements) if c in taken else c for c in codes]
        payload = [{**row, "code": code} for row, code in zip(rows, codes)]
        try:
            result = table().insert(payload[0] if single else payload).execute()
            return result, codes
        except Exception as exc:
            if not _is_code_collision(exc) or attempt >= MAX_INSERT_RETRIES:
                raise
            attempt += 1
            rejected |= set(codes)
            logger.warning(
                "access_codes insert hit a unique violation; regenerating %d code(s) (retry %d/%d)",
                len(codes), attempt, MAX_INSERT_RETRIES,
            )
