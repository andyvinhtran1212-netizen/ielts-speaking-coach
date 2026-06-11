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
