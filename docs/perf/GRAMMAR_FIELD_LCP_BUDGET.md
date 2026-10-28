# /grammar LCP budget: field rule and lab fallback

Owner decisions, 2026-10-28:

- 12:44: the /grammar target is **real-user LCP p75 ≤ 2.5 s**. Lighthouse mobile
  becomes a trend metric.
- 14:05: the evaluation rule below, after q-97 found 7 days of prod data far too
  thin to judge (hub desktop n=5, mobile n=0).

## Field rule (applies to `/grammar` and `/grammar/*`)

| Item | Rule |
| --- | --- |
| Source | prod `analytics_events`, `event_name = 'web_vitals'`, numeric `event_data.lcp` |
| Window | rolling **28 days**, ending at the database's `now()` |
| Device classes | **desktop** and **mobile** judged separately, by UA (`Mobi\|Android\|iPhone\|iPod` = mobile). iPad/tablet and empty UAs are in neither class |
| Minimum | **≥ 30 samples per device class**. Below that the verdict is `INSUFFICIENT_DATA` and the lab budget applies |
| Verdict | p75 (nearest-rank, as `routers.error_logs._p75`) ≤ 2500 ms → `PASS`, otherwise `FAIL` |
| Page groups | `/grammar` (hub) and `/grammar/*` (category and article pages), each with its own per-device verdict |
| Excluded | crawlers and headless/automated browsers, matched by UA: `Headless`, `Lighthouse`, `PTST`, `Playwright`, `Puppeteer`, `Selenium`, `PhantomJS`, `bot`, `crawler`, `spider`, `slurp`, or any URL in the UA (self-identifying crawlers such as `+https://…`). They never count toward the 30 |
| De-duplication | one sample per `event_data.metric_id`, earliest kept |
| Synthetic traffic | **not added** to /grammar to reach the minimum (no `production-smoke.yml` runs on /grammar for this purpose) |

Samples with LCP above 60 s stay in the p75. When they are at least a quarter of a
judged cell they alone decide its nearest-rank p75, so the report prints a `WARN`
line. Check those samples for automated traffic the UA filter missed before acting
on the verdict. Example: on 2026-10-01/02 a single Linux Chrome/151 UA loaded every
article once, with LCP between 100 and 1,900 s.

## Running it

The rule is implemented in `backend/scripts/grammar_field_lcp.py` (stdlib only), and
`backend/tests/test_grammar_field_lcp.py` pins it.

```bash
# Read-only query via the Supabase Management API (needs SUPABASE_ACCESS_TOKEN).
python3 backend/scripts/grammar_field_lcp.py --project-ref <prod-ref>
python3 backend/scripts/grammar_field_lcp.py --project-ref <prod-ref> --json
# Rows exported earlier, or the SQL alone to run by hand:
python3 backend/scripts/grammar_field_lcp.py --rows rows.json
python3 backend/scripts/grammar_field_lcp.py --print-sql
```

Access is read-only. The request sets `read_only: true`, the SQL opens with
`SET TRANSACTION READ ONLY`, and the run is refused unless every returned row
carries `transaction_read_only = 'on'`.

The output has one `FIELD <verdict>` line per page group and device. Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | no judged `FAIL` |
| `1` | at least one judged `FAIL` |
| `2` | query or input error |

## Lab fallback

When a device class has `INSUFFICIENT_DATA`, the Lighthouse lab budget is the
signal. It is `LCP_ms ≤ 2500` for `/grammar` and `/grammar/*` in the ui-audit
`perf.sh` (`BUDGETS` in `/workspace/agent-tools/ui-audit/lib/perf.mjs`, staging,
outside git). It prints `BUDGET PASS|FAIL` lines and the no-emulation `noemu_*`
companion columns (q-97), and is report-only. q-73 showed that the Lighthouse
mobile emulation itself holds the /grammar first frame for about 1 s. A lab mobile
`FAIL` is therefore a trend signal, not proof that the field target is missed.
