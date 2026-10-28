from __future__ import annotations

import copy
import hashlib
import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from config import settings  # noqa: E402
from services.writing_image_access import image_path  # noqa: E402
from scripts.import_writing_prompts import (  # noqa: E402
    ANALYSIS_CLEAR,
    CONTENT_DIR,
    Store,
    apply_plan,
    assert_staging,
    load_manifest,
    plan_import,
    run,
    summarize,
    validate_manifest,
)

MIGRATION_035 = Path(__file__).parent.parent / "migrations" / "035_writing_prompts_library.sql"
ORIGIN = settings.SUPABASE_URL.rstrip("/")
BUCKET = settings.WRITING_IMAGES_BUCKET


@pytest.fixture(scope="module")
def manifest():
    return load_manifest()


class _Store:
    """In-memory writing_prompts + private bucket, objects keyed by path.

    Mirrors the B10 storage contract: the upload returns a short-lived signed
    URL plus the object path, and stored refs resolve to the object path.
    """

    def __init__(self, rows=None, objects=None):
        self.rows = list(rows or [])
        self.objects = dict(objects or {})
        self.writes = []

    def list_prompts(self):
        return [dict(r) for r in self.rows]

    def insert(self, row):
        row = {"id": f"new-{len(self.rows) + 1}", "prompt_image_url": None,
               "prompt_image_public_id": None, **row}
        self.rows.append(row)
        self.writes.append(("insert", row["id"], dict(row)))
        return dict(row)

    def update(self, prompt_id, patch):
        row = next(r for r in self.rows if r["id"] == prompt_id)
        row.update(patch)
        self.writes.append(("update", prompt_id, dict(patch)))
        return dict(row)

    def upload_image(self, data, name):
        path = f"prompts/{len(self.objects)}-{name}"
        self.objects[path] = data
        self.writes.append(("upload", path, name))
        return {"url": f"{ORIGIN}/storage/v1/object/sign/{BUCKET}/{path}?token=short-lived",
                "public_id": path}

    def fetch_bytes(self, ref):
        return self.objects.get(image_path(ref))


def _live_copy(manifest):
    """A live table that already equals the manifest (the 2026-10-26 staging state)."""
    rows, objects = [], {}
    for n, item in enumerate(manifest["items"]):
        row = {"id": f"row-{n}", "task_type": item["task_type"], "title": item["title"],
               "prompt_text": item["prompt_text"], "difficulty": item["difficulty"],
               "tags": list(item["tags"]), "is_active": True, "exam_only": False,
               "prompt_image_url": None, "prompt_image_public_id": None}
        if item.get("image"):
            path = f"prompts/live-{n}.png"
            objects[path] = (CONTENT_DIR / item["image"]).read_bytes()
            row.update(prompt_image_url=path, prompt_image_public_id=path)
        rows.append(row)
    return rows, objects


# ── Committed batch content ───────────────────────────────────────────

def test_committed_batch_is_valid(manifest):
    assert validate_manifest(manifest) == []


def test_batch_has_the_approved_scope(manifest):
    counts = {}
    for item in manifest["items"]:
        counts[item["task_type"]] = counts.get(item["task_type"], 0) + 1
    assert counts == {"task2": 10, "task1_academic": 12, "task1_general": 6}


def test_every_task1_academic_image_is_committed_and_used_once(manifest):
    images = [i["image"] for i in manifest["items"] if i["task_type"] == "task1_academic"]
    on_disk = sorted(p.name for p in (CONTENT_DIR / "images").glob("*.png"))
    assert sorted(Path(i).name for i in images) == on_disk
    assert len(set(images)) == 12


def test_task2_replacements_keep_035_metadata_and_quote_the_seed(manifest):
    seed_sql = MIGRATION_035.read_text(encoding="utf-8")
    for item in (i for i in manifest["items"] if i["task_type"] == "task2"):
        old = item["replaces_seed"]["prompt_text"]
        assert old.replace("'", "''") in seed_sql, item["key"]
        assert f"'{item['title']}'" in seed_sql, item["key"]
        assert item["prompt_text"] != old
        assert item["review"]["status"] == "approved"


def test_retired_place_names_do_not_reach_learner_text(manifest):
    retired = ("Linton", "Hollins", "Greenhill", "Arden", "Bellport", "Carrow", "Delmont")
    for item in manifest["items"]:
        text = item["title"] + item["prompt_text"] + item.get("answer_key_draft", "")
        assert not any(name in text for name in retired), item["key"]


def test_unreviewed_items_are_flagged_for_content_manager(manifest):
    pending = {i["key"] for i in manifest["items"] if i["review"]["status"] == "needs_review"}
    assert {"A11", "G01", "G02", "G03", "G04", "G05", "G06"} <= pending
    a11 = next(i for i in manifest["items"] if i["key"] == "A11")
    assert "image" in a11["review"]["needs"]


@pytest.mark.parametrize("mutate, message", [
    (lambda m: m["items"][0].update(prompt_text="Too short"), "prompt_text"),
    (lambda m: m["items"][0].update(tags=[f"t{n}" for n in range(21)]), "at most 20"),
    (lambda m: m["items"][-1].update(image="images/A01-line-port-elwin-transport.png"),
     "only task1_academic"),
    (lambda m: next(i for i in m["items"] if i["key"] == "A01").update(image_sha256="0" * 64),
     "image_sha256"),
    (lambda m: m["items"][1].update(title=m["items"][0]["title"]), "not unique"),
    (lambda m: m["items"][0].update(prompt_text=m["items"][0]["prompt_text"] + " 中文"), "CJK"),
    (lambda m: m["items"][0].update(prompt_text=m["items"][0]["prompt_text"].replace("250", "200")),
     "Write at least 250 words."),
])
def test_validator_rejects_contract_violations(manifest, mutate, message):
    bad = copy.deepcopy(manifest)
    mutate(bad)
    assert any(message in e for e in validate_manifest(bad))


# ── Planning / idempotency ────────────────────────────────────────────

def test_matching_live_table_is_a_no_op(manifest):
    rows, objects = _live_copy(manifest)
    store = _Store(rows, objects)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert store.writes == []


def test_empty_table_creates_held_rows_then_reruns_clean(manifest):
    store = _Store()
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert len(store.rows) == 28
    assert all(r["exam_only"] is True and r["is_active"] is True for r in store.rows)
    uploads = [w for w in store.writes if w[0] == "upload"]
    assert len(uploads) == 12
    for row in store.rows:
        item = next(i for i in manifest["items"] if i["title"] == row["title"])
        if item.get("image"):
            assert row["prompt_image_url"] == row["prompt_image_public_id"]
            assert hashlib.sha256(store.objects[row["prompt_image_url"]]).hexdigest() == item["image_sha256"]
            assert row["prompt_image_analysis_reviewed"] is False
        else:
            assert row["prompt_image_url"] is None
    before = list(store.writes)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert store.writes == before


def test_visible_flag_creates_bank_visible_rows(manifest):
    store = _Store()
    assert run(store, manifest, execute=True, visible=True, progress=lambda _: None) == 0
    assert {r["exam_only"] for r in store.rows} == {False}


def test_dry_run_never_writes(manifest):
    store = _Store()
    out = []
    assert run(store, manifest, execute=False, progress=out.append) == 0
    assert store.writes == []
    assert any(line.startswith("DRY RUN") for line in out)


def test_text_drift_patches_only_changed_fields_and_keeps_visibility(manifest):
    rows, objects = _live_copy(manifest)
    target = next(r for r in rows if r["title"].startswith("GT Letter – Complaint"))
    target.update(prompt_text="Old wording. Write at least 150 words.", exam_only=True)
    store = _Store(rows, objects)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert store.writes == [("update", target["id"], {"prompt_text": next(
        i["prompt_text"] for i in manifest["items"] if i["key"] == "G01")})]
    assert target["exam_only"] is True


def test_legacy_title_row_is_renamed_not_duplicated(manifest):
    rows, objects = _live_copy(manifest)
    a11 = next(r for r in rows if r["title"].startswith("Maps – Elmsworth"))
    a11["title"] = "Maps – Hollins University campus in 2010 and today"
    store = _Store(rows, objects)
    actions = plan_import(manifest, store.list_prompts(), store.fetch_bytes)
    assert summarize(actions) == {"unchanged": 27, "update": 1}
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert a11["title"] == "Maps – Elmsworth University campus in 2010 and today"
    assert len(store.rows) == 28


def test_changed_image_is_reuploaded_and_answer_key_reset(manifest):
    rows, objects = _live_copy(manifest)
    a11 = next(r for r in rows if r["title"].startswith("Maps – Elmsworth"))
    old_url = a11["prompt_image_url"]
    objects[old_url] = b"\x89PNG\r\n\x1a\n" + b"round-2" * 20
    a11.update(prompt_image_analysis_reviewed=True, prompt_image_analysis={"overview": "x"})
    store = _Store(rows, objects)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert a11["prompt_image_url"] != old_url
    assert a11["prompt_image_url"] == a11["prompt_image_public_id"]
    assert old_url in store.objects  # published objects are never deleted
    assert {k: a11[k] for k in ANALYSIS_CLEAR} == ANALYSIS_CLEAR


def test_archived_row_is_reported_not_resurrected(manifest):
    rows, objects = _live_copy(manifest)
    g6 = next(r for r in rows if r["title"].startswith("GT Letter – Apologising"))
    g6["is_active"] = False
    store = _Store(rows, objects)
    actions = plan_import(manifest, store.list_prompts(), store.fetch_bytes)
    assert [a.kind for a in actions if a.prompt_id == g6["id"]] == ["skip_archived"]
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert store.writes == [] and g6["is_active"] is False


def test_ambiguous_active_match_aborts_before_any_write(manifest):
    rows, objects = _live_copy(manifest)
    rows.append({**rows[0], "id": "dup"})
    store = _Store(rows, objects)
    store.rows[1]["prompt_text"] = "drifted text, write at least 250 words."
    assert run(store, manifest, execute=True, progress=lambda _: None) == 3
    assert store.writes == []


def test_old_035_seed_rows_are_retired_after_replacement(manifest):
    rows, objects = _live_copy(manifest)
    t2 = next(i for i in manifest["items"] if i["key"] == "T2-01")
    rows = [r for r in rows if r["title"] != t2["title"]]
    seed_row = {"id": "seed-1", "task_type": "task2", "title": "Legacy seed title",
                "prompt_text": t2["replaces_seed"]["prompt_text"], "difficulty": "intermediate",
                "tags": ["education", "opinion"], "is_active": True, "exam_only": False,
                "prompt_image_url": None, "prompt_image_public_id": None}
    store = _Store(rows + [seed_row], objects)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert seed_row["id"] in {w[1] for w in store.writes if w[0] == "update"}
    assert next(r for r in store.rows if r["id"] == "seed-1")["is_active"] is False
    assert any(r["title"] == t2["title"] and r["is_active"] for r in store.rows)
    before = list(store.writes)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert store.writes == before


@pytest.mark.parametrize("seed_active", [True, False])
def test_original_035_seed_with_replacement_title_is_kept_and_replaced(manifest, seed_active):
    # The replacements keep the 035 titles, so an unchanged seed row matches
    # the replacement by title. It must not be rewritten into the replacement
    # and then retired as a seed: that left no active prompt for the item.
    rows, objects = _live_copy(manifest)
    t2 = next(i for i in manifest["items"] if i["key"] == "T2-01")
    rows = [r for r in rows if r["title"] != t2["title"]]
    seed_text = t2["replaces_seed"]["prompt_text"]
    seed_row = {"id": "seed-1", "task_type": "task2", "title": t2["title"],
                "prompt_text": seed_text, "difficulty": "intermediate",
                "tags": ["education", "opinion"], "is_active": seed_active, "exam_only": False,
                "prompt_image_url": None, "prompt_image_public_id": None}
    store = _Store(rows + [seed_row], objects)
    actions = plan_import(manifest, store.list_prompts(), store.fetch_bytes)
    assert [(a.kind, a.prompt_id) for a in actions if a.key == "T2-01"] == (
        [("create", None), ("retire_seed", "seed-1")] if seed_active else [("create", None)])
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    seed_after = next(r for r in store.rows if r["id"] == "seed-1")
    assert seed_after["prompt_text"] == seed_text
    assert seed_after["is_active"] is False
    replacement = [r for r in store.rows if r["title"] == t2["title"] and r["is_active"]]
    assert [r["prompt_text"] for r in replacement] == [t2["prompt_text"]]
    before = list(store.writes)
    assert run(store, manifest, execute=True, progress=lambda _: None) == 0
    assert store.writes == before


# ── Private writing-images bucket (B10) ───────────────────────────────

class _Bucket:
    def __init__(self, objects):
        self.objects = objects
        self.downloads = []

    def download(self, path):
        self.downloads.append(path)
        if path not in self.objects:
            raise RuntimeError("Object not found")
        return self.objects[path]


@pytest.fixture
def private_bucket(monkeypatch):
    """Service-role storage client; any plain HTTP fetch fails the test."""
    bucket = _Bucket({})
    client = MagicMock()
    client.storage.from_.side_effect = (
        lambda name: bucket if name == BUCKET else pytest.fail(f"wrong bucket {name}"))
    import database
    import httpx
    monkeypatch.setattr(database, "supabase_admin", client)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: pytest.fail(f"HTTP fetch of {a[0]!r}"))
    return bucket


def _with_refs(manifest, private_bucket, ref_for_path):
    rows, objects = _live_copy(manifest)
    private_bucket.objects.update(objects)
    for row in rows:
        if row["prompt_image_url"]:
            row["prompt_image_url"] = ref_for_path(row["prompt_image_url"])
    return rows


@pytest.mark.parametrize("ref_for_path", [
    lambda path: path,                                                       # B10 rows
    lambda path: f"{ORIGIN}/storage/v1/object/public/{BUCKET}/{path}",       # pre-B10 rows
], ids=["object-path", "legacy-public-url"])
def test_stored_images_are_read_from_the_private_bucket(manifest, private_bucket, ref_for_path):
    rows = _with_refs(manifest, private_bucket, ref_for_path)
    actions = plan_import(manifest, rows, Store().fetch_bytes)
    assert summarize(actions) == {"unchanged": 28}
    assert sorted(private_bucket.downloads) == sorted(
        r["prompt_image_public_id"] for r in rows if r["prompt_image_public_id"])


def test_foreign_image_url_is_fetched_over_http(monkeypatch, private_bucket):
    foreign = "https://cdn.example.org/chart.png"
    monkeypatch.setattr("httpx.get", lambda url, **_: MagicMock(status_code=200, content=b"png")
                        if url == foreign else pytest.fail(url))
    assert Store().fetch_bytes(foreign) == b"png"
    assert private_bucket.downloads == []


@pytest.mark.parametrize("ref", [
    "prompts/missing.png",                                                    # object gone
    f"{ORIGIN}/storage/v1/object/public/{BUCKET}/prompts/missing.png",
    f"{ORIGIN}/storage/v1/object/public/other-bucket/x.png",                  # unresolvable
])
def test_unreadable_stored_image_aborts_instead_of_clearing_the_answer_key(
        manifest, private_bucket, ref):
    rows = _with_refs(manifest, private_bucket, lambda path: path)
    a01 = next(r for r in rows if r["prompt_image_url"])
    a01["prompt_image_url"] = ref
    store = _Store(rows)
    store.fetch_bytes = Store().fetch_bytes
    out = []
    assert run(store, manifest, execute=True, progress=out.append) == 3
    assert store.writes == []
    assert any(a01["id"] in line and "could not be read" in line for line in out)


def test_image_writes_store_the_object_path_not_the_signed_url(manifest):
    store = _Store()
    actions = plan_import(manifest, [], store.fetch_bytes)
    apply_plan(store, manifest, actions, progress=lambda _: None)
    image_rows = [r for r in store.rows if r["prompt_image_url"]]
    assert len(image_rows) == 12
    for row in image_rows:
        assert row["prompt_image_url"] == row["prompt_image_public_id"]
        assert row["prompt_image_url"].startswith("prompts/")
        assert "://" not in row["prompt_image_url"] and "token" not in row["prompt_image_url"]


def test_upload_that_does_not_resolve_to_its_path_writes_nothing(manifest):
    store = _Store()
    store.upload_image = lambda data, name: {"url": "https://elsewhere.test/x.png?token=t",
                                             "public_id": "prompts/x.png"}
    actions = [a for a in plan_import(manifest, [], store.fetch_bytes) if a.upload_image][:1]
    with pytest.raises(RuntimeError, match="object path"):
        apply_plan(store, manifest, actions, progress=lambda _: None)
    assert store.rows == []


@pytest.mark.parametrize("url", [
    "", "https://huwsmtubwulikhlmcirx.supabase.co", "http://localhost:54321",
    "https://zjphffoujxkpltixsbzj.supabase.co.evil.test",
])
def test_non_staging_targets_are_refused(url):
    with pytest.raises(SystemExit):
        assert_staging(url)


def test_staging_target_is_accepted():
    assert_staging("https://zjphffoujxkpltixsbzj.supabase.co")
