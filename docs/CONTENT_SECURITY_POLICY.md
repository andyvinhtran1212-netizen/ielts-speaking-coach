# Content-Security-Policy (F08 / BL-07)

Current runbook for the `Content-Security-Policy` header on every Next
response. The policy is built by `frontend/tooling/content-security-policy.mjs`
and attached in `frontend/next.config.ts` `headers()`. `frontend/vercel.json`
sets no headers. Tests: `frontend/tests/post-migration-security-headers.test.mjs`.

Next compiles `headers()` into the build output, so the policy is fixed per
build by the build environment (`VERCEL_ENV`, `AVER_*`, `NODE_ENV`). It is not
evaluated per request.

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
3. **Legacy inline handlers.** A few `on…="…"` attribute handlers remain in
   `frontend/public/js` template strings (for example in `practice.js`,
   `grammar.js` and `kp-roadmap.js`), so `script-src-attr 'none'` would break
   them.

Controls that limit the remaining risk: `object-src 'none'`, `base-uri 'self'`,
`form-action 'self'`, `frame-ancestors 'none'`. The narrow `connect-src` blocks
data exfiltration through `fetch`/XHR/WebSocket. Markdown and HTML renderers
that use DOMPurify keep sanitising their output; this policy does not replace
them.

Follow-up if a nonce policy is approved later: add a `proxy.ts` that sets
`script-src 'nonce-…' 'strict-dynamic'`, measure the cost of rendering every
route dynamically, and remove the legacy inline handlers first.

## Verifying

- Unit: `node --test frontend/tests/post-migration-security-headers.test.mjs`.
- Build output: after `next build`, `.next/routes-manifest.json` → `headers[]`
  holds the compiled policy for the build environment.
- Browser smoke: on staging, open `/login`, `/`, `/grammar`, `/home` and
  `/practice` with DevTools open. There must be no `Content Security Policy`
  console reports and no `securitypolicyviolation` events. Check the response
  header with
  `curl -sI -H "x-vercel-protection-bypass: …" https://staging.averlearning.com/login | grep -i content-security`.
