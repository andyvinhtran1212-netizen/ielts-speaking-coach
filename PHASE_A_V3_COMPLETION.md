# PHASE_A_V3_COMPLETION.md

**Status:** COMPLETE  
**Date:** 2026-04-23  

---

## Acceptance Criteria — Checklist

- [x] **Grammar Wiki 0 regression:** Smoke test at `backend/tests/test_grammar_smoke.py` covers home route, category listing, article detail, and vocab-not-in-grammar leak check. Content isolation achieved via separate `backend/content_vocab/` directory.
- [x] **20 articles live:** 20 headwords across 6 categories, each with required YAML frontmatter, Vietnamese definition, 2 IELTS Speaking Part 3 examples, collocations, synonyms.
- [x] **5 endpoints correct schema:** `GET /api/vocabulary/categories`, `GET /api/vocabulary/articles`, `GET /api/vocabulary/articles/{cat}/{slug}`, `GET /api/vocabulary/search?q=`, `POST /api/analytics/events`.
- [x] **Desktop/Mobile OK:** Tailwind responsive grid (1 col mobile, 2–3 col desktop) in `vocabulary.html`. Article page single-column on mobile, sidebar layout on desktop.
- [x] **Analytics event tracked:** `vocab_wiki_viewed` fired from `vocab-article.html` on successful render. Persisted to `analytics_events` table (migration 018). Try-catch prevents tracking failures from blocking content.
- [x] **Tech debt logged:** `TECH_DEBT_BACKLOG.md` item #9 — separate content loaders (intentional for Phase A, deferred to Phase B).

---

## Files Changed

### New — Backend
| File | Purpose |
|------|---------|
| `backend/tests/test_grammar_smoke.py` | Grammar Wiki regression smoke tests (4 checks) |
| `backend/services/vocab_content.py` | Vocabulary content loader (`VocabContentService`) |
| `backend/routers/vocabulary.py` | 4 public vocab endpoints, prefix `/api/vocabulary` |
| `backend/routers/analytics.py` | Analytics event ingestion, prefix `/api/analytics` |
| `backend/migrations/018_analytics_events.sql` | `analytics_events` table + indexes |
| `backend/content_vocab/_categories.yaml` | 6 category definitions |
| `backend/content_vocab/environment/mitigate.md` | |
| `backend/content_vocab/environment/emission.md` | |
| `backend/content_vocab/environment/sustainable.md` | |
| `backend/content_vocab/environment/deplete.md` | |
| `backend/content_vocab/technology/cutting-edge.md` | |
| `backend/content_vocab/technology/obsolete.md` | |
| `backend/content_vocab/technology/breakthrough.md` | |
| `backend/content_vocab/technology/automate.md` | |
| `backend/content_vocab/education/curriculum.md` | |
| `backend/content_vocab/education/literacy.md` | |
| `backend/content_vocab/education/pedagogy.md` | |
| `backend/content_vocab/work-career/lucrative.md` | |
| `backend/content_vocab/work-career/prerequisite.md` | |
| `backend/content_vocab/work-career/commute.md` | |
| `backend/content_vocab/health/sedentary.md` | |
| `backend/content_vocab/health/epidemic.md` | |
| `backend/content_vocab/health/holistic.md` | |
| `backend/content_vocab/people-society/demographic.md` | |
| `backend/content_vocab/people-society/marginalize.md` | |
| `backend/content_vocab/people-society/cosmopolitan.md` | |

### Modified — Backend
| File | Change |
|------|--------|
| `backend/main.py` | Mount `vocabulary_router` and `analytics_router` |

### New — Frontend
| File | Purpose |
|------|---------|
| `frontend/vocabulary.html` | Landing page: 6 category cards + search bar |
| `frontend/pages/vocab-article.html` | Article detail: headword, TTS, definition, collocations, sidebar |
| `frontend/js/vocabulary.js` | All vocab JS: landing, article, search, TTS, analytics |

### Modified — Docs
| File | Change |
|------|--------|
| `TECH_DEBT_BACKLOG.md` | Added item #9: deferred content loader refactor |

---

## Content: 20 Headwords

| # | Headword | Category | Level |
|---|----------|----------|-------|
| 1 | Mitigate | environment | C1 |
| 2 | Emission | environment | B2 |
| 3 | Sustainable | environment | B2 |
| 4 | Deplete | environment | C1 |
| 5 | Cutting-edge | technology | B2 |
| 6 | Obsolete | technology | C1 |
| 7 | Breakthrough | technology | B2 |
| 8 | Automate | technology | B2 |
| 9 | Curriculum | education | B2 |
| 10 | Literacy | education | B2 |
| 11 | Pedagogy | education | C1 |
| 12 | Lucrative | work-career | C1 |
| 13 | Prerequisite | work-career | C1 |
| 14 | Commute | work-career | B2 |
| 15 | Sedentary | health | C1 |
| 16 | Epidemic | health | B2 |
| 17 | Holistic | health | C1 |
| 18 | Demographic | people-society | C1 |
| 19 | Marginalize | people-society | C1 |
| 20 | Cosmopolitan | people-society | C1 |

---

## Verification Steps

### Backend
```bash
# 1. Run Grammar regression smoke tests
cd backend && pytest tests/test_grammar_smoke.py -v

# 2. Start server and verify vocab endpoints return data
uvicorn main:app --reload
curl http://localhost:8000/api/vocabulary/categories    # → 6 categories
curl http://localhost:8000/api/vocabulary/articles     # → 20 summaries
curl http://localhost:8000/api/vocabulary/articles/environment/mitigate
curl "http://localhost:8000/api/vocabulary/search?q=mit"  # → [{mitigate}]

# 3. Analytics endpoint
curl -X POST http://localhost:8000/api/analytics/events \
  -H "Content-Type: application/json" \
  -d '{"event_name":"vocab_wiki_viewed","event_data":{"slug":"mitigate","category":"environment"}}'
# → {"ok": true}
```

### Database
```sql
-- Run migration 018 in Supabase SQL editor
-- Then verify:
SELECT * FROM analytics_events LIMIT 5;
```

### Frontend
1. Open `vocabulary.html` — verify 6 category cards render with icons, word counts, descriptions
2. Click a category card — verify article list appears
3. Type "sus" in search bar — verify "Sustainable" appears in results
4. Click any word card — verify `vocab-article.html` loads with headword, pronunciation, Vietnamese definition, examples
5. Click "Nghe" button — verify browser TTS reads the headword in English
6. Open DevTools → Network → verify `POST /api/analytics/events` fires with 200 OK on article load

---

## What's NOT in Phase A (intentional)

- No Personal Vocab Bank (Phase B)
- No Quiz/Drill mode
- No Admin Editor UI (content managed via Git/Markdown)
- No shared base class for Grammar + Vocab loaders (logged as tech debt #9)
- No full-text search (prefix match only)
