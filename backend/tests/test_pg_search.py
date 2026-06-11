"""F2 — PostgREST or_() search-filter hardening (services/pg_search.py).

Reserved chars (comma / parens / dot) in a search term must NOT break the
PostgREST logic tree, and they must stay matchable (not stripped). Verified
live against PostgREST: the unquoted form errors on `a,b(c)`; the double-quoted
form executes and matches.
"""
from __future__ import annotations

from services.pg_search import ilike_or_filter


def test_normal_term_builds_quoted_or_filter():
    f = ilike_or_filter(["student_code", "full_name"], "nguyen")
    assert f == 'student_code.ilike."%nguyen%",full_name.ilike."%nguyen%"'


def test_comma_and_parens_are_inside_the_quotes_not_breaking_predicates():
    # The hazard term: the comma/parens must sit INSIDE the double-quoted value,
    # so the only top-level comma is the predicate separator between the 2 cols.
    f = ilike_or_filter(["headword", "definition_vi"], "a,b(c)")
    assert f == 'headword.ilike."%a,b(c)%",definition_vi.ilike."%a,b(c)%"'
    # exactly one unquoted (predicate-separating) comma: split on the value end.
    assert f.count('",') == 1  # the boundary between the two predicates


def test_like_wildcards_are_escaped_to_match_literally():
    # %, _ and backslash in the term must be LIKE-escaped, then escaped again for
    # the quoted context: % -> \% -> (quoted) \\% ; same for _.
    f = ilike_or_filter(["c"], "50%_x")
    assert f == r'c.ilike."%50\\%\\_x%"'


def test_double_quote_in_term_is_escaped_for_the_quoted_context():
    f = ilike_or_filter(["c"], 'a"b')
    assert f == r'c.ilike."%a\"b%"'


def test_multiple_columns():
    f = ilike_or_filter(["a", "b", "c"], "x")
    assert f == 'a.ilike."%x%",b.ilike."%x%",c.ilike."%x%"'
