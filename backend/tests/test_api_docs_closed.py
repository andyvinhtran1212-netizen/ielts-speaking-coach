"""FastAPI docs and the HTTP OpenAPI schema are closed by default.

Staging and production must answer 404 for /openapi.json, /docs,
/docs/oauth2-redirect and /redoc without any env change; ENABLE_API_DOCS=1
opens them for local development only. app.openapi() — what the
"api.d.ts ↔ OpenAPI drift" CI job dumps — must keep producing the full schema.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

import main
from config import Settings
from services.api_docs import api_docs_enabled, api_docs_kwargs

DOC_PATHS = ("/openapi.json", "/docs", "/docs/oauth2-redirect", "/redoc")


def _fresh_app(flag):
    app = FastAPI(title="docs-flag probe", **api_docs_kwargs(flag))

    @app.get("/probe")
    def probe():
        return {"ok": True}

    return app


@pytest.mark.parametrize("path", DOC_PATHS)
def test_live_app_does_not_serve_docs_or_schema(path):
    response = TestClient(main.app).get(path)
    assert response.status_code == 404, (path, response.status_code)


def test_live_app_registers_no_docs_routes():
    assert main.app.openapi_url is None
    assert main.app.docs_url is None
    assert main.app.redoc_url is None
    assert main.app.swagger_ui_oauth2_redirect_url is None
    registered = {getattr(route, "path", None) for route in main.app.routes}
    assert not registered & set(DOC_PATHS)


def test_live_app_openapi_still_builds_full_schema():
    schema = main.app.openapi()
    assert schema["info"]["title"] == "IELTS Speaking Coach"
    assert "/sessions" in schema["paths"]
    assert len(schema["paths"]) > 100
    assert schema["components"]["schemas"]


def test_settings_default_is_closed(monkeypatch):
    monkeypatch.delenv("ENABLE_API_DOCS", raising=False)
    assert Settings.model_fields["ENABLE_API_DOCS"].default == ""
    assert not api_docs_enabled(Settings(_env_file=None).ENABLE_API_DOCS)


def test_settings_reads_opt_in_from_env(monkeypatch):
    monkeypatch.setenv("ENABLE_API_DOCS", "1")
    assert api_docs_enabled(Settings(_env_file=None).ENABLE_API_DOCS)


@pytest.mark.parametrize("flag", ["1", "true", "TRUE", " yes ", "on"])
def test_truthy_flag_opens_docs(flag):
    assert api_docs_enabled(flag)
    assert api_docs_kwargs(flag) == {}


@pytest.mark.parametrize(
    "flag", [None, "", "0", "false", "no", "off", "enabled", "2", "docs"],
)
def test_other_values_keep_docs_closed(flag):
    assert not api_docs_enabled(flag)
    assert api_docs_kwargs(flag) == {
        "openapi_url": None,
        "docs_url": None,
        "redoc_url": None,
        "swagger_ui_oauth2_redirect_url": None,
    }


@pytest.mark.parametrize("path", DOC_PATHS)
def test_closed_app_returns_404(path):
    assert TestClient(_fresh_app("0")).get(path).status_code == 404


@pytest.mark.parametrize("path", DOC_PATHS)
def test_opted_in_app_serves_docs(path):
    assert TestClient(_fresh_app("1")).get(path).status_code == 200


def test_opted_in_schema_matches_in_process_schema():
    app = _fresh_app("1")
    served = TestClient(app).get("/openapi.json").json()
    assert "/probe" in served["paths"]
    assert served == app.openapi()
    assert _fresh_app("0").openapi()["paths"] == served["paths"]
