import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE = readFileSync(path.join(FRONTEND, 'components', 'chrome-navigation-bridge.tsx'), 'utf8');
const LAYOUT = readFileSync(path.join(FRONTEND, 'app', 'layout.tsx'), 'utf8');

test('root installs one App Router owner for student and admin Shadow DOM chrome', () => {
  assert.match(LAYOUT, /<ChromeNavigationBridge \/>/);
  assert.match(BRIDGE, /useRouter\(\)/);
  assert.match(BRIDGE, /aver-chrome, aver-admin-chrome/);
  assert.match(BRIDGE, /customElements\.whenDefined\(tag\)/);
  assert.match(BRIDGE, /new MutationObserver\(reconcile\)/);
  assert.match(BRIDGE, /router\.push\(href\)/);
  assert.match(BRIDGE, /router\.prefetch/);
});

test('bridge preserves native browser semantics outside ordinary internal clicks', () => {
  assert.match(BRIDGE, /event\.button !== 0/);
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.match(BRIDGE, new RegExp(`event\\.${modifier}`));
  }
  assert.match(BRIDGE, /anchor\.hasAttribute\('download'\)/);
  assert.match(BRIDGE, /target && target !== '_self'/);
  assert.match(BRIDGE, /url\.origin !== window\.location\.origin/);
  assert.match(BRIDGE, /url\.hash\) return null/);
  assert.match(BRIDGE, /event\.defaultPrevented/);
});
