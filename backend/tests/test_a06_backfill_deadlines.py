"""Safety checks only: never apply a repair or contact any database."""
from unittest.mock import MagicMock

import pytest

from scripts.a06_backfill_deadlines import aware, main, parser, run, staging_url, STAGING_URL

ID = '00000000-0000-0000-0000-000000000001'
OLD = '2026-10-27T23:00:00Z'


@pytest.mark.parametrize('url', [
    'https://huwsmtubwulikhlmcirx.supabase.co', 'https://example.supabase.co',
    'http://zjphffoujxkpltixsbzj.supabase.co', STAGING_URL + '.evil.test',
    STAGING_URL + '/rest/v1', STAGING_URL + '?redirect=evil',
    'https://user@zjphffoujxkpltixsbzj.supabase.co',
])
def test_refuses_every_noncanonical_staging_url(url):
    with pytest.raises(ValueError):
        staging_url(url)


def test_exact_staging_url_allowed():
    assert staging_url(STAGING_URL + '/') == STAGING_URL


def args(*extra):
    return parser().parse_args(['--ids', ID, '--expected-old', OLD, *extra])


def db_with(old=OLD):
    db = MagicMock()
    q = db.table.return_value
    for method in ('select', 'in_', 'eq', 'order', 'range'):
        getattr(q, method).return_value = q
    q.execute.return_value.data = [{'id': ID, 'assignment_group_id': None,
                                   'prompt_id': ID, 'deadline': old}]
    return db


def test_default_is_dry_run_and_prints_proposal_without_updates(capsys):
    options = args()
    assert options.apply is False
    db = db_with()
    assert run(db, options) == 1
    output = capsys.readouterr().out
    assert 'DRY RUN (no writes)' in output
    assert ID in output and OLD in output and '2026-10-27T16:00:00+00:00' in output
    db.table.return_value.update.assert_not_called()


def test_already_shifted_or_changed_original_refuses_double_shift():
    db = db_with('2026-10-27T16:00:00Z')
    with pytest.raises(ValueError, match='OLD VALUE MISMATCH'):
        run(db, args())
    db.table.return_value.update.assert_not_called()


def test_guard_runs_before_any_database_read():
    db = db_with()
    with pytest.raises(ValueError, match='non-staging'):
        run(db, args('--url', 'https://huwsmtubwulikhlmcirx.supabase.co'))
    db.table.assert_not_called()


def test_cli_guard_never_constructs_client_or_prints_key(monkeypatch, capsys):
    client = MagicMock()
    monkeypatch.setattr('supabase.create_client', client)
    monkeypatch.setenv('STAGING_SUPABASE_SERVICE_KEY', 'secret-test-value')
    assert main(['--ids', ID, '--expected-old', OLD, '--url',
                 'https://huwsmtubwulikhlmcirx.supabase.co']) == 1
    client.assert_not_called()
    output = capsys.readouterr().out
    assert 'REFUSED' in output and 'secret-test-value' not in output


def test_explicit_selector_and_original_required():
    with pytest.raises(SystemExit):
        parser().parse_args(['--expected-old', OLD])
    with pytest.raises(SystemExit):
        parser().parse_args(['--ids', ID])
    with pytest.raises(ValueError):
        aware('2026-10-27T23:00')


def test_missing_selector_does_not_silently_partially_repair():
    db = db_with()
    options = args()
    options.ids.append('00000000-0000-0000-0000-000000000002')
    with pytest.raises(ValueError, match='matched no rows'):
        run(db, options)
    db.table.return_value.update.assert_not_called()
