"""Regression contract for the long-lived Supabase service-role transport."""

import asyncio
from unittest.mock import Mock

import database


def test_sync_supabase_transport_disables_http2(monkeypatch):
    """A busy live room must not hit Supabase's per-H2-connection stream cap."""
    built = Mock(name="httpx-client")
    factory = Mock(return_value=built)
    monkeypatch.setattr(database.httpx, "Client", factory)

    assert database._build_supabase_http_client() is built
    kwargs = factory.call_args.kwargs
    assert kwargs["http1"] is True
    assert kwargs["http2"] is False
    assert kwargs["follow_redirects"] is True


def test_service_role_client_uses_the_explicit_transport():
    assert database.supabase_admin.postgrest.session is database._supabase_postgrest_http_client
    assert database.supabase_admin.options.httpx_client is None, (
        "the override must not replace Auth/Storage/Functions transports")


def test_close_releases_the_shared_transport(monkeypatch):
    close = Mock()
    monkeypatch.setattr(
        database,
        "_supabase_postgrest_http_client",
        Mock(close=close, is_closed=False),
    )
    database.close_supabase_http_client()
    close.assert_called_once_with()


def test_application_shutdown_closes_both_http_pools(monkeypatch):
    import main
    from routers import auth

    auth_close = Mock()

    async def close_auth():
        auth_close()

    db_close = Mock()
    monkeypatch.setattr(auth, "close_auth_http_client", close_auth)
    monkeypatch.setattr(database, "close_supabase_http_client", db_close)

    asyncio.run(main.shutdown_event())

    auth_close.assert_called_once_with()
    db_close.assert_called_once_with()


def test_shutdown_then_startup_rebuilds_a_usable_postgrest_pool(monkeypatch):
    import main
    from services import loop_monitor, provider_fixtures

    monkeypatch.setattr(provider_fixtures, "assert_fixture_mode_safe", Mock())
    monkeypatch.setattr(loop_monitor, "start", Mock())
    monkeypatch.setattr(main.settings, "USE_ASYNC_DB", False)
    monkeypatch.setattr(main.settings, "WRITING_REAPER_ENABLED", False)
    monkeypatch.setattr(main.settings, "RETAKE_REAPER_ENABLED", False)

    old = database._supabase_postgrest_http_client
    assert old is not None and not old.is_closed
    database.close_supabase_http_client()
    assert old.is_closed

    asyncio.run(main.startup_event())

    rebuilt = database._supabase_postgrest_http_client
    assert rebuilt is not None and rebuilt is not old and not rebuilt.is_closed
    # Building a real table request exercises Client.table -> rebound
    # PostgREST session without sending anything over the network.
    assert database.supabase_admin.table("error_logs") is not None
