# Cluster 20.x Reading — Governance (Observation Phase)

**Effective:** 2026-05-29 (cluster close)
**Status:** Active rules for the reading module in **observation phase**
**Companion doc:** `retrospective.md` (what happened); this doc covers **what governs the module going forward**.

> The reading module is in observation. The everyday operators are
> Andy + the content-production agent, not Code/Codex. These rules
> keep the module's quality bar in place while feature work moves
> elsewhere.

---

## 1. Authority map

| Decision | Authority | Override path |
|---|---|---|
| What content ships to students (`status='published'`) | **Andy** | None — Andy is final reviewer |
| Content YAML shape (frontmatter, question structure) | **`reading_content_format_v2.md`** | New major version (v3) |
| Validator rules | **Code** (PF) | Spec change + matching validator change in one PR |
| Question-type catalogue (Phase 1 vs Phase B) | **`reading_content_format_v2.md §4.2`** | Phase B unlock is its own sprint |
| Skill-tag enum (D2) | **Frozen at 8 values** | Diagnostic rollups depend on it; change = cluster-level decision |
| Band table (Academic) | **Cambridge IELTS Official Guide** | None — external authority |
| Band table (General Training) | **Phase B** | When GT content production starts |
| Exam chrome fidelity (BC/IDP institutional) | **Andy approval gate** | Code may flag deviations; Andy approves explicitly |
| Diagnostic recommendation rules | **`reading_diagnostic_engine.py`** | PF code-authoritative; small changes can ship without ceremony |

---

## 2. Content-production workflow (the rule)

Every new content file follows this exact sequence. **No exceptions.**

1. **Author** writes a `.md` file against `reading_content_format_v2.md`
   (FLAT question shape, §4).
2. **Dry-run** first. Always.
   `POST /admin/reading/content/import?dry_run=true` with the file.
   Inspect `validation_errors`. Fix every error. Re-dry-run. Loop until
   `validation_errors: []`.
3. **Manual sanity-check** the parsed-data preview the admin page renders
   (passages titles, question counts, glossary entries). Catch
   content-level issues (wrong primary answer, misnumbered q_nums) that
   a structural validator can't catch.
4. **Commit** with `dry_run=false`. Action `created` or `updated`;
   `committed_id` returned.
5. **Verify in production** — open the student surface for the new content
   slug (`/pages/reading-vocab.html?slug=…` for L1, `/pages/reading-skill.html?slug=…`
   for L2, `/pages/reading-test.html?test_id=…` for L3). Confirm
   it renders + grades a sample answer.

> **Re-import safety:** every re-upload of the same `slug` (L1/L2) or
> `test_id` (L3) is idempotent. The per-passage `reading_questions` set
> is deleted-then-reinserted, **and (Sprint 20.9 D1) the L3 importer
> reconciles passages removed from the source file — orphan passage rows
> and their cascaded questions are deleted before the new passages are
> upserted.** `response.removed_passage_slugs` surfaces what was cleaned.
> So "the file is the truth" holds. There is no "draft → published"
> promotion separate from re-import — the `published:` flag in frontmatter
> is the toggle. The import sequence is not fully transactional; see
> `reading_content_format_v2.md` §10 quirk #8 and §11/P1-4 for the
> residual partial-write risk.

---

## 3. Draft vs Published policy

- A file with `published: false` (default) imports as `status='draft'`.
  **Student endpoints filter `status='published'`** — drafts are admin-only.
- A file with `published: true` imports as `status='published'` — students
  see it immediately on the next page load.
- **There is no review queue.** The author + Andy are the same person
  in observation phase; for the content-production agent, Andy is the
  reviewer at step 3 of §2.
- If a published file needs to be hidden, set `published: false` in the
  source file and re-import. The row stays in the DB (no orphan) but
  drops out of student listings on the same request.

---

## 4. Validator-enforcement discipline (the F1/F2 lesson)

**Rule:** any structural claim in `reading_content_format_v2.md` must
have a matching validator check, OR be explicitly listed under "Known
importer quirks" (§10) as an unenforced documented behaviour.

When updating the spec, follow this checklist:
- New required field? → Add a validation rule in `validate_reading_passage`
  / `validate_reading_test` / `validate_reading_questions`. Add an error
  message that quotes the spec section.
- New enum value? → Add to the appropriate tuple in
  `services/content_import_service.py`. Update spec §1.
- New optional field? → No validator change needed. Document in spec.
- Loosening a rule? → Match the validator and the spec **in the same PR**.
- Tightening a rule? → Surface as a "silent → loud" change (existing
  content may now fail; document migration path).

**Tests are non-negotiable.** Every validator-rule change ships with a
regression test in `test_reading_validator_f1_f2.py` (or successor)
that covers the reject path AND the accept path.

---

## 5. Test discipline (the full-chain rule)

When adding or modifying a content type, the seed/example regression
test must round-trip through **every** stage:

```
parse → validate → build → consume (collect_answer_key → grade_attempt
                                    OR render)
```

Stopping at `parse + validate` was the F1 escape route in Sprint 20.5.
The template lives at `test_reading_validator_f1_f2.py::test_corrected_l3_seed_builds_and_grades_correctly`
(L3) and `test_reading_content_format_v2_examples.py` (L1/L2/L3 examples).
Copy that pattern when adding new seeds.

For the live HTTP route chain (import → admin list → student detail →
start → patch → submit → diagnostic) the template is
`test_reading_live_route_integration.py` (Sprint 20.9 D6, closing audit
P2-4). Any change that touches more than one of those routes should
verify the chain still hangs together end-to-end.

---

## 5b. Integrity-invariant discipline (Sprint 20.9 audit closure)

The cluster docs used to claim several integrity guarantees ("≤1 active
attempt per user+test", "PATCH is idempotent per q_num", "fully overwrites
on re-import") that were enforced only by application convention, not by
the database or by tests. The Codex audit surfaced this docs-vs-code gap
as a generalisation of the F1/F2 lesson family: **a doc claim without a
matching enforcement is a fragile invariant**.

Going forward, every integrity claim added to retrospective, governance,
or the spec must satisfy at least one of:

1. **DB-level enforcement** — partial unique index, PK constraint, CHECK,
   FK, or trigger. The migration ships in the same PR as the doc.
2. **Test-level enforcement** — a regression test that would fail loudly
   if the invariant were violated. The test ships in the same PR.
3. **Explicit "unenforced quirk" labelling** — listed under
   `reading_content_format_v2.md` §10 with the residual risk named.

Concrete invariants currently enforced this way (post-20.9):

| Invariant | Enforced by | Test |
|---|---|---|
| ≤1 in_progress attempt per (user, test) | Partial unique index in mig 088 + router retry | `test_d2_start_retries_on_unique_violation_until_insert_succeeds` |
| PATCH /answers is atomic per q_num | PK upsert on (attempt_id, q_num) in mig 088 | `test_d3_patch_two_different_qnums_each_upserts_independently` |
| L3 re-import deletes removed passages | Reconciliation step in `_import_l3_full_test` | `test_d1_l3_reimport_deletes_passage_removed_from_source` |
| Submit fails closed on bad started_at | Router 422 path | `test_d4_submit_fails_closed_on_unparseable_started_at` |
| Diagnostic thresholds (60/75) | Hard-coded constants | `test_d5_diagnostic_level_at_exact_boundary_{59,60,74,75}` |

Anti-pattern (what the audit caught): writing "the system guarantees X"
in the retrospective without a corresponding constraint or test that
breaks if X fails. Don't do this again.

---

## 6. Phase B gates (deferred items)

Each gate is opened by a deliberate sprint, not by quiet incremental work.

| Gate | What it unlocks | Sprint trigger |
|---|---|---|
| **`mcq_multi` + matching family + flow_chart + diagram_label** | Full IELTS question-type catalogue | When the renderer + grader can handle list-valued answers and complex template structures |
| **General Training module + band table** | GT content production | When the first GT content batch is queued |
| **L2 attempt persistence** | Per-skill longitudinal tracking; completion-aware diagnostic | When the diagnostic engine needs L2 history |
| **Admin delete endpoint** | Non-engineer row deletion | When SQL-based delete becomes painful |
| **"All" filter excludes L3 passages** | Cleaner unfiltered admin list | When reviewers report confusion |
| **CSS rename `reading-exam-mockup.css` → `reading-exam-chrome.css`** | Filename hygiene | Next cluster touching exam chrome |

**Anti-pattern:** opening a gate as a "while we're here" side-task in
an unrelated PR. Each gate is its own merge so the change is auditable.

---

## 7. Observation-phase change procedure

For any non-trivial change to the reading module during observation:

1. **Is this a re-open trigger** named in §6 or `retrospective.md §4`?
   - Yes → it's a sprint. Open a commission. Don't side-quest.
   - No → continue.
2. **Is this a bug fix?** (regression, wrong behaviour against the spec)
   - Yes → small surgical PR, focused on the bug, with a regression test.
   - No → continue.
3. **Is this content production?**
   - Yes → §2 workflow. No code change should be needed.
   - No → continue.
4. **Otherwise**: stop. If it doesn't fit (1)–(3), it probably needs a
   discovery sprint, not a fix.

---

## 8. What's NOT governed by this doc

- Listening module (cluster 13.x). Reuses some shared infrastructure
  (e.g. `answer_matches`) but is its own cluster.
- Writing module (cluster 19.x). Shares the markdown-frontmatter importer
  base but uses a separate spec (`docs/clusters/19_x/content_format_v1.md`).
- Cluster 21.x Grammar. Adjacent cluster with its own retrospective +
  governance.
- The admin chrome component (`aver-admin-chrome.js`). Cross-cluster
  infrastructure; reading consumes it, doesn't own it.

---

**Governance applies until the next reading-module sprint or the
adoption of a v3 spec, whichever comes first.**
