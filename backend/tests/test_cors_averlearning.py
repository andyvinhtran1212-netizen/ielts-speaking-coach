"""Sprint 20.10 D1 — CORS bulletproofing, now per deployment.

Andy's prod dogfood (2026-05-29) hit "No 'Access-Control-Allow-Origin' header"
from https://www.averlearning.com on `GET /api/reading/test/{test_id}/attempts/
in-progress`. 20.10 D1 answered with an `allow_origin_regex` for
`^https://(?:[a-z0-9-]+\\.)?averlearning\\.com$`.

F11 (2026-10-28) removed that regex: with `allow_credentials=True` it let ANY
*.averlearning.com page — including a dangling or taken-over subdomain — read
the API as the signed-in user. The follow-up split the exact allowlist per
deployment (services/cors_policy.py): production accepts apex + www only,
staging only staging.averlearning.com, localhost only in development or behind
CORS_ALLOW_LOCALHOST outside production.

The allowlist is fixed when `main` is imported, so each deployment is exercised
in a child interpreter that imports the REAL `main.app` under that deployment's
environment variables and sends real CORS preflights / GETs through it.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]

APEX = "https://averlearning.com"
WWW = "https://www.averlearning.com"
STAGING = "https://staging.averlearning.com"
SAGE = "https://ielts-speaking-coach-sage.vercel.app"
LOCAL = ("http://localhost:3000", "http://127.0.0.1:3000",
         "http://localhost:5500", "http://127.0.0.1:5500")
FOREIGN = ("https://bat-ky.averlearning.com", "https://app.averlearning.com",
           "https://evil.com", "https://averlearning.com.evil.com",
           "http://averlearning.com")
PROBES = (APEX, WWW, STAGING, SAGE, *LOCAL, *FOREIGN)

_CHILD = """
import json, sys
sys.path.insert(0, "tests")
import conftest  # same no-live-network guards and dummy Supabase env as the suite
from fastapi.testclient import TestClient
import main

client = TestClient(main.app)
path = "/api/reading/test/T1/attempts/in-progress"
out = {"origins": main.origins, "preflight": {}, "get": {}}
for origin in json.loads(sys.argv[1]):
    r = client.options(path, headers={
        "Origin": origin,
        "Access-Control-Request-Method": "PATCH",
        "Access-Control-Request-Headers": "authorization",
    })
    out["preflight"][origin] = {
        "status": r.status_code,
        "acao": r.headers.get("access-control-allow-origin"),
        "acac": r.headers.get("access-control-allow-credentials"),
    }
    out["get"][origin] = client.get(path, headers={"Origin": origin}).headers.get(
        "access-control-allow-origin")
print("CORS-RESULT " + json.dumps(out))
"""


def _spawn(environment: str, railway: str | None, allow_localhost: str = "") -> subprocess.Popen:
    env = dict(os.environ)
    env.pop("RAILWAY_ENVIRONMENT_NAME", None)
    # Set explicitly (env beats backend/.env) so a developer's .env cannot
    # change which deployment the child believes it is.
    env["ENVIRONMENT"] = environment
    env["CORS_ALLOW_LOCALHOST"] = allow_localhost
    if railway is not None:
        env["RAILWAY_ENVIRONMENT_NAME"] = railway
    return subprocess.Popen(
        [sys.executable, "-c", _CHILD, json.dumps(PROBES)],
        cwd=_BACKEND, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )


def _collect(proc: subprocess.Popen) -> dict:
    out, err = proc.communicate(timeout=180)
    assert proc.returncode == 0, err[-2000:]
    line = next(l for l in out.splitlines() if l.startswith("CORS-RESULT "))
    return json.loads(line[len("CORS-RESULT "):])


def _allowed(result: dict) -> set[str]:
    """Origins the live app granted on BOTH the preflight and the actual GET."""
    granted = set()
    for origin in PROBES:
        pre = result["preflight"][origin]
        got = result["get"][origin]
        if pre["acao"] is None and got is None:
            continue
        assert pre["acao"] == origin and got == origin, (origin, pre, got)
        assert pre["status"] == 200 and pre["acac"] == "true", (origin, pre)
        granted.add(origin)
    return granted


@pytest.fixture(scope="module")
def deployments():
    # Importing main takes seconds; start every deployment at once.
    procs = {
        # Railway production exactly as configured on 2026-10-28: no
        # ENVIRONMENT variable (config default "development"),
        # RAILWAY_ENVIRONMENT_NAME injected by Railway.
        "production": _spawn("development", "production"),
        "production+flag": _spawn("development", "production", allow_localhost="true"),
        "staging": _spawn("staging", "staging"),
        "staging+flag": _spawn("staging", "staging", allow_localhost="1"),
        "development": _spawn("development", None),
    }
    return {name: _collect(proc) for name, proc in procs.items()}


# ── production ────────────────────────────────────────────────────────────────

def test_production_grants_exactly_apex_and_www(deployments):
    production = deployments["production"]
    assert production["origins"] == [APEX, WWW]
    assert _allowed(production) == {APEX, WWW}


def test_production_rejects_staging_sage_localhost_and_foreign(deployments):
    granted = _allowed(deployments["production"])
    for origin in (STAGING, SAGE, *LOCAL, *FOREIGN):
        assert origin not in granted, origin


def test_production_ignores_the_localhost_flag(deployments):
    """Credentials + plain-http localhost must never meet on production."""
    assert _allowed(deployments["production+flag"]) == {APEX, WWW}


# ── staging ───────────────────────────────────────────────────────────────────

def test_staging_grants_only_its_own_origin(deployments):
    assert deployments["staging"]["origins"] == [STAGING]
    assert _allowed(deployments["staging"]) == {STAGING}


def test_staging_localhost_needs_the_explicit_flag(deployments):
    assert _allowed(deployments["staging+flag"]) == {STAGING, *LOCAL}


# ── development ───────────────────────────────────────────────────────────────

def test_development_grants_only_localhost(deployments):
    assert _allowed(deployments["development"]) == set(LOCAL)
