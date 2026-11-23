// G06-T14 (c2), LIBRARY-0061: the (public-content) layout no longer loads the
// old Grammar Wiki stylesheet; the article HTML and the learning panel are
// styled by CSS modules on the "Bản in" tokens instead.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GROUP = path.join(FRONTEND, 'app', '(public-content)');
const GRAMMAR = path.join(GROUP, 'grammar');
const read = (...parts) => readFileSync(path.join(...parts), 'utf8');
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const LAYOUT = read(GROUP, 'layout.tsx');
const ARTICLE = read(GRAMMAR, '[category]', '[slug]', 'page-shell.tsx');
const COMPARE = read(GRAMMAR, 'compare', 'page.tsx');
const HOME = read(GRAMMAR, 'page.tsx');
const MODE = read(GRAMMAR, 'grammar-home-mode.tsx');
const PROSE_CSS = read(GRAMMAR, 'article-prose.module.css');
const LEARNING_CSS = read(GRAMMAR, 'grammar-learning.module.css');

describe('grammar-wiki.css is retired from the layout (G06-T14 c2)', () => {
  test('the (public-content) layout loads no grammar-wiki.css', () => {
    assert.doesNotMatch(code(LAYOUT), /grammar-wiki\.css/);
  });

  test('article and compare wrap the authored HTML in the prose module', () => {
    for (const [name, source, rel] of [
      ['page-shell.tsx', ARTICLE, '../../article-prose.module.css'],
      ['compare/page.tsx', COMPARE, '../article-prose.module.css'],
    ]) {
      assert.ok(source.includes(`import prose from '${rel}'`), `${name} imports the prose module`);
      assert.match(source, /className=\{`article-body \$\{prose\.prose\}`\}/, `${name} keeps .article-body inside .prose`);
    }
  });

  test('the prose module reaches the Grammar Lab classes and keeps the anchor pulse', () => {
    for (const cls of ['gw-lab', 'gw-check-option', 'gw-repair-grid', 'gw-transfer', 'gw-takeaways', 'grammar-anchor-pulse']) {
      assert.ok(PROSE_CSS.includes(`.prose :global(.${cls}`), `.prose reaches .${cls}`);
    }
    assert.match(PROSE_CSS, /prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });

  test('learning mode and the ?category= view use the new modules', () => {
    assert.ok(MODE.includes("import s from './grammar-learning.module.css'"));
    assert.match(MODE, /role="status"/);
    assert.ok(HOME.includes("import learning from './grammar-learning.module.css'"));
    for (const id of ['category-view', 'category-view-title', 'category-view-list']) {
      assert.ok(HOME.includes(`id="${id}"`), `#${id} kept`);
    }
  });

  test('both modules use only av2 tokens: no raw colour, shadow or gradient', () => {
    for (const [name, css] of [['article-prose', PROSE_CSS], ['grammar-learning', LEARNING_CSS]]) {
      const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
      assert.doesNotMatch(body, /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/, `${name}: raw colour`);
      assert.doesNotMatch(body, /box-shadow|gradient\(/, `${name}: shadow or gradient`);
      // --av2-control-border is a colour: as a border width the declaration is
      // dropped and the button falls back to the browser's own border.
      assert.doesNotMatch(body, /border(?:-[a-z]+)?:\s*var\(--av2-control-border\)\s+solid/, `${name}: colour token used as a width`);
    }
  });
});
