# Implementation plan

## Architecture impact

- Introduce a shared frontend Writing navigation model. Queue, Status, Grade,
  and Instructor Queue become consumers; the backend and database are unchanged.
- Keep `essay_id` and instructor view distinct from ordinary Queue filters.
  Do not use storage as a substitute for URL provenance.

## Data and contracts

- Queue URL fields: `status` or `mocklane`, `queue_status`, `cohort_id`,
  `overdue`, `q`, `embed`, `page`, `page_size` (25 default, 50 optional).
- Route provenance: `from=queue` or `from=instructor`; absent/invalid means
  direct entry. Only route-owned, validated parameters are forwarded. `id`
  remains an accepted legacy alias for incoming Grade/Status essay IDs, while
  generated links use `essay_id`.
- The URL defines the Queue page/size. A session Queue ID sequence is only an
  optional, account-scoped next-essay aid after Queue provenance is validated;
  it does not define filter state, essay identity, or return destination.
- This is frontend-only and backward-compatible with old links and backend
  versions. No migration or API change is needed.

## UI and interaction

- Use one normalized context for filter controls, page-size selector, backend
  limit/offset, route links, and return links. Search/filter/size changes reset
  page to 1; page navigation preserves size and filters.
- Preserve embedded Mock chrome behavior and the existing exact-versus-partial
  total distinction. Give direct Grade entries a truthful Writing workspace
  return, not a fabricated Queue origin.
- Check loading, empty, stale/error, retry, and permission returns at narrow,
  tablet, and desktop widths, both themes, keyboard focus, and reduced motion.

## Work decomposition

- T001: Shared parser, serializer, URL builders, normalization tests.
- T002: Queue URL-owned pagination and Status/Grade/Instructor integration.
- T003: Browser journeys, full affected suites, independent review.
- T004: Exact-SHA staging verification and, if authorized, promotion.

## Rollout and rollback

- Land this approved spec on staging before a separate implementation PR.
- Implementation starts from that staging SHA, incorporates the unmerged
  MOCKOPS-0006 implementation, and supersedes its old PR rather than adding a
  sixth review round there.
- No schema step is introduced by this navigation design. The parent Mock
  operations release still follows its staged migration and promotion gates.
- Revert the frontend implementation if navigation regresses; old links remain
  valid and no persisted state needs repair.

## Verification strategy

- Unit tests assert normalize/serialize/parse round trips for all fields,
  defaults, invalid values, source enum, legacy links, and URL encoding.
- Component/contract tests assert every source and return link uses the shared
  model, Queue fetch limit/offset matches URL, and session next is provenance-
  and account-scoped.
- Fixture browser flows cover 25/50 rows, page 2, filters, Status → Grade →
  save/return, reload, Back/Forward, Instructor return, direct links, and
  incomplete-total offset preservation.
- Run affected frontend tests, strict TypeScript, production build, the
  relevant Mock/Writing browser suites, then exact-SHA staging CI/E2E.
