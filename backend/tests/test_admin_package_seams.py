"""BACKENDSPLIT-0076 T009: routers.admin stays one patchable surface after the split.

Same object and behaviour checks as test_listening_package_seams.py
(TESTPOLICY-0057): every submodule name is re-exported as the same object, a
patch on the package reaches every submodule that binds the name and is undone
there, every global a function loads resolves, Pydantic models are complete,
and the staff guards, ``_actor_id``, ``_require_db_engine`` and the logger stay
defined once in ``routers/admin/__init__.py`` (plan.md T11). Extended by each
split PR through ``routers.admin._SUBMODULES``.
"""
import builtins
import dis
import inspect
import logging
import types
from unittest import mock

import pytest
from pydantic import BaseModel

import database
from routers import admin as ar

MODULES = (ar, *ar._SUBMODULES)


def _shared_names():
    return [(name, sub) for sub in ar._SUBMODULES for name in vars(sub)
            if not name.startswith("__")]


def test_every_submodule_name_is_reexported_as_the_same_object():
    assert ar._SUBMODULES and ar._common in ar._SUBMODULES
    missing = [(sub.__name__, name) for name, sub in _shared_names()
               if name not in vars(ar) or vars(ar)[name] is not vars(sub)[name]]
    assert not missing


def test_package_patch_reaches_each_submodule_and_is_undone():
    for name, sub in _shared_names():
        original = vars(sub)[name]
        sentinel = object()
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(ar, name, sentinel)
            assert vars(sub)[name] is sentinel, (sub.__name__, name)
            assert getattr(ar, name) is sentinel
        assert vars(sub)[name] is original, (sub.__name__, name)
        assert vars(ar)[name] is original


def test_string_target_and_nested_mock_patch_reach_moved_code():
    original = ar._common._serialize_topics_with_metadata
    with mock.patch("routers.admin._serialize_topics_with_metadata") as a:
        assert ar._common._serialize_topics_with_metadata is a
        with mock.patch.object(ar, "_serialize_topics_with_metadata") as b:
            assert ar._common._serialize_topics_with_metadata is b
        assert ar._common._serialize_topics_with_metadata is a
    assert ar._common._serialize_topics_with_metadata is original


def test_patched_database_reaches_a_helper_defined_in_common():
    calls = []

    class _Bucket:
        def create_signed_url(self, path, ttl):
            calls.append((path, ttl))
            return {"signedURL": "https://signed.example/" + path}

    fake = types.SimpleNamespace(storage=types.SimpleNamespace(from_=lambda bucket: _Bucket()))
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(ar, "supabase_admin", fake)
        assert ar._sign_storage_url("b", "p/1.webm") == "https://signed.example/p/1.webm"
    assert calls == [("p/1.webm", 3600)]
    assert ar._common.supabase_admin is database.supabase_admin


def test_patching_a_name_missing_from_the_package_is_refused():
    fake = types.ModuleType("routers.admin._fake_split")
    fake._only_in_submodule = object()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(ar, "_SUBMODULES", (*ar._SUBMODULES, fake))
        with pytest.raises(AttributeError, match="not re-exported"):
            setattr(ar, "_only_in_submodule", object())
        assert "_only_in_submodule" not in vars(ar)
    assert fake._only_in_submodule is not None


def test_raising_false_patch_of_an_unknown_name_touches_no_submodule():
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(ar, "_no_such_admin_name", object(), raising=False)
    assert "_no_such_admin_name" not in vars(ar)
    assert all("_no_such_admin_name" not in vars(sub) for sub in ar._SUBMODULES)


def test_deleting_a_name_a_submodule_binds_is_refused():
    with pytest.raises(TypeError):
        delattr(ar, "_serialize_topics_with_metadata")
    assert ar._serialize_topics_with_metadata is ar._common._serialize_topics_with_metadata


def _code_objects(code):
    yield code
    for const in code.co_consts:
        if isinstance(const, types.CodeType):
            yield from _code_objects(const)


def _own_functions(module):
    seen = set()
    for value in vars(module).values():
        candidates = [value]
        if isinstance(value, type) and value.__module__ == module.__name__:
            candidates = [inspect.unwrap(v.__func__ if isinstance(v, (classmethod, staticmethod)) else v)
                          for v in vars(value).values()]
        for fn in candidates:
            fn = inspect.unwrap(fn) if callable(fn) else fn
            if isinstance(fn, types.FunctionType) and fn.__module__ == module.__name__ and id(fn) not in seen:
                seen.add(id(fn))
                yield fn


@pytest.mark.parametrize("module", MODULES, ids=lambda m: m.__name__)
def test_every_loaded_global_resolves(module):
    # FR-007: a name defined in a later block and used by an earlier one
    # would only fail at run time (NameError); catch it at import.
    unresolved = set()
    for fn in _own_functions(module):
        for code in _code_objects(fn.__code__):
            for ins in dis.get_instructions(code):
                if ins.opname == "LOAD_GLOBAL" and ins.argval not in fn.__globals__ \
                        and not hasattr(builtins, ins.argval):
                    unresolved.add(f"{fn.__qualname__}: {ins.argval}")
    assert not unresolved, sorted(unresolved)


@pytest.mark.parametrize("module", MODULES, ids=lambda m: m.__name__)
def test_pydantic_models_are_complete(module):
    models = [v for v in vars(module).values()
              if isinstance(v, type) and issubclass(v, BaseModel) and v.__module__ == module.__name__]
    for model in models:
        model.model_rebuild()
        assert model.__pydantic_complete__, model.__name__
    if module is ar._common:
        assert models


def test_guards_router_and_logger_stay_defined_in_the_package():
    for name in ("require_admin", "require_instructor", "_actor_id", "_require_db_engine",
                 "_staff_role_row"):
        fn = vars(ar)[name]
        assert fn.__module__ == "routers.admin", name
        for sub in ar._SUBMODULES:
            assert vars(sub).get(name, fn) is fn, (sub.__name__, name)
    assert ar.router.routes
    modules = {ar.__name__, *(sub.__name__ for sub in ar._SUBMODULES)}
    for route in ar.router.routes:
        endpoint = route.endpoint
        assert endpoint.__module__ in modules, route.path
        # A moved endpoint still resolves the one package guard, not a copy.
        assert endpoint.__globals__.get("require_admin", ar.require_admin) is ar.require_admin, route.path
    assert ar.logger.name == "routers.admin"
    assert ar.logger is logging.getLogger("routers.admin")
    for sub in ar._SUBMODULES:
        assert getattr(sub, "logger", ar.logger) is ar.logger, sub.__name__
