"""BACKENDSPLIT-0076: routers.listening stays one patchable surface after the split.

Object and behaviour checks only (TESTPOLICY-0057): the package re-exports every
submodule name as the same object, a patch on the package reaches every
submodule that binds the name and is undone there, every global a function
loads resolves, Pydantic models are complete, the Black Eye admin guard and the
logger are the single shared objects. Extended by each split PR through
``routers.listening._SUBMODULES``.
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
from routers import listening as lr

MODULES = (lr, *lr._SUBMODULES)


def _shared_names():
    return [(name, sub) for sub in lr._SUBMODULES for name in vars(sub)
            if not name.startswith("__") and name != "annotations"]


def test_every_submodule_name_is_reexported_as_the_same_object():
    assert lr._SUBMODULES and lr._common in lr._SUBMODULES
    missing = [(sub.__name__, name) for name, sub in _shared_names()
               if name not in vars(lr) or vars(lr)[name] is not vars(sub)[name]]
    assert not missing


def test_package_patch_reaches_each_submodule_and_is_undone():
    for name, sub in _shared_names():
        original = vars(sub)[name]
        sentinel = object()
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(lr, name, sentinel)
            assert vars(sub)[name] is sentinel, (sub.__name__, name)
            assert getattr(lr, name) is sentinel
        assert vars(sub)[name] is original, (sub.__name__, name)
        assert vars(lr)[name] is original


def test_string_target_and_nested_mock_patch_reach_moved_code():
    original = lr._common._published_standalone_orders
    with mock.patch("routers.listening._published_standalone_orders") as a:
        assert lr._common._published_standalone_orders is a
        with mock.patch.object(lr, "_published_standalone_orders") as b:
            assert lr._common._published_standalone_orders is b
        assert lr._common._published_standalone_orders is a
    assert lr._common._published_standalone_orders is original


class _FakeQuery:
    def __init__(self, calls, table):
        self.calls, self.table = calls, table

    def __getattr__(self, method):
        def step(*args, **kwargs):
            self.calls.append((self.table, method, args))
            return self
        return step

    def execute(self):
        self.calls.append((self.table, "execute", ()))
        return types.SimpleNamespace(data=[{"id": "x", "order_num": 2}, {"id": "y", "order_num": 1}])


def test_patched_database_reaches_a_helper_defined_in_common():
    calls = []
    fake = types.SimpleNamespace(table=lambda name: _FakeQuery(calls, name))
    exercise_type = sorted(lr._SINGLE_PUBLISHED_EXERCISE_TYPES)[0]
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(lr, "supabase_admin", fake)
        assert lr._published_standalone_orders("c1", exercise_type) == [1, 2]
    assert ("listening_exercises", "execute", ()) in calls
    assert lr._common.supabase_admin is database.supabase_admin


def test_patching_a_name_missing_from_the_package_is_refused():
    fake = types.ModuleType("routers.listening._fake_split")
    fake._only_in_submodule = object()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(lr, "_SUBMODULES", (*lr._SUBMODULES, fake))
        with pytest.raises(AttributeError, match="not re-exported"):
            setattr(lr, "_only_in_submodule", object())
        assert "_only_in_submodule" not in vars(lr)
    assert fake._only_in_submodule is not None


def test_raising_false_patch_of_an_unknown_name_touches_no_submodule():
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(lr, "_no_such_listening_name", object(), raising=False)
    assert "_no_such_listening_name" not in vars(lr)
    assert all("_no_such_listening_name" not in vars(sub) for sub in lr._SUBMODULES)


def test_deleting_a_name_a_submodule_binds_is_refused():
    with pytest.raises(TypeError):
        delattr(lr, "_published_standalone_orders")
    assert lr._published_standalone_orders is lr._common._published_standalone_orders


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
    if module is lr._common:
        assert models


def test_router_guard_and_logger_are_single_shared_objects():
    assert lr.user_router is lr._common.user_router
    assert lr.admin_router is lr._common.admin_router
    assert lr.require_admin is lr._common.require_admin
    assert lr._admin_targets is lr._common._admin_targets
    routes = list(lr.admin_router.routes)
    assert routes
    for route in routes:
        assert isinstance(route, lr._ListeningAdminRoute), route.path
        assert inspect.unwrap(route.endpoint).__globals__["require_admin"] is lr.require_admin, route.path
    for route in lr.user_router.routes:
        assert isinstance(route, lr._ListeningRoute), route.path
    assert lr.logger is lr._common.logger
    assert lr.logger.name == "routers.listening"
    assert lr.logger is logging.getLogger("routers.listening")
    for sub in lr._SUBMODULES:
        assert getattr(sub, "logger", lr.logger) is lr.logger, sub.__name__
