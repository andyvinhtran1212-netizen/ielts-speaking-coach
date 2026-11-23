"""LIBRARY-0061 T011 (G06-T11): Kiến thức Writing API (FR-020, FR-022, FR-023).
The database is faked; the router is the real one in main.py."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from services import library_guides
from tests._library_fake_db import FakeDB


def _guide(slug, *, title, task="task_2", category=None, order=0, published=True,
           content_type="knowledge", body=None, updated="2026-11-10T00:00:00+00:00"):
    return {
        "id": f"id-{slug}",
        "slug": slug,
        "title": title,
        "body_markdown": body if body is not None else f"Mở bài về {title}.\n\n## Phần một\n\nNội dung.",
        "task_type": task,
        "category": category,
        "display_order": order,
        "published": published,
        "content_type": content_type,
        "type_data": {"internal": True},
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": updated,
    }


CITING_BODY = (
    "Một đoạn mở bài có trích [[sample:alpha-schools#7.0]] ngay trong câu.\n\n"
    "## Ví dụ\n\n"
    "[[sample:alpha-schools#7.5]]\n\n"
    "[[sample:gone-sample#7.5]]\n\n"
    "[[sample:alpha-schools#9.0]]\n\n"
    "### Chi tiết\n\nHết."
)


def _samples():
    return [
        {"slug": "alpha-schools", "title_en": "Alpha schools", "published": True,
         "essays": {"7.5": {"text": "First paragraph at 7.5.\n\nSecond paragraph."},
                    "7.0": {"text": "Seven."}}},
        {"slug": "gone-sample", "title_en": "Gone", "published": False,
         "essays": {"7.5": {"text": "Should never appear."}}},
    ]


@pytest.fixture()
def db(monkeypatch):
    fake = FakeDB(tables={
        "writing_tips": [
            _guide("thesis", title="Viết câu luận điểm", task="task_2", order=2),
            _guide("overview", title="Câu tổng quan Task 1", task="task_1", order=1),
            _guide("band-descriptors", title="Đọc band descriptors", task="both",
                   category="Tiêu chí chấm", order=0, updated="2026-11-20T08:00:00+00:00"),
            _guide("opinion-type", title="Dạng Opinion", task="task_2", category="question_type",
                   order=1, body=CITING_BODY),
            _guide("draft", title="Bản nháp", published=False),
            _guide("outline-row", title="Dàn ý", content_type="outline"),
            _guide("tip-row", title="Mẹo nhỏ", task="task_1", content_type="tip", order=5),
        ],
        "writing_samples": _samples(),
    })
    import routers.library as library

    monkeypatch.setattr(library, "supabase_admin", fake)
    return fake


@pytest.fixture()
def client(db):
    from main import app

    return TestClient(app)


# ── groups (FR-020) ─────────────────────────────────────────────────────────


def test_list_has_four_fixed_groups_in_order(client):
    res = client.get("/api/library/writing-guides")
    assert res.status_code == 200
    body = res.json()
    assert [g["id"] for g in body["groups"]] == ["task1", "task2", "criteria", "question-type"]
    assert [g["label"] for g in body["groups"]] == ["Task 1", "Task 2", "Tiêu chí chấm", "Dạng đề"]
    assert body["total"] == 5


def test_only_published_knowledge_and_tip_rows(client):
    text = client.get("/api/library/writing-guides").text
    assert "draft" not in text and "Bản nháp" not in text
    assert "outline-row" not in text
    assert "tip-row" in text
    assert "type_data" not in text and "internal" not in text


def test_guide_in_two_groups_has_one_url(client):
    groups = {g["id"]: g for g in client.get("/api/library/writing-guides").json()["groups"]}
    task2 = [i["slug"] for i in groups["task2"]["items"]]
    types = [i["slug"] for i in groups["question-type"]["items"]]
    assert "opinion-type" in task2 and "opinion-type" in types
    # "both" lands in Task 1 and Task 2; its category adds Tiêu chí chấm.
    for gid in ("task1", "task2", "criteria"):
        assert "band-descriptors" in [i["slug"] for i in groups[gid]["items"]]
    item = next(i for i in groups["criteria"]["items"] if i["slug"] == "band-descriptors")
    assert item["groups"] == ["task1", "task2", "criteria"]


def test_group_order_is_display_order_then_title(client):
    groups = {g["id"]: g for g in client.get("/api/library/writing-guides").json()["groups"]}
    assert [i["slug"] for i in groups["task1"]["items"]] == ["band-descriptors", "overview", "tip-row"]
    assert [i["slug"] for i in groups["task2"]["items"]] == ["band-descriptors", "opinion-type", "thesis"]


def test_list_item_shape(client):
    groups = client.get("/api/library/writing-guides").json()["groups"]
    item = next(i for g in groups for i in g["items"] if i["slug"] == "thesis")
    assert set(item) == {"slug", "title", "summary", "reading_minutes", "groups", "updated_at"}
    assert item["summary"] == "Mở bài về Viết câu luận điểm."
    assert item["reading_minutes"] == 1


def test_empty_table_gives_empty_groups(client, db):
    db.tables["writing_tips"] = []
    body = client.get("/api/library/writing-guides").json()
    assert body["total"] == 0
    assert all(g["items"] == [] for g in body["groups"])


@pytest.mark.parametrize("task, category, expected", [
    ("task_1", None, ["task1"]),
    ("task_2", "", ["task2"]),
    ("both", None, ["task1", "task2"]),
    ("task_2", "Dạng đề", ["task2", "question-type"]),
    ("task_1", "criteria", ["task1", "criteria"]),
    ("task_2", "Tiêu chí chấm", ["task2", "criteria"]),
    ("task_2", "coherence", ["task2"]),
])
def test_group_mapping(task, category, expected):
    assert library_guides.guide_groups({"task_type": task, "category": category}) == expected


# ── detail (FR-022, FR-023) ─────────────────────────────────────────────────


def test_detail_payload_and_updated_at(client):
    res = client.get("/api/library/writing-guides/band-descriptors")
    assert res.status_code == 200
    body = res.json()
    assert body["updated_at"] == "2026-11-20T08:00:00+00:00"
    assert body["groups"] == [
        {"id": "task1", "label": "Task 1"},
        {"id": "task2", "label": "Task 2"},
        {"id": "criteria", "label": "Tiêu chí chấm"},
    ]
    assert body["toc"] == [{"id": "phan-mot", "label": "Phần một", "n": "1"}]
    assert '<h2 id="phan-mot">Phần một</h2>' in body["html"]
    assert res.headers["cache-control"] == "no-cache"
    assert res.headers["last-modified"] == "Fri, 20 Nov 2026 08:00:00 GMT"


def test_prev_next_within_first_group(client):
    first = client.get("/api/library/writing-guides/band-descriptors").json()
    assert first["prev"] is None
    assert first["next"] == {"slug": "overview", "title": "Câu tổng quan Task 1"}
    middle = client.get("/api/library/writing-guides/opinion-type").json()
    assert middle["prev"] == {"slug": "band-descriptors", "title": "Đọc band descriptors"}
    assert middle["next"] == {"slug": "thesis", "title": "Viết câu luận điểm"}


def test_unknown_or_unpublished_guide_is_404_no_store(client):
    for slug in ("nope", "draft", "outline-row"):
        res = client.get(f"/api/library/writing-guides/{slug}")
        assert res.status_code == 404
        assert res.json() == {"detail": "guide_not_found"}
        assert res.headers["cache-control"] == "no-store"


def test_sample_citations_card_link_and_dropped(client):
    html = client.get("/api/library/writing-guides/opinion-type").json()["html"]
    # inline -> link to the right sample and band
    assert '<a class="sample-cite-link" href="/library/writing-samples/alpha-schools?muc=7.0">Alpha schools (bản 7.0)</a>' in html
    # own line -> quote card with the first paragraph of that band
    assert '<figure class="sample-cite">' in html
    assert "First paragraph at 7.5." in html and "Second paragraph." not in html
    assert 'href="/library/writing-samples/alpha-schools?muc=7.5"' in html
    # unpublished sample and unknown band are dropped, no token left
    assert "Should never appear" not in html and "gone-sample" not in html
    assert "9.0" not in html and "AVERSAMPLECITE" not in html and "[[sample" not in html
    assert "<p></p>" not in html


def test_sample_removed_later_drops_card(client, db):
    db.tables["writing_samples"][0]["published"] = False
    html = client.get("/api/library/writing-guides/opinion-type").json()["html"]
    assert "sample-cite" not in html and "alpha-schools" not in html


def test_db_failure_is_503_no_store(client, db):
    db.broken.add("writing_tips")
    for path in ("/api/library/writing-guides", "/api/library/writing-guides/thesis",
                 "/api/library/writing-guides/index"):
        res = client.get(path)
        assert res.status_code == 503
        assert res.json() == {"detail": "library_unavailable"}
        assert res.headers["cache-control"] == "no-store"


def test_index_for_sitemap(client):
    body = client.get("/api/library/writing-guides/index").json()
    assert {r["slug"] for r in body} == {"thesis", "overview", "band-descriptors", "opinion-type", "tip-row"}
    assert all(set(r) == {"slug", "updated_at"} for r in body)


def test_routes_are_public_without_account(client):
    from services.activation_gate import ACTIVATION_EXEMPT_ROUTES

    for path in ("/api/library/writing-guides", "/api/library/writing-guides/index",
                 "/api/library/writing-guides/{slug}"):
        assert ACTIVATION_EXEMPT_ROUTES[("GET", path)] == "public Library"


# ── rendering safety ────────────────────────────────────────────────────────


def test_raw_html_is_shown_as_text():
    out = library_guides.render_guide(
        "Đoạn <script>alert(1)</script> và <b>đậm</b>.\n\n<div onclick=\"x()\">khối</div>\n", {}
    )["html"]
    assert "<script" not in out and "<div" not in out and "<b>" not in out
    assert "&lt;script&gt;" in out and "&lt;div" in out


@pytest.mark.parametrize("md", [
    "[bấm](javascript:alert(1))",
    "[bấm](JaVaScRiPt:alert(1))",
    # A real-looking payload (<script>alert(1)</script>): the CI artifact guard
    # decodes data: URIs in the Playwright git diff, and bytes it cannot read
    # (such as "AAAA" = three NUL bytes) block the upload.
    "[bấm](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[bấm](//evil.example/x)",
    "![ảnh](javascript:alert(1))",
    "[bấm](&#106;avascript:alert(1))",
    "[bấm](/\\evil.com)",
    "[bấm](/&#9;/evil.com)",
    "[bấm](/&#10;/evil.com)",
    "![ảnh](/\\evil.com/x.png)",
])
def test_unsafe_urls_are_neutralised(md):
    out = library_guides.render_guide(md, {})["html"]
    assert "javascript" not in out.lower() and "data:" not in out and "evil" not in out


def test_guide_text_that_looks_like_a_placeholder_is_kept():
    out = library_guides.render_guide("Chữ AVERSAMPLECITE9Z và AVERCITE00N9Z ở đây.", {})["html"]
    assert "AVERSAMPLECITE9Z" in out and "AVERCITE00N9Z" in out


SAMPLES = {"a": {"slug": "a", "title_en": "Alpha", "essays": {"7.5": {"text": "Q."}}}}


def test_citation_inside_a_link_url_stays_literal():
    out = library_guides.render_guide("[xem]([[sample:a#7.5]]) tiếp", SAMPLES)["html"]
    assert out.count("<a") == 1 and "sample-cite" not in out
    assert 'href="#"' in out


def test_citation_inside_code_stays_literal():
    out = library_guides.render_guide("Viết `[[sample:a#7.5]]` như sau.\n\n```\n[[sample:a#7.0]]\n```", SAMPLES)["html"]
    assert "sample-cite" not in out and "<a" not in out
    assert out.count("[[sample:a#7.5]]") == 1 and out.count("[[sample:a#7.0]]") == 1


def test_citation_in_heading_is_left_out_of_contents():
    out = library_guides.render_guide("## Xem [[sample:a#7.5]] nhé", SAMPLES)
    assert out["toc"][0] == {"id": "xem-nhe", "label": "Xem nhé", "n": "1"}
    assert "sample-cite-link" in out["html"]


def test_safe_urls_are_kept():
    out = library_guides.render_guide(
        "[a](https://example.com/x) [b](/library) [c](#muc) [d](mailto:a@b.c)", {}
    )["html"]
    for href in ("https://example.com/x", "/library", "#muc", "mailto:a@b.c"):
        assert f'href="{href}"' in out


def test_markdown_features_and_toc_numbering():
    out = library_guides.render_guide(
        "## Đầu tiên\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n### Con\n\n## Thứ hai\n\n1. một\n2. hai\n", {}
    )
    assert "<table>" in out["html"] and "<ol>" in out["html"]
    assert out["toc"] == [
        {"id": "dau-tien", "label": "Đầu tiên", "n": "1"},
        {"id": "thu-hai", "label": "Thứ hai", "n": "2"},
    ]


def test_list_and_page_reading_minutes_agree(client):
    groups = client.get("/api/library/writing-guides").json()["groups"]
    listed = {i["slug"]: i["reading_minutes"] for g in groups for i in g["items"]}
    for slug, minutes in listed.items():
        assert client.get(f"/api/library/writing-guides/{slug}").json()["reading_minutes"] == minutes


def test_reading_minutes_skips_citations():
    assert library_guides.reading_minutes("word " * 200 + "[[sample:a#7.5]] [[sample:b#7.0]]") == 1


def test_reading_minutes_rounds_up():
    assert library_guides.reading_minutes("word " * 200) == 1
    assert library_guides.reading_minutes("word " * 201) == 2
    assert library_guides.reading_minutes("") == 1


def test_plain_summary_skips_headings_and_strips_markup():
    body = "# Tiêu đề\n\n- danh sách\n\nĐoạn có **đậm**, [liên kết](/x) và [[sample:a#7.0]] trích.\n\nĐoạn hai."
    assert library_guides.plain_summary(body) == "Đoạn có đậm, liên kết và trích."
    long = "chữ " * 100
    summary = library_guides.plain_summary(long)
    assert summary.endswith("…") and len(summary) <= library_guides.SUMMARY_MAX + 1
