"""Service-role namespace views for in-memory PostgREST fixtures.

Legacy fixtures omit the new column and model its database DEFAULT false. New
namespace cases explicitly seed the persisted flag. This double does not infer
restriction from provenance; the PostgreSQL matrix verifies trigger stamping.
"""
VIEW_TABLES = {
    "v_listening_tests_public": "listening_tests",
    "v_listening_content_public": "listening_content",
    "v_listening_attempts_public": "listening_test_attempts",
    "v_dictation_sessions_public": "dictation_sessions",
}


def source_table(name):
    return VIEW_TABLES.get(name, name)


def source_rows(tables, name):
    rows = tables.get(source_table(name), [])
    if name in VIEW_TABLES:
        return [row for row in rows if row.get("restricted", False) is False]
    return rows
