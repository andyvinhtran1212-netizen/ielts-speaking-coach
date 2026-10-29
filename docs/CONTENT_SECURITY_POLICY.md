# Content-Security-Policy (F08 / BL-07)

Current runbook for the `Content-Security-Policy` header on every Next
response. The policy is built by `frontend/tooling/content-security-policy.mjs`
and attached in `frontend/next.config.ts` `headers()`. The staging-only nonce
enforcement option replaces that header in `frontend/proxy.ts` on signed-in
routes; see [step 2](#enforced-nonce-on-staging-sec-csp-nonce-step-2-pc-j221).
`frontend/vercel.json`
sets no headers. Tests: `frontend/tests/post-migration-security-headers.test.mjs`.

Next compiles `headers()` into the build output, so the policy is fixed per
build by the build environment (`VERCEL_ENV`, `AVER_*`, `NODE_ENV`). It is not
evaluated per request.

A second, non-blocking header — `Content-Security-Policy-Report-Only` with a
per-request nonce — is added on the signed-in routes of non-production builds
when enforcement is off.
See [Report-Only nonce policy](#report-only-nonce-policy-sec-csp-nonce-step-1).

## Directives

| Directive | Production | Staging / PR preview (`VERCEL_ENV=preview`) |
| --- | --- | --- |
| `default-src` | `'self'` | same |
| `base-uri`, `form-action` | `'self'` | same |
| `object-src` | `'none'` | same |
| `frame-ancestors` | `'none'`; `'self'` for the embeddable exam/Writing workspaces in `EMBEDDABLE_SAME_ORIGIN_ROUTES` | same |
| `script-src` | `'self' 'unsafe-inline'` | adds `https://vercel.live` |
| `style-src` | `'self' 'unsafe-inline' https://fonts.googleapis.com` | adds `https://vercel.live` |
| `font-src` | `'self' data: https://fonts.gstatic.com` | adds `https://vercel.live https://assets.vercel.com` |
| `img-src` | `'self' data: blob: https:` | same (this also covers the toolbar's `vercel.live` / `vercel.com` images) |
| `media-src` | `'self' blob: https:` | same |
| `connect-src` | `'self'`, the production API, the production Supabase project | `'self'`, the staging API, the staging Supabase project, `https://vercel.live`, `wss://ws-us3.pusher.com` |
| `frame-src` | not set (falls back to `default-src 'self'`) | `'self' https://vercel.live` |

`'unsafe-eval'` is added only under `next dev` (`NODE_ENV=development`).

### connect-src

The API and Supabase origins come from `frontend/tooling/runtime-origins.mjs`.
`generate-runtime-config.mjs` uses the same resolution to write
`runtime-config.js`, so the origins the browser is told to call and the origins
it is allowed to call cannot drift apart. `AVER_API_BASE` and
`AVER_SUPABASE_URL` overrides apply to both.

Before this change the policy was `connect-src 'self' https: wss:`, which let the
browser connect to any HTTPS or WSS host. An injected script could therefore
send data to any server.

The browser makes no direct AI calls. Whisper STT, Claude, Gemini, Azure Speech,
ElevenLabs/OpenAI/Kokoro TTS and LanguageTool are all called by FastAPI. Audio
and images reach the browser as Supabase Storage signed URLs or API responses.
Downloads that use `fetch(signedUrl)` go to the Supabase origin, which is
already allowed. If a new browser-side integration needs a third-party origin,
add it to the builder and add a test for it. Do not restore `https:`.

Fail-closed rules:

- A Vercel build throws if a configured API or Supabase value is not a valid
  `https://` URL. The build fails loudly; an origin is never dropped silently.
  Vercel deployments are only `preview` or `production`; both stay https-only.
- Loopback `http://127.0.0.1|localhost` origins are accepted only on a local
  machine: with no `VERCEL_ENV`, or with `VERCEL_ENV=development`, which the
  README local setup and the agent launcher export together with
  `AVER_API_BASE=http://localhost:8000`. That development policy lists the
  exact loopback API and stays narrow (no `https:`/`wss:`). Any other `http:`
  host still throws.
- `AVER_ENVIRONMENT=test` widens `connect-src` to `https: wss:` (plus a local
  `http://127.0.0.1|localhost` API) **only when `VERCEL_ENV` is unset**. The
  local browser verifiers replace `runtime-config.js` with fixture origins such
  as `https://api.login-fixture.invalid`. The browser checks CSP before
  Playwright can intercept a request, so a narrow policy would block every
  fixture call.
- Local builds with no configuration (no `VERCEL_ENV`) keep the legacy browser
  behaviour: `http://localhost:8000` or the production API, plus the production
  Supabase project hardcoded in legacy page scripts.

## Vercel Toolbar (BL-07)

Vercel injects its toolbar/comments script on preview deployments, including the
`staging.averlearning.com` alias. The old policy blocked it, which caused
`Loading the script 'https://vercel.live/_next-live/feedback/feedback.js'
violates … script-src` console errors on `/login` and other pages. Non-production
Vercel builds now allow exactly the sources Vercel documents. Production builds
never mention `vercel.live`.

Staging E2E still isolates the application from the toolbar: `installToolbarSkip`
in `frontend/tests/staging-e2e/helpers.js` sends `x-vercel-skip-toolbar`,
replaces `https://vercel.live/_next-live/**` with an empty script, and removes
`<vercel-live-feedback>` before hydration.

Alternative: if staging reviewers do not need comments, turn the toolbar off for
Preview in the Vercel project settings, or set `VERCEL_PREVIEW_FEEDBACK_ENABLED=0`
for the branch. The preview allowance can then be removed from the builder.
Either change is a Vercel dashboard setting, not a repository change.

## Why `'unsafe-inline'` remains (script-src and style-src)

We assessed removing it and found it not feasible without breakage or a change
in architecture:

1. **App Router inline bootstrap.** Every App Router HTML response streams
   inline `<script>self.__next_f.push(…)</script>` RSC payload chunks, and their
   content differs per page and per request. Hashes cannot cover them. Next's
   only supported strict option is a per-request nonce from `proxy`/middleware.
   With nonces, every page must be rendered dynamically. That conflicts with
   `cacheComponents` and the statically cached public content (ADR-008, Grammar
   Wiki and landing), and it would change which pages return a real 404 (the
   U-03 soft-404 constraint). This is an architecture change, not a header fix.
2. **Inline styles.** React `style={…}` props render as `style=""` attributes in
   SSR HTML, and the design system and legacy `public/js` modules set inline
   styles widely. Removing `'unsafe-inline'` from `style-src` would remove that
   styling.
3. **Legacy inline handlers.** These were removed in PC-J38: the
   `on…="…"` attributes in `practice.js`, `grammar.js`, `kp-roadmap.js` and
   `admin-listening-tests-detail.js` are now `addEventListener` listeners, and
   `frontend/tests/csp-nonce-report-only.test.mjs` fails if one comes back in
   `frontend/public/js`.

Controls that limit the remaining risk: `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, `frame-ancestors 'none'`. The narrow `connect-src` blocks
data exfiltration through `fetch`/XHR/WebSocket. Markdown and HTML renderers
that use DOMPurify keep sanitising their output; this policy does not replace
them.

Signed-in non-production routes support the Report-Only trial and the opt-in
enforced nonce policy below. Public routes retain the baseline above.

## Report-Only nonce policy (SEC-CSP-NONCE step 1)

PC-J38 / SEC-20261028-05. With enforcement off, the blocking header above is
unchanged. On the signed-in routes, `frontend/proxy.ts` also sends:

```
Content-Security-Policy-Report-Only: script-src 'self' 'nonce-<per request>' 'strict-dynamic' 'unsafe-inline'
```

- **Scope.** The routes of every layout that renders `AuthedShell` (learner,
  admin and instructor groups: 75 layouts, 141 page routes). The proxy matcher
  lists their URL prefixes; `/vocabulary` itself is public and excluded, its
  signed-in subroutes are included. Public routes (`/`, `/login`, `/grammar`,
  `/vocabulary`, `/pricing`) get no Report-Only header and stay static.
- **Only `script-src`.** Every other directive is already enforced identically
  by the blocking header, so repeating it would only report the same thing
  twice. `'unsafe-inline'` is the CSP2 fallback; browsers that honour the nonce
  ignore it.
- **How the nonce reaches the page.** The proxy generates 16 random bytes,
  sets the `content-security-policy-report-only` and `x-nonce` request headers,
  and deletes any client-sent `content-security-policy` request header. Next
  reads the nonce from that request header and stamps its own bootstrap, chunk
  and RSC scripts — on `next start`, but **not on Vercel** (see the known gap
  below). `AuthedShell` reads `x-nonce` for its two inline scripts
  (anti-flash theme and body class). `next/script` (`afterInteractive`) and the
  runtime script chain are inserted by trusted code, which `'strict-dynamic'`
  allows.
- **Cost: these routes render per request.** A nonce cannot be part of
  prerendered HTML, so reading it makes the route dynamic. Under
  `cacheComponents`, that requires `export const instant = false` in each
  `AuthedShell` layout; a `<Suspense>` boundary would leave a prerendered shell
  without the nonce. `next build` route table with the flag off is identical
  to before (119 `○`, 40 `◐`, 2 `ƒ`); with it on: 12 `○`, 23 `◐`, 126 `ƒ`.
  The remaining `◐` rows are public pages and the fallback rows of dynamic
  segments.
- **Flag.** `AVER_CSP_NONCE_REPORT_ONLY=1|0` at build time. Unset means on for
  every build except a Vercel production build, i.e. on for staging and PR
  previews, off for production. `next.config.ts` resolves it once and inlines
  it (`env`), so the proxy and `AuthedShell` cannot disagree at runtime.
  Production hosts (`averlearning.com`, `www.averlearning.com`) are also
  excluded in the proxy matcher, so production requests never take a proxy
  hop for this.
- **Reports.** There is no report endpoint (no `report-to`/`report-uri`).
  Violations appear in the browser console as `[Report Only]` and as
  `securitypolicyviolation` events. Probably seen on staging (not verifiable
  locally): the Vercel toolbar script that preview deployments inject without
  a nonce.
- **Evidence.** `frontend/tooling/verify-csp-nonce-report-only-flow.mjs` (CI
  Next-native job, CSP not bypassed): both headers, every served `<script>`
  carries the request nonce, 0 Report-Only violations on the login, Speaking,
  practice, Writing result, admin, admin grade, instructor, profile, vocabulary
  and listening routes and on the Grammar Wiki, an injected `<img onerror>` is
  reported (and still runs), a fresh nonce per request, and client-sent nonce
  headers are ignored.

### Known gap on Vercel (SA-1029-CSP1, PC-J145)

On a Vercel deployment only `AuthedShell`'s two inline scripts carry the
nonce. Next's own scripts do not: the `/_next/static/…` chunks, the bootstrap
`<script id="_R_">` and the inline `self.__next_f.push` flight scripts
(staging `c0370655c`, `/home`: 2 of 17 `<script>` tags). With
`'strict-dynamic'` the browser ignores `'self'` and `'unsafe-inline'`, so this
Report-Only policy reports Next's scripts and everything they load. It cannot
be enforced as it is.

- **Cause.** Under `cacheComponents` every page is partially prerendered, and
  no segment can opt out. These routes have an empty static shell
  (`.next/server/app/home.html` is 0 bytes; the prerender manifest says
  `compute: "blocking"`). Vercel serves that cached shell and renders the
  document in a resume request (`next-resume: 1`). That resume request
  carries the deployment's **response** headers as **request** headers. This
  includes the enforced `content-security-policy`, whether it comes from
  `next.config.ts` or from `proxy.ts`, and it replaces a proxy-set request
  value. Next reads the nonce from `content-security-policy` before
  `…-report-only` (`app-render.js` `parseRequestHeaders`). The enforced policy
  has no nonce, so Next uses none. `x-nonce` still arrives, which is why
  `AuthedShell`'s scripts match. `next start` does not do this, so the browser
  verifier passes locally.
- **`x-vercel-cache: HIT` is not a shared nonce.** HIT refers to the cached
  empty shell. The document and its nonce are rendered per request; two
  consecutive requests get two different nonces in the header and in the
  `AuthedShell` scripts. `Cache-Control` set by the proxy reaches the browser
  but does not change HIT.
- **What works.** A preview check (throwaway build, not staging) put the
  request nonce in the **enforced** header. Vercel then passes it to Next, and
  every `<script>` (17/17) carried it, with a fresh nonce per request even on
  HIT. Step 2 (enforcing a nonce policy) is therefore feasible on Vercel. A
  Report-Only trial next to a nonce-less enforced header is not: on Vercel it
  produces reports for Next's own scripts.
- **Check a deployment.** `node frontend/tooling/check-csp-nonce-deployed.mjs
  <origin>`, with `VERCEL_AUTOMATION_BYPASS_SECRET` set for Deployment
  Protection. It makes two GETs per signed-in route and checks that the
  nonces differ and that every `<script>` carries the header nonce. Today it
  fails on staging with enforcement off and passes on `next start`.

Step 2 below implements option A approved for staging. SA-1029-CSP1 remains
open until Security Auditor and UI Auditor pass their checks after Leader
enables it. Production requires separate owner approval and is locked out by
this implementation. Before enforcing it site-wide, the public layouts'
inline scripts (`(marketing)`, `(public-auth)`, `(public-content)`) need a nonce
or a hash; these static pages remain outside this rollout.

## Enforced nonce on staging (SEC-CSP-NONCE step 2, PC-J221)

`AVER_CSP_NONCE_ENFORCE=1|0` is a **build-time** flag, default **0**. It is
inlined through `next.config.ts`, alongside the existing render flag.
`nonceEnforceEnabled()` always returns false for `VERCEL_ENV=production`,
even when the new flag is `1`. Enabling enforcement also turns on the existing
AuthedShell request-time nonce read, even if `AVER_CSP_NONCE_REPORT_ONLY=0`.

The runtime host allowlist is `staging.averlearning.com`, `*.vercel.app`,
`localhost` and `127.0.0.1`. Other hosts receive no enforced nonce policy from
the proxy. The existing production-host matcher exclusion remains in place.
Public routes (`/`, `/login`, `/grammar`, `/vocabulary`, `/pricing`) retain
their original headers.

On the AuthedShell routes, the proxy generates 16 random bytes per request
and sends the full baseline policy with only `script-src` replaced:

```text
script-src 'self' 'nonce-<per request>' 'strict-dynamic' 'unsafe-inline' https://vercel.live
```

The toolbar source is included only for non-production Vercel environments;
local development also keeps `'unsafe-eval'`. All other directives and
configured API/Supabase origins stay the same. The existing embeddable route
allowlist retains `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`.

The policy is set on **both request and response**, and `x-nonce` carries the
same value to AuthedShell. Client-supplied blocking CSP, Report-Only CSP and
`x-nonce` cannot choose the nonce. Enforcement sends **no Report-Only header**
and adds no `report-to` or `report-uri` endpoint.

The proxy uses `headers.set`, replacing the static blocking policy from
`next.config.ts`; it must never append another policy. Multiple blocking
policies intersect in a browser and would break the trusted script chain.
The deployed checker rejects comma-combined policies as well as missing or
mismatched nonces. Verify raw header field count with curl on the branch
preview before merging.

| Build / route | Flag absent or `0` | Flag `1` |
| --- | --- | --- |
| Vercel Production, all routes | Original static blocking CSP | Identical; enforcement is hard-disabled |
| Preview, AuthedShell route on an allowed host | Original blocking CSP + existing nonce Report-Only trial | One full blocking CSP with fresh nonce; no Report-Only |
| Preview, public route | Original blocking CSP; no Report-Only | Identical |
| Enforcement build, unlisted host | N/A | No nonce policy added by proxy; static blocking CSP remains |

### Enable and verify

Only Leader sets `AVER_CSP_NONCE_ENFORCE=1` in the frontend Vercel project's
**Preview environment, branch `staging`**, then redeploys the current staging
release. Do not set or change the variable in Production. Record the enabling
time in UTC+7 and the deployment SHA.

Before that, test an enforcement-enabled preview of the feature branch:

```bash
node frontend/tooling/check-csp-nonce-deployed.mjs --enforced <preview-origin>
```

It makes two GETs each to `/home`, `/admin`, `/profile`, `/vocabulary/hub`:
every script must carry the blocking-header nonce and the nonce must change.
It also checks that the four public routes retain the original full blocking
policy and have no Report-Only header. Deployment Protection uses the
`VERCEL_AUTOMATION_BYPASS_SECRET` environment variable without printing it.
Use curl with that header supplied privately and count the raw
`Content-Security-Policy` lines: exactly one per response.

After staging enablement, SA checks these headers plus rejection of
client-supplied nonce headers. UIA checks the signed-in learner, admin and
instructor journeys, both themes at 360/1280 px, with zero CSP console errors.
Any QA login must finish with `signOut({ scope: 'local' })`.

### Quick rollback (Leader)

1. In Vercel's frontend project, **Preview environment, branch `staging`**,
   set `AVER_CSP_NONCE_ENFORCE=0` or remove it, then **Redeploy** the current
   staging release. A redeploy is required because the flag is inlined at build.
2. For an urgent revert, use Vercel **Instant Rollback / promote** to the
   preceding staging deployment. Keep this within Preview/staging.
3. Check `curl -sI https://staging.averlearning.com/home`, with the protection
   bypass header supplied privately: the blocking `script-src` must again be
   `'self' 'unsafe-inline' …`, with **no nonce**. The old Report-Only trial may
   remain and its known Vercel gap is expected. Do not print the bypass value.

Do not modify Production variables or promote this preview to Production.

## Verifying

- Unit: `node --test frontend/tests/post-migration-security-headers.test.mjs
  frontend/tests/csp-nonce-report-only.test.mjs
  frontend/tests/csp-nonce-enforce.test.mjs`.
- Build output: after `next build`, `.next/routes-manifest.json` → `headers[]`
  holds the compiled policy for the build environment.
- Browser smoke: on staging, open `/login`, `/`, `/grammar`, `/home` and
  `/practice` with DevTools open. There must be no `Content Security Policy`
  console reports and no `securitypolicyviolation` events. Check the response
  header with
  `curl -sI -H "x-vercel-protection-bypass: …" https://staging.averlearning.com/login | grep -i content-security`.
