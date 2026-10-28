// U-09 — landing links: the logo goes home (it was a dead `#`), and the footer
// "Trang chủ" link no longer sends anonymous visitors to the sign-in-gated
// /home. /signup → /login is pinned in section-index-redirects.test.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = readFileSync(path.join(FRONTEND, 'app', '(marketing)', 'page.tsx'), 'utf8');
const hrefs = (markup) => [...markup.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

test('header logo links to the landing root', () => {
  assert.match(PAGE, /<Link href="\/" className="ix-logo flex items-center gap-2">/);
});

test('landing has no dead `#` links', () => {
  assert.ok(!hrefs(PAGE).includes('#'), 'href="#" goes nowhere');
});

test('footer links only to public destinations', () => {
  const footer = PAGE.match(/<footer[\s\S]*?<\/footer>/)?.[0];
  assert.ok(footer, 'footer present');
  const links = hrefs(footer);
  assert.ok(links.length > 0);
  for (const href of links) {
    assert.ok(['/', '/login', '/grammar'].includes(href) || href.startsWith('#'),
      `footer link ${href} is not a public landing destination`);
  }
  assert.match(footer, /<Link href="\/" className="ix-footer__link text-sm">\s*Trang chủ\s*<\/Link>/);
});
