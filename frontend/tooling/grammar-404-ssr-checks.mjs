// Served-HTML checks for the Grammar 404 (PC-J230, PC-J77 F1/F2), shared by
// tooling/verify-grammar-404-ssr-flow.mjs and the negative fixtures in
// tests/grammar-404-ssr-checks.test.mjs (PC-J235). Pure: no server, no I/O.
export const TOKENS = '/css/aver-design/tokens.css';

// One `{ ok, label }` per criterion, in the order the verifier prints them.
export function notFoundHtmlChecks(route, status, html) {
  const stylesheets = html.match(/<link rel="stylesheet"[^>]*>/g) || [];
  const tokenSheets = stylesheets.filter((tag) => tag.includes(`href="${TOKENS}"`));
  return [
    { ok: status === 404, label: `${route}: HTTP 404 (got ${status})` },
    { ok: !html.includes('__next_error__'), label: `${route}: served HTML is not the __next_error__ shell` },
    { ok: /<title>[^<]+<\/title>/.test(html), label: `${route}: served HTML has a <title>` },
    { ok: stylesheets.length >= 1, label: `${route}: served HTML links a stylesheet (${stylesheets.length})` },
    { ok: tokenSheets.length === 1, label: `${route}: tokens.css linked exactly once (${tokenSheets.length})` },
    { ok: /<meta name="robots" content="noindex/.test(html), label: `${route}: noindex` },
    {
      ok: /<h1[^>]*id="not-found-title"[^>]*>Trang này không còn ở đây<\/h1>/.test(html),
      label: `${route}: the Vietnamese 404 card is in the server HTML`,
    },
  ];
}

// The failed criteria only; `[]` means the served 404 is complete.
export function assessNotFoundHtml(route, status, html) {
  return notFoundHtmlChecks(route, status, html).filter((c) => !c.ok).map((c) => c.label);
}
