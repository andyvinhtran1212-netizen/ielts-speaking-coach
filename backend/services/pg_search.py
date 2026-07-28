"""PostgREST search-filter helper (F2 audit).

Building a PostgREST ``or_()`` filter by interpolating a raw search term is
unsafe: reserved characters in the term -- comma (predicate separator), dot,
parentheses (grouping) -- break the logic tree (PostgREST returns
"failed to parse logic tree", a 500 to the caller). Verified live: a term like
``a,b(c)`` errors on the unquoted form and works once the value is double-quoted.

``ilike_or_filter`` produces a safe ``col.ilike.<value>,col2.ilike.<value>``
string where <value> is a PostgREST double-quoted value, so reserved chars in
the term are literal, and SQL LIKE wildcards (% _ \\) in the term are escaped so
they match literally rather than acting as wildcards.
"""

from __future__ import annotations


def _quoted_ilike_value(term: str) -> str:
    # 1) escape SQL LIKE specials so a user's %, _ or \\ matches literally.
    like = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    # 2) escape for the PostgREST double-quoted-string context (\\ and ").
    quoted = like.replace("\\", "\\\\").replace('"', '\\"')
    # %...% are the substring wildcards; the quotes make reserved chars literal.
    return f'"%{quoted}%"'


def ilike_or_filter(columns: list[str], term: str) -> str:
    """Return a PostgREST or_() string: case-insensitive substring match of
    ``term`` against each column, hardened against reserved chars + wildcards."""
    value = _quoted_ilike_value(term)
    return ",".join(f"{col}.ilike.{value}" for col in columns)


def _quoted_exact_value(term: str) -> str:
    """Same hardening as above but with NO surrounding %, so ilike matches the
    whole value rather than a substring."""
    like = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    quoted = like.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{quoted}"'


def ilike_eq_any_filter(column: str, terms: list[str]) -> str:
    """Return a PostgREST or_() string matching ``column`` case-insensitively but
    EXACTLY against any of ``terms``.

    `in_()` is the obvious tool and the wrong one: PostgreSQL compares TEXT
    case-sensitively, so `in_("headword", ["gridlock"])` finds nothing when the
    column stores "Gridlock" (Codex review, PR #876 — it silently returned zero
    rows and every card fell back to speech synthesis). `ilike` without wildcards
    is a whole-value case-insensitive match; the wildcard escaping above keeps a
    literal `_` or `%` inside a headword from matching anything else.
    """
    return ",".join(f"{column}.ilike.{_quoted_exact_value(t)}" for t in terms if t)
