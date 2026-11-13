"""An enforcing drift gate; OPEN checkpoint debt is not security acceptance."""
import ast
import json
from pathlib import Path

import pytest

from restricted_content_inventory import inventory_errors, scan_backend, scan_sources


BACKEND = Path(__file__).resolve().parents[1]
FIXTURES = BACKEND / "tests/fixtures"


def test_namespace_inventory_rejects_new_or_changed_readers():
    approved = json.loads((FIXTURES / "restricted_content_allowlist.json").read_text())
    pending = json.loads((FIXTURES / "restricted_content_open_inventory.json").read_text())
    assert pending["status"] == "OPEN_CHECKPOINT_NOT_ACCEPTANCE"
    errors = inventory_errors(scan_backend(BACKEND), approved["rows"], pending["rows"])
    assert not errors, "\n".join(errors)


def test_allowlist_has_individual_class_reason_and_concrete_proof():
    approved = json.loads((FIXTURES / "restricted_content_allowlist.json").read_text())
    pending = json.loads((FIXTURES / "restricted_content_open_inventory.json").read_text())
    assert approved["rows"]
    assert not ({(r["file"], r["function"]) for r in approved["rows"]}
                & {(r["file"], r["function"]) for r in pending["rows"]})
    for row in approved["rows"]:
        assert row["class"] in {"view", "by_id_guarded", "bound_at_link", "write_only"}, row
        assert len(row["reason"]) >= 20 and "OPEN" not in row["reason"], row
        file, function = row["proving_test"].split("::")
        assert file.startswith("tests/") and ".." not in Path(file).parts, row
        tree = ast.parse((BACKEND / file).read_text())
        assert any(isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == function
                   for n in ast.walk(tree)), row


@pytest.mark.parametrize("addition", [
    "db.table('listening_tests').select('*').execute()",
    "db.table(target).select('*').execute()",
    "db.rpc('new_namespace_reader', {}).execute()",
    "db.rpc(target, {}).execute()",
    "getattr(db, 'table')(target).select('*').execute()",
    "getattr(db, target)(target).execute()",
    "read = db.table\n    read(target).select('*').execute()",
    "public_content(db).select('*').execute()",
])
def test_negative_addition_of_namespace_reader_fails(addition):
    rows = scan_sources({"routers/new.py": "def added(db, target):\n    " + addition + "\n"})
    assert rows
    assert any("Unlisted namespace surface" in error for error in inventory_errors(rows, [], []))


def test_negative_addition_inside_an_existing_reader_fails():
    before = {"routers/example.py": "def read(db):\n    return db.table('listening_tests')\n"}
    known = scan_sources(before)
    after = {"routers/example.py": before["routers/example.py"] + "    db.table('listening_content')\n"}
    assert any("Changed allowlist" in error for error in inventory_errors(scan_sources(after), known, []))


def test_negative_dynamic_factory_and_import_alias_addition_fails():
    before = {"services/factory.py": "def read_table(db, name):\n    return db.table(name)\n"}
    known = scan_sources(before)
    after = {**before, "routers/new.py": (
        "from services.factory import read_table as hydrate\n"
        "def added(db, target):\n    return hydrate(db, target)\n")}
    assert any("routers/new.py" in error for error in inventory_errors(scan_sources(after), known, []))


def test_negative_module_mapping_change_fails_even_with_unchanged_reader_body():
    before = {"routers/example.py": "TABLE = 'ordinary'\ndef read(db):\n    return db.table(TABLE)\n"}
    known = scan_sources(before)
    after = {"routers/example.py": before["routers/example.py"].replace("'ordinary'", "'listening_tests'")}
    assert any("context_sha256" in error for error in inventory_errors(scan_sources(after), known, []))


def test_negative_imported_rpc_alias_addition_fails():
    rows = scan_sources({"routers/new.py": (
        "from database import rpc as invoke\n"
        "def added(name):\n    return invoke(name, {})\n")})
    assert any("Unlisted namespace surface" in error for error in inventory_errors(rows, [], []))


def test_open_checkpoint_cannot_silently_authorize_an_additional_reader():
    before = {"routers/example.py": "def read(db, target):\n    return db.table(target)\n"}
    pending = scan_sources(before)
    after = {"routers/example.py": before["routers/example.py"] + "    db.rpc(target, {})\n"}
    assert any("Changed OPEN" in error for error in inventory_errors(scan_sources(after), [], pending))


def test_negative_class_mapping_change_fails_with_unchanged_method_body():
    before = {"services/example.py": (
        "class Reader:\n    TABLE = 'ordinary'\n"
        "    def read(self, db):\n        return db.table(self.TABLE)\n")}
    known = scan_sources(before)
    after = {"services/example.py": before["services/example.py"].replace("'ordinary'", "'listening_' + 'tests'")}
    assert any("context_sha256" in error for error in inventory_errors(scan_sources(after), known, []))
