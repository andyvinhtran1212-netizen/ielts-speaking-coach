"""/grammar field LCP p75 rule (owner decision 2026-10-28, q-98).

Pins the evaluation rule in scripts/grammar_field_lcp.py: rolling 28-day
window, >= 30 real-user samples per device class (desktop and mobile judged
separately) before PASS/FAIL, INSUFFICIENT_DATA below that, crawlers and
headless browsers excluded and never counted toward the minimum, and a
SELECT-only query whose result is refused unless every row proves
transaction_read_only = 'on'.
"""

from __future__ import annotations

import io
import json

import pytest

import routers.error_logs as el
from scripts import grammar_field_lcp as g

NOW = 1_800_000_000.0
DAY = 86400
DESKTOP = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
           "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
MOBILE = ("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36")
IPHONE = ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
          "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
BOTS = [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)",
    "SunriseTranscriptionReach/1.0 (+https://sunrisetranscription.com)",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PTST/250101.010101",
]

_seq = iter(range(10**9))


def row(lcp, ua=DESKTOP, path="/grammar", age_days=1.0, metric_id=None):
    n = next(_seq)
    return {"id": str(n), "created_at": NOW - age_days * DAY, "path": path, "ua": ua,
            "metric_id": metric_id or f"v5-{n}", "lcp": lcp}


def cell(report, group="hub", device="desktop"):
    return report["groups"][group][device]


def test_rule_constants_are_the_owner_decision():
    assert g.WINDOW_DAYS == 28
    assert g.MIN_SAMPLES_PER_DEVICE == 30
    assert g.TARGET_LCP_P75_MS == 2500
    assert g.DEVICE_CLASSES == ("desktop", "mobile")


@pytest.mark.parametrize("n", [1, 2, 3, 4, 5, 29, 30, 31, 101])
def test_p75_matches_backend_nearest_rank(n):
    values = [float(v * 37 % 997) for v in range(n)]
    assert g.p75(values) == el._p75(values)


def test_29_samples_is_insufficient_30_is_judged():
    r29 = g.evaluate([row(900) for _ in range(29)], NOW)
    assert cell(r29)["samples"] == 29
    assert cell(r29)["verdict"] == g.INSUFFICIENT
    r30 = g.evaluate([row(900) for _ in range(30)], NOW)
    assert cell(r30)["verdict"] == g.PASS


def test_insufficient_even_when_the_thin_p75_breaches():
    report = g.evaluate([row(9000) for _ in range(29)], NOW)
    assert cell(report)["p75_ms"] == 9000
    assert cell(report)["verdict"] == g.INSUFFICIENT
    assert g.exit_code(report) == 0


def test_target_boundary_is_inclusive():
    # 30 samples: nearest-rank p75 is the 23rd value.
    at = [row(100) for _ in range(22)] + [row(2500) for _ in range(8)]
    over = [row(100) for _ in range(22)] + [row(2501) for _ in range(8)]
    assert cell(g.evaluate(at, NOW))["verdict"] == g.PASS
    report = g.evaluate(over, NOW)
    assert cell(report)["verdict"] == g.FAIL
    assert g.exit_code(report) == 1


def test_device_classes_are_judged_separately():
    rows = [row(800) for _ in range(30)] + [row(3000, ua=MOBILE) for _ in range(29)]
    report = g.evaluate(rows, NOW)
    assert cell(report, device="desktop")["verdict"] == g.PASS
    assert cell(report, device="mobile")["samples"] == 29
    assert cell(report, device="mobile")["verdict"] == g.INSUFFICIENT
    # Pooling would have judged 59 samples together; it must not.
    rows += [row(3000, ua=IPHONE)]
    report = g.evaluate(rows, NOW)
    assert cell(report, device="mobile")["verdict"] == g.FAIL
    assert cell(report, device="desktop")["verdict"] == g.PASS


@pytest.mark.parametrize("ua", BOTS)
def test_crawlers_and_headless_are_excluded(ua):
    assert g.device_class(ua) == "bot"


def test_bots_never_count_toward_the_minimum():
    rows = [row(800) for _ in range(29)] + [row(800, ua=ua) for ua in BOTS * 5]
    report = g.evaluate(rows, NOW)
    assert cell(report)["samples"] == 29
    assert cell(report)["verdict"] == g.INSUFFICIENT
    assert report["excluded"]["bot"] == len(BOTS) * 5


def test_real_browsers_are_classified_by_ua():
    assert g.device_class(DESKTOP) == "desktop"
    assert g.device_class(MOBILE) == "mobile"
    assert g.device_class(IPHONE) == "mobile"
    assert g.device_class("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/604.1") == "tablet"
    assert g.device_class("") == "unknown"
    assert g.device_class(None) == "unknown"


def test_tablet_and_unknown_ua_are_in_neither_class():
    rows = [row(800, ua="Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), row(800, ua="")]
    report = g.evaluate(rows, NOW)
    assert cell(report, device="desktop")["samples"] == 0
    assert cell(report, device="mobile")["samples"] == 0
    assert report["excluded"]["tablet"] == 1
    assert report["excluded"]["unknown"] == 1


def test_window_is_rolling_28_days():
    rows = ([row(800, age_days=27.99) for _ in range(30)]
            + [row(99999, age_days=28.01) for _ in range(30)])
    report = g.evaluate(rows, NOW)
    assert cell(report)["samples"] == 30
    assert cell(report)["verdict"] == g.PASS
    assert report["excluded"]["outside_window"] == 30
    assert report["window"]["end"].startswith("2027-01-15T08:00:00")


def test_duplicate_metric_ids_count_once_earliest_kept():
    rows = [row(800, metric_id="v5-a", age_days=2), row(5000, metric_id="v5-a", age_days=1)]
    report = g.evaluate(rows, NOW)
    assert cell(report)["samples"] == 1
    assert cell(report)["p75_ms"] == 800
    assert report["excluded"]["duplicate"] == 1


def test_hub_and_articles_are_separate_page_groups():
    assert g.page_group("/grammar") == "hub"
    assert g.page_group("/grammar/") == "hub"
    assert g.page_group("/grammar/tenses/present-simple") == "articles"
    assert g.page_group("/grammar/tenses") == "articles"
    assert g.page_group("/grammar/tenses/past-perfect?ref=home") == "articles"
    assert g.page_group("/grammar-quiz") is None
    assert g.page_group("/vocabulary/hub") is None
    rows = ([row(800) for _ in range(30)]
            + [row(4000, path="/grammar/tenses/past-perfect") for _ in range(30)])
    report = g.evaluate(rows, NOW)
    assert cell(report, "hub")["verdict"] == g.PASS
    assert cell(report, "articles")["verdict"] == g.FAIL


def test_outliers_that_set_p75_are_flagged_not_dropped():
    rows = [row(800) for _ in range(22)] + [row(185_000) for _ in range(8)]
    report = g.evaluate(rows, NOW)
    c = cell(report)
    assert c["verdict"] == g.FAIL and c["p75_ms"] == 185_000 and c["over_60s"] == 8
    assert g.outliers_decide_p75(c)
    assert "WARN\t/grammar\tdesktop\t8/30" in g.render(report)
    calm = g.evaluate([row(800) for _ in range(29)] + [row(185_000)], NOW)
    assert not g.outliers_decide_p75(cell(calm))


def test_render_says_insufficient_data_and_points_at_lab_budget():
    text = g.render(g.evaluate([row(800) for _ in range(5)], NOW))
    assert "FIELD INSUFFICIENT_DATA\t/grammar\tdesktop\tn=5" in text
    assert "insufficient data" in text
    assert "lab budget" in text
    assert "synthetic" in text


def test_sql_is_select_only_in_a_read_only_transaction():
    sql = g.SQL
    assert sql.startswith("SET TRANSACTION READ ONLY;")
    assert "interval '28 days'" in sql
    assert "current_setting('transaction_read_only')" in sql
    body = sql.split(";", 1)[1].upper()
    for verb in ("INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE", "ALTER", "CREATE", "DROP", "GRANT"):
        assert verb not in body.replace("CREATED_AT", "")


def test_result_without_read_only_proof_is_refused():
    with pytest.raises(ValueError, match="transaction_read_only"):
        g.split_query_result([{"ro": "on", "db_now": NOW, "id": None},
                              {"ro": "off", "db_now": NOW, "id": "1"}])
    with pytest.raises(ValueError, match="no rows"):
        g.split_query_result([])
    now, rows = g.split_query_result([{"ro": "on", "db_now": NOW, "id": None}])
    assert now == NOW and rows == []


def test_fetch_sends_read_only_flag_and_rejects_bad_ref():
    seen = {}

    class Resp(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def opener(req, timeout):
        seen["url"] = req.full_url
        seen["body"] = json.loads(req.data)
        return Resp(json.dumps([{"ro": "on", "db_now": NOW, "id": None}]).encode())

    out = g.fetch_rows("abcdefghijklmnopqrst", "tok", opener=opener)
    assert out == [{"ro": "on", "db_now": NOW, "id": None}]
    assert seen["body"]["read_only"] is True
    assert seen["body"]["query"] == g.SQL
    assert seen["url"].endswith("/projects/abcdefghijklmnopqrst/database/query")
    with pytest.raises(ValueError):
        g.fetch_rows("../other", "tok", opener=opener)


def test_cli_rows_file_exit_codes(tmp_path, capsys):
    def run(rows):
        path = tmp_path / "rows.json"
        path.write_text(json.dumps([{"ro": "on", "db_now": NOW, "id": None,
                                     "created_at": None, "path": None}]
                                   + [dict(r, ro="on", db_now=NOW) for r in rows]))
        return g.main(["--rows", str(path)])

    assert run([row(800) for _ in range(10)]) == 0
    assert "insufficient data" in capsys.readouterr().out
    assert run([row(4000) for _ in range(30)]) == 1
    assert "FIELD FAIL\t/grammar\tdesktop\tn=30" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text("{}")
    assert g.main(["--rows", str(bad)]) == 2


# Codex round 1 on fe41ebc23 (PRRT_kwDOR6Uds86xBN6c): tablets must be checked
# before the phone markers. iPad Safari/Chrome carry "Mobile/15E148" and Android
# tablets carry "Android" without "Mobile"; both were counted as mobile.
IPAD_SAFARI = ("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
               "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1")
IPAD_CHROME = ("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
               "(KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1")
ANDROID_TABLET_CHROME = ("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
ANDROID_TABLET_FIREFOX = "Mozilla/5.0 (Android 14; Tablet; rv:132.0) Gecko/132.0 Firefox/132.0"
TABLETS = [IPAD_SAFARI, IPAD_CHROME, ANDROID_TABLET_CHROME, ANDROID_TABLET_FIREFOX]
PHONES = [
    MOBILE,
    IPHONE,
    # Chrome's reduced Android UA (model "K").
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/154.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
    "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1",
    # A WebView on a Cubot phone: "CUBOT" contains "bot" but is a real browser.
    "Mozilla/5.0 (Linux; Android 12; CUBOT P60 Build/SP1A.210812.016; wv) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Version/4.0 Chrome/154.0.0.0 Mobile Safari/537.36",
]


@pytest.mark.parametrize("ua", TABLETS)
def test_tablet_markers_win_over_mobile_markers(ua):
    assert g.device_class(ua) == "tablet"


@pytest.mark.parametrize("ua", PHONES)
def test_phones_stay_mobile(ua):
    assert g.device_class(ua) == "mobile"


def test_ipad_with_mobile_token_is_excluded_not_judged_as_mobile():
    rows = ([row(800, ua=IPHONE) for _ in range(29)]
            + [row(9000, ua=IPAD_SAFARI) for _ in range(30)]
            + [row(9000, ua=IPAD_CHROME) for _ in range(5)])
    report = g.evaluate(rows, NOW)
    m = cell(report, device="mobile")
    assert report["excluded"]["tablet"] == 35
    assert m["samples"] == 29
    assert m["verdict"] == g.INSUFFICIENT
    # The 30th phone sample makes it judged; the iPads still do not move the p75.
    report = g.evaluate(rows + [row(800, ua=IPHONE)], NOW)
    m = cell(report, device="mobile")
    assert (m["samples"], m["p75_ms"], m["verdict"]) == (30, 800, g.PASS)
    assert cell(report, device="desktop")["samples"] == 0


def test_android_tablets_are_excluded_from_mobile():
    rows = ([row(800, ua=MOBILE) for _ in range(30)]
            + [row(9000, ua=ua) for ua in (ANDROID_TABLET_CHROME, ANDROID_TABLET_FIREFOX) * 10])
    report = g.evaluate(rows, NOW)
    assert report["excluded"]["tablet"] == 20
    assert cell(report, device="mobile")["samples"] == 30
    assert cell(report, device="mobile")["p75_ms"] == 800


# Codex round 1 on fe41ebc23 (PRRT_kwDOR6Uds86xBN6g): the WARN fires only when
# the nearest-rank p75 sample is itself an outlier, i.e. more than
# n - ceil(0.75 n) samples are above OUTLIER_LCP_MS.
def test_quarter_outliers_at_n_divisible_by_4_do_not_set_p75():
    report = g.evaluate([row(800) for _ in range(30)] + [row(185_000) for _ in range(10)], NOW)
    c = cell(report)
    assert (c["samples"], c["p75_ms"], c["verdict"], c["over_60s"]) == (40, 800, g.PASS, 10)
    assert not g.outliers_decide_p75(c)
    assert "WARN" not in g.render(report)


def test_one_more_outlier_at_n_41_sets_p75():
    report = g.evaluate([row(800) for _ in range(30)] + [row(185_000) for _ in range(11)], NOW)
    c = cell(report)
    assert (c["samples"], c["p75_ms"], c["verdict"], c["over_60s"]) == (41, 185_000, g.FAIL, 11)
    assert g.outliers_decide_p75(c)
    assert "WARN\t/grammar\tdesktop\t11/41" in g.render(report)


@pytest.mark.parametrize("n", range(30, 50))
def test_outlier_warning_matches_the_nearest_rank_sample(n):
    for k in range(n + 1):
        c = cell(g.evaluate([row(800) for _ in range(n - k)] + [row(185_000) for _ in range(k)], NOW))
        assert g.outliers_decide_p75(c) == (c["p75_ms"] > g.OUTLIER_LCP_MS), (n, k)


def test_outlier_threshold_is_strict_and_survives_p75_rounding():
    at = cell(g.evaluate([row(800) for _ in range(22)] + [row(60_000) for _ in range(8)], NOW))
    assert at["over_60s"] == 0 and not g.outliers_decide_p75(at)
    # 60000.0004 ms rounds to a 60000 ms p75 but is still above the threshold.
    above = cell(g.evaluate([row(800) for _ in range(22)] + [row(60_000.0004) for _ in range(8)], NOW))
    assert above["over_60s"] == 8 and above["p75_ms"] == 60_000
    assert g.outliers_decide_p75(above)
