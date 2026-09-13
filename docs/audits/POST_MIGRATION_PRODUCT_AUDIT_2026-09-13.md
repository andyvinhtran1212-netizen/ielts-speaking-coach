# Post-migration product audit — 2026-09-13

## Scope and conclusion

Audit covered the FastAPI backend, Next App Router frontend, shared UI system,
release controls and hosted migration ledgers after Gate F closure. No Critical
finding was confirmed. The Next.js migration remains complete; the changes in
this remediation address post-migration product hardening rather than reopening
Gate E or Gate F.

## Confirmed findings and remediation

| Severity | Root cause | Minimal remediation | Verification |
|---|---|---|---|
| Medium | Public analytics accepted unbounded names and nested metadata. | Bound body size, event/session identifiers, JSON depth/node/string count and per-worker rate. | Backend analytics/request-safety tests. |
| Medium | Error context could persist capability query values and unbounded concrete URLs. | Log the Starlette route template and redact sensitive query keys. | Secret/capability non-leak tests. |
| Medium | Grading providers and fallback chain had no hard total deadline. | Add per-provider deadlines, a total orchestration deadline and explicit SDK timeouts. | Orchestrator/provider timeout tests. |
| Medium | Admin Listening and Reading Preview exposed retired HTML rollback CTAs that redirected back to Next or a missing artifact. | Remove watchdog scripts, rollback CTAs and unused rollback helpers. | Source scan plus Admin Listening/Reading contract tests. |
| Medium | Third-party runtime CDN scripts had no integrity boundary and conflicted with a strict CSP. | Pin npm dependencies and copy their browser bundles to `/vendor` at build time; fallback retries same-origin. | Production build, dependency audit and runtime-order contracts. |
| Medium | Core exam dialogs lacked a complete keyboard focus lifecycle. | Add shared initial focus, Tab trap, Escape, scroll lock and focus restoration. | TypeScript build and dialog source contracts. |
| Medium | Mobile exam palette/actions were below a 44px target. | Enforce 44px controls at narrow breakpoints. | CSS contract and viewport inspection. |
| Medium | Secondary text tokens were too faint for small operational copy. | Raise light/dark muted and faint token opacity. | Contrast calculations and token contracts. |
| Low | App-wide errors/404 used framework defaults. | Add branded route, global and not-found boundaries. | 137-route production build. |
| Low | Shared learner/admin navigation had no skip link and used redirected URLs. | Add first-focus skip links and canonical `/profile`, `/instructor`, `/` targets. | Chrome contract tests. |
| Low | Reduced-motion did not disable several decorative animations. | Add targeted `prefers-reduced-motion` overrides. | CSS source checks. |
| Low | `/next-probe` and `/recorder-spike` were visible production pages. | Return not-found for every production deployment (with `main` as a second fail-closed signal) and noindex the probe. | Production-mode build plus route source contract. |
| Low | `/health` still advertised `phase-d-wave-2`. | Read `APP_VERSION`, defaulting to `next`. | Health route tests. |

## Validated non-findings

- Central HTTP exception sanitization already prevents raw 5xx details from
  reaching clients; route-by-route rewrites were not necessary.
- App Router ownership compiled without route collision across 137 routes.
- Production public tables had RLS enabled and audited privileged RPCs retained
  their grants/search-path hardening.
- The 129 retired HTML files remain fixtures outside `public/`; they are not
  deployable rollback renderers.

## Verification record

- Backend: `7912 passed, 308 skipped`.
- Frontend: production-mode `next build` completed all 137 routes; the full
  frontend CI contract gate and legacy TypeScript drift check passed.
- Directly affected frontend contracts: 266 passed, followed by 13 focused
  self-review contracts after the final patches.
- Writing admission browser contract: 27 fixture-backed scenarios passed after
  moving the harness to same-origin vendor assets.
- Runtime dependencies: `npm audit --omit=dev` reports 0 vulnerabilities after
  pinning DOMPurify 3.4.15.
- Repository diff: `git diff --check` clean.

## Open operational item (not a Next migration blocker)

Read-only ledger comparison found staging missing rows 240–257 and 259–260,
and production missing 233–244 and 247–256. Exact hosted checks split them into
two classes:

- possible ledger-only reconciliation after full fingerprint verification:
  production 233; staging 245, 246, 257, 259 and 260;
- genuinely absent optional schema: production 234–244 and 247–256; staging
  240–244 and 247–256.

Do not blanket-baseline or blindly replay these files. Migration 233/246 DML
must not be replayed, and 259 must never be replayed without 260. The optional
groups require a product decision to retain-and-apply sequentially with flags
off, or retire from the forward queue. Any hosted ledger write remains a
separately approved operation under the shared advisory lock.
