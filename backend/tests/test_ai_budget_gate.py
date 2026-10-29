"""AIBUDGET-0033 FR-001 — CI inventory gate for paid provider requests.

A static (AST) scan of every backend module outside ``tests/``:

- every provider request — an Anthropic ``messages.create``, a Gemini
  ``generate_content``/``generate_content_async``, an OpenAI
  ``audio.transcriptions.create``/``audio.speech.create``, or an HTTP POST in a
  module that names a provider endpoint (ElevenLabs, Azure Speech) — sits
  lexically inside a ``with``/``async with`` block whose context manager is
  ``ai_budget.guard``/``ai_budget.guard_sync`` (or a helper listed in
  ``GUARD_HELPERS`` that returns one);
- every provider SDK client is built with ``max_retries=0``, and every Gemini
  request passes ``request_options`` with ``retry=None`` (the gapic default
  retries 503s for up to 600 s), so each billable request is one reserved
  attempt;
- the set of modules that send provider requests equals ``INVENTORY``, the
  allow-list taken from ``specs/0033-ai-budget-hard-cap/research.md`` §1. A new
  module that calls a provider fails here until it is guarded and listed.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
SKIP_DIRS = {"tests", "venv", ".venv", "__pycache__", "node_modules"}

# research.md §1 (staging 33b171454) plus the wrapper module itself. Each
# entry is a module that sends paid provider requests directly; modules that
# only call these (routers, orchestrator, off_topic_judge, listening_audit,
# writing_prompt_analysis, course_pronunciation, speaking_question_audio,
# listening_audio, the calibration scripts) are covered through them.
INVENTORY: frozenset[str] = frozenset({
    "services/ai_budget.py",                    # generate_content_sync (operator scripts)
    "services/ai_router.py",
    "services/grading_providers/claude.py",
    "services/grading_providers/gemini.py",
    "services/claude_grader.py",
    "services/whisper.py",
    "services/azure_pronunciation.py",
    "services/tts_audio.py",
    "services/listening_renderer.py",
    "services/listening_gist_grader.py",
    "services/gemini.py",
    "services/gemini_writing_grader.py",
    "services/course_writing_grader.py",
    "services/advanced_vocab_rewrite_grader.py",
    "services/d1_question_generator.py",
    "services/d1_content_gen.py",
    "services/vocab_enrichment.py",
    "services/vocab_extractor.py",               # no live caller (research §1); guarded
    "scripts/backfill_d1_questions_mcq.py",
})

# Modules that build the guard in a local helper: (module, helper name).
GUARD_HELPERS: frozenset[tuple[str, str]] = frozenset({("services/whisper.py", "_stt_guard")})

PROVIDER_HOSTS = (
    "api.elevenlabs.io", "stt.speech.microsoft.com", "api.openai.com",
    "api.anthropic.com", "generativelanguage.googleapis.com",
)
SDK_CLIENTS = {"Anthropic", "AsyncAnthropic", "OpenAI", "AsyncOpenAI"}
GEMINI_SENDS = {"generate_content", "generate_content_async"}


def _modules() -> list[Path]:
    out = []
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND)
        if rel.parts and rel.parts[0] in SKIP_DIRS or any(p in SKIP_DIRS for p in rel.parts):
            continue
        out.append(path)
    return out


def _parents(tree: ast.AST) -> dict[ast.AST, ast.AST]:
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    return parents


def _dotted(node: ast.AST) -> str:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def _send_sites(tree: ast.AST, source: str) -> list[ast.AST]:
    """Provider request expressions: SDK send attributes, and POSTs in a
    module that names a provider endpoint."""
    names_endpoint = any(host in source for host in PROVIDER_HOSTS)
    sites = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load):
            dotted = _dotted(node)
            if node.attr in GEMINI_SENDS:
                sites.append(node)
            elif dotted.endswith(("messages.create", "transcriptions.create", "speech.create")):
                sites.append(node)
            elif names_endpoint and node.attr == "post" and dotted in (
                    "requests.post", "client.post", "httpx.post"):
                sites.append(node)
    return sites


def _is_guard_item(item: ast.withitem, rel: str) -> bool:
    call = item.context_expr
    if not isinstance(call, ast.Call):
        return False
    name = _dotted(call.func)
    if name in ("ai_budget.guard", "ai_budget.guard_sync"):
        return True
    if rel == "services/ai_budget.py" and name in ("guard", "guard_sync"):
        return True
    return (rel, name) in GUARD_HELPERS


def _guarded(node: ast.AST, parents: dict, rel: str) -> bool:
    current = node
    while current in parents:
        current = parents[current]
        if isinstance(current, (ast.With, ast.AsyncWith)) and any(
                _is_guard_item(item, rel) for item in current.items):
            return True
        if isinstance(current, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            # The guard must be in the same function as the send: a nested
            # function defined inside a guard block may run outside it.
            return False
    return False


def _scan():
    found: dict[str, dict] = {}
    for path in _modules():
        rel = path.relative_to(BACKEND).as_posix()
        source = path.read_text(encoding="utf-8")
        if not any(k in source for k in ("anthropic", "openai", "generativeai", "generate_content",
                                         *PROVIDER_HOSTS)):
            continue
        tree = ast.parse(source, filename=rel)
        parents = _parents(tree)
        sites = _send_sites(tree, source)
        clients = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
                   and _dotted(n.func).split(".")[-1] in SDK_CLIENTS]
        if sites or clients:
            found[rel] = {"tree": tree, "parents": parents, "sites": sites, "clients": clients}
    return found


SCAN = _scan()


def test_the_scan_finds_the_known_provider_modules():
    # Guards the gate itself: if the patterns stop matching, it would pass
    # vacuously.
    assert {"services/ai_router.py", "services/whisper.py", "services/tts_audio.py",
            "services/azure_pronunciation.py", "services/listening_renderer.py",
            "services/grading_providers/gemini.py"} <= set(SCAN)
    assert sum(len(v["sites"]) for v in SCAN.values()) >= 25


def test_every_module_that_sends_provider_requests_is_in_the_inventory():
    senders = {rel for rel, v in SCAN.items() if v["sites"]}
    unlisted = senders - INVENTORY
    assert not unlisted, (
        f"provider requests outside the AIBUDGET-0033 inventory: {sorted(unlisted)}. "
        "Wrap each request in ai_budget.guard/guard_sync and add the module to INVENTORY "
        "(and research.md §1)."
    )
    stale = INVENTORY - senders
    assert not stale, f"inventory lists modules with no provider request: {sorted(stale)}"


@pytest.mark.parametrize("rel", sorted(INVENTORY))
def test_every_provider_request_is_inside_a_budget_guard(rel):
    entry = SCAN[rel]
    unguarded = [f"{rel}:{site.lineno} {_dotted(site)}" for site in entry["sites"]
                 if not _guarded(site, entry["parents"], rel)]
    assert not unguarded, f"unguarded provider requests (FR-001): {unguarded}"


def _all_clients():
    return [(rel, call) for rel, v in sorted(SCAN.items()) for call in v["clients"]]


@pytest.mark.parametrize("rel,call", _all_clients(),
                         ids=[f"{rel}:{call.lineno}" for rel, call in _all_clients()])
def test_every_sdk_client_disables_hidden_retries(rel, call):
    retries = [kw for kw in call.keywords if kw.arg == "max_retries"]
    assert retries and isinstance(retries[0].value, ast.Constant) and retries[0].value.value == 0, (
        f"{rel}:{call.lineno} builds {_dotted(call.func)} without max_retries=0 (FR-001)")


def _gemini_sites():
    out = []
    for rel, v in sorted(SCAN.items()):
        for site in v["sites"]:
            if isinstance(site, ast.Attribute) and site.attr in GEMINI_SENDS:
                out.append((rel, site, v["parents"]))
    return out


def _no_retry_options(call: ast.Call) -> bool:
    for kw in call.keywords:
        if kw.arg != "request_options":
            continue
        value = kw.value
        if isinstance(value, ast.Call) and _dotted(value.func).endswith("gemini_request_options"):
            return True
        if isinstance(value, ast.Dict):
            return any(isinstance(k, ast.Constant) and k.value == "retry"
                       and isinstance(v, ast.Constant) and v.value is None
                       for k, v in zip(value.keys, value.values))
    return False


@pytest.mark.parametrize("rel,site,parents", _gemini_sites(),
                         ids=[f"{rel}:{site.lineno}" for rel, site, _ in _gemini_sites()])
def test_every_gemini_request_disables_the_gapic_retry(rel, site, parents):
    call = parents[site]
    # model.generate_content(...) or asyncio.to_thread(model.generate_content, ...)
    assert isinstance(call, ast.Call), f"{rel}:{site.lineno}"
    assert _no_retry_options(call), (
        f"{rel}:{site.lineno} sends a Gemini request without request_options retry=None (FR-001)")


def test_guard_helpers_return_a_budget_guard():
    for rel, name in GUARD_HELPERS:
        tree = SCAN[rel]["tree"]
        fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name)
        returns = [n for n in ast.walk(fn) if isinstance(n, ast.Return)]
        assert returns and all(isinstance(r.value, ast.Call)
                               and _dotted(r.value.func) == "ai_budget.guard" for r in returns), rel


def test_the_gate_flags_an_unguarded_request(tmp_path):
    # The scan logic on a synthetic module: an unguarded send and a client
    # with default retries are both caught; a guarded one is not.
    source = (
        "import anthropic\nfrom services import ai_budget\n"
        "async def bad(c):\n    return await c.messages.create(model='m')\n"
        "async def good(c):\n"
        "    async with ai_budget.guard('anthropic', 'm', 'f', 1.0, request_key='k'):\n"
        "        return await c.messages.create(model='m')\n"
        "client = anthropic.Anthropic(api_key='x')\n"
    )
    tree = ast.parse(source)
    parents = _parents(tree)
    sites = _send_sites(tree, source)
    assert [(_guarded(s, parents, "x.py"), s.lineno) for s in sites] == [(False, 4), (True, 7)]
    client = next(n for n in ast.walk(tree) if isinstance(n, ast.Call) and _dotted(n.func) == "anthropic.Anthropic")
    assert not any(kw.arg == "max_retries" for kw in client.keywords)
