"""S0 offline characterization, NOT FastAPI/DB integration or MV closure.

Execute selected, unmodified function bodies parsed from this checkout. Module
imports, decorators and annotation evaluation are deliberately not executed;
all auth/storage collaborators are synthetic. Unexpected I/O fails immediately.
Run: python3 -B -m unittest discover -s evidence/blackeye-u1-s0 -p 'test_*.py' -v
"""
import ast
import asyncio
import copy
import json
from pathlib import Path
import socket
import types
import unittest
from unittest.mock import patch
from typing import Any, Callable

ROOT = Path(__file__).resolve().parents[2]
ROUTER = ROOT / 'backend/routers/listening.py'
SOURCE_PROGRAMME = 'ielts-80-days-listening'
BLACK_EYE = 'blackeye-v5-upper-listening'


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)


def selected_function(path, name, **collaborators) -> Callable[..., Any]:
    tree = ast.parse(path.read_text(encoding='utf-8'))
    original = next(n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name)
    node = copy.deepcopy(original)
    node.decorator_list = []
    # Retain the complete body and defaults; only defer annotations.
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    ast.fix_missing_locations(module)
    namespace: dict[str, Any] = dict(HTTPException=HttpError, Header=lambda **kw: None, asyncio=asyncio,
                     SOURCE_PROGRAMME=SOURCE_PROGRAMME)
    namespace.update(collaborators)
    exec(compile(module, str(path), 'exec'), namespace)
    return namespace[name]


class Query:
    def __init__(self, rows): self.rows = rows
    def select(self, *args): return self
    def eq(self, *args): return self
    def limit(self, *args): return self
    def execute(self): return types.SimpleNamespace(data=self.rows)


class S0Characterization(unittest.TestCase):
    def setUp(self):
        self.network = patch.object(socket.socket, 'connect', side_effect=AssertionError('S0 forbids network'))
        self.network.start()
        self.addCleanup(self.network.stop)

    def assert_status(self, code, callback):
        with self.assertRaises(HttpError) as caught: callback()
        self.assertEqual(caught.exception.status_code, code)

    def test_mv1_source_required_is_80_days_only_not_blackeye(self):
        for programme, expected in [(SOURCE_PROGRAMME, True), (BLACK_EYE, False), (None, False)]:
            db = types.SimpleNamespace(table=lambda _: Query([{'programme_id': programme}]))
            fn = selected_function(ROUTER, '_source_required_for_test', supabase_admin=db)
            self.assertEqual(fn('synthetic-test'), expected)

    def test_mv1_missing_test_identity_fails_503(self):
        db = types.SimpleNamespace(table=lambda _: Query([]))
        fn = selected_function(ROUTER, '_source_required_for_test', supabase_admin=db)
        self.assert_status(503, lambda: fn('missing'))

    def test_guided_assigned_and_sitting_reject_before_protected_reads(self):
        fn = selected_function(ROUTER, '_programme_guided_context', require_resume_active=lambda _: None)
        for context in [{'class_assignment_item_id': 'synthetic-item'}, {'sitting_id': 'synthetic-sitting'}]:
            self.assert_status(422, lambda: fn(dict(status='in_progress', scoring_policy='report_only', **context)))

    def test_guided_submitted_rejects_409_before_protected_reads(self):
        fn = selected_function(ROUTER, '_programme_guided_context')
        self.assert_status(409, lambda: fn({'status': 'submitted'}))

    def test_programme_assigned_start_missing_rejects_422_before_assignment_validation(self):
        async def auth(_): return {'id': 'synthetic-owner'}
        db = types.SimpleNamespace(table=lambda _: Query([{
            'id': 'synthetic-test', 'status': 'published', 'content_package_id': 'synthetic-package',
            'scoring_policy': 'report_only', 'full_audio_storage_path': 'synthetic.wav',
        }]))
        fn = selected_function(ROUTER, 'start_listening_test_attempt', _require_auth=auth,
            supabase_admin=db, _assert_listening_exam_content_allowed=lambda *a, **kw: {'attempt_purpose': 'assigned_practice'})
        self.assert_status(422, lambda: asyncio.run(fn('synthetic-test', class_item='synthetic-item', authorization='synthetic', standalone=False)))

    def test_start_rejects_standalone_assigned_context_swap(self):
        async def auth(_): return {'id': 'synthetic-owner'}
        fn = selected_function(ROUTER, 'start_listening_test_attempt', _require_auth=auth)
        self.assert_status(422, lambda: asyncio.run(fn('synthetic-test', class_item='synthetic-item', standalone=True)))

    def test_a13_save_41_and_48_reject_before_answer_rpc(self):
        async def auth(_): return {'id': 'synthetic-owner'}
        fn = selected_function(ROUTER, 'patch_listening_test_attempt_answer', _require_auth=auth,
            _fetch_attempt_or_404=lambda *a: {'id': 'synthetic-attempt', 'status': 'in_progress'},
            bind_owned_attempt=lambda _: None, require_resume_active=lambda _: None,
            require_class_attempt_accepts_work=lambda *a, **kw: None, supabase_admin=object())
        for q_num in [41, 48, 49, 0]:
            self.assert_status(422, lambda: asyncio.run(fn('synthetic-attempt', types.SimpleNamespace(q_num=q_num, user_answer='synthetic'))))

    def test_review_non_submitted_blocks_assembly(self):
        async def auth(_): return {'id': 'synthetic-owner'}
        async def is_admin(_): return False
        fn = selected_function(ROUTER, 'get_listening_test_attempt_review', _require_auth=auth, _is_admin=is_admin,
            _fetch_attempt_or_404=lambda *a: {'status': 'in_progress'})
        self.assert_status(409, lambda: asyncio.run(fn('synthetic-attempt')))

    def test_review_cross_owner_fails_before_assembly(self):
        async def auth(_): return {'id': 'synthetic-intruder'}
        async def is_admin(_): return False
        def fetch(attempt, owner):
            self.assertEqual(owner, 'synthetic-intruder')
            raise HttpError(404, 'synthetic owner denial')
        fn = selected_function(ROUTER, 'get_listening_test_attempt_review', _require_auth=auth, _is_admin=is_admin, _fetch_attempt_or_404=fetch)
        self.assert_status(404, lambda: asyncio.run(fn('synthetic-attempt')))

    def test_submitted_assigned_owner_reaches_generic_assembly_not_blackeye_authorization(self):
        # Proves a generic route exists, NOT that its assembler satisfies MV1/MV2.
        async def auth(_): return {'id': 'synthetic-owner'}
        async def is_admin(_): return False
        attempt = {'id': 'synthetic-attempt', 'status': 'submitted', 'class_assignment_item_id': 'synthetic-item'}
        service = types.ModuleType('services')
        service.mock_correction_service = types.SimpleNamespace(capture_required_envelope=lambda *a: None)
        fn = selected_function(ROUTER, 'get_listening_test_attempt_review', _require_auth=auth, _is_admin=is_admin,
            _fetch_attempt_or_404=lambda *a: attempt, _mock_sealed=lambda _: False,
            _assemble_listening_review=lambda row, aid: {'synthetic_assembly': row is attempt})
        with patch.dict('sys.modules', {'services': service}):
            self.assertEqual(asyncio.run(fn('synthetic-attempt')), {'synthetic_assembly': True})

    def test_admin_programme_assignment_missing_rejects_400_before_writer(self):
        async def admin(_): return {'id': 'synthetic-admin'}
        db = types.SimpleNamespace(table=lambda _: Query([{
            'id': 'synthetic-test', 'status': 'published', 'content_package_id': 'synthetic-package',
            'scoring_policy': 'report_only',
        }]))
        body = types.SimpleNamespace(grammar_lesson_id=None, kind='daily', skill='listening',
                                     due_date='2026-12-01', content_id='synthetic-test')
        fn = selected_function(ROOT / 'backend/routers/admin_class_assignments.py', 'create_assignment',
            require_admin=admin, _require_cohort=lambda _: {}, _require_active_cohort=lambda _: None,
            _TEST_SKILLS={'listening': 'listening_tests'}, supabase_admin=db)
        self.assert_status(400, lambda: asyncio.run(fn('synthetic-cohort', body)))

    def test_review_snapshot_rejects_wrong_revision_and_returns_frozen_copy(self):
        path = ROOT / 'backend/services/mock_review_context.py'
        attempt = {'id': 'synthetic-attempt', 'test_id': 'synthetic-test', 'paper_revision': 1}
        frozen: dict[str, Any] = dict(skill='listening', attempt_id='synthetic-attempt', paper_id='synthetic-test',
                      paper_revision=1, paper_row={'title': 'synthetic revision one'}, source_rows=[], marking_rows=[])
        db = types.SimpleNamespace(table=lambda _: Query([frozen]))
        fn = selected_function(path, 'load_review_snapshot', deepcopy=copy.deepcopy)
        result = fn(db, 'listening', attempt)
        result['paper_row']['title'] = 'synthetic changed copy'
        self.assertEqual(frozen['paper_row']['title'], 'synthetic revision one')
        for revision in [None, 2]:
            frozen['paper_revision'] = revision
            self.assert_status(503, lambda: fn(db, 'listening', attempt))

    def test_revisionless_attempt_does_not_reuse_mock_snapshot(self):
        fn = selected_function(ROOT / 'backend/services/mock_paper_policy.py', 'load_marking_snapshot')
        # object has no table(); a private read here would fail the test.
        self.assertIsNone(fn(object(), 'listening', {'id': 'synthetic-attempt', 'paper_revision': None}))

    def test_composite_candidate_json_string_is_lossless_not_delimiter_encoded(self):
        for action in ['KEEP', 'CHANGE', None]:
            for text in ['', '  001 | x; y\nđúng "quoted" \\  ']:
                value = {'version': 'blackeye_keep_change_v1', 'action': action, 'correction_text': text}
                wire = {'q_num': 1, 'user_answer': json.dumps(value, ensure_ascii=False, separators=(',', ':'))}
                # JSON HTTP + existing string answer container feasibility only;
                # deliberately not labelled database or codec implementation.
                saved = json.loads(json.dumps(wire, ensure_ascii=False))
                self.assertEqual(json.loads(saved['user_answer']), value)

    def test_generic_importer_cap_stays_40_and_composite_type_absent(self):
        tree = ast.parse((ROOT / 'backend/services/listening_package_import.py').read_text())
        cap = next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'MAX_FORM_ITEMS' for t in n.targets))
        self.assertEqual(cap, 40)
        # Structural observation, not execution of the importer validator.
        constants = {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        self.assertNotIn('blackeye_keep_change_v1', constants)


if __name__ == '__main__':
    unittest.main()
