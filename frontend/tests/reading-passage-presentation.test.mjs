import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { formatReadingPassage } from '../lib/reading-passage-presentation.mjs';

const document = new JSDOM('').window.document;
const render = (html) => {
  const element = document.createElement('div');
  element.innerHTML = formatReadingPassage(html, document);
  return element;
};
const lead = 'An introductory description of the collection and the people who assembled it over many years before giving it to the public.';

test('separates a joined standfirst without changing any authored text', () => {
  const html = `<p><em>${lead}</em> The opening paragraph.</p><p>More prose.</p>`;
  const before = document.createElement('div'); before.innerHTML = html;
  const after = render(html);
  assert.equal(after.textContent, before.textContent);
  assert.equal(after.querySelector('.reading-next-standfirst').textContent, lead);
  assert.equal(after.querySelector('.reading-next-standfirst + p').textContent.trim(), 'The opening paragraph.');
  assert.equal(formatReadingPassage(after.innerHTML, document), after.innerHTML);
});

test('keeps short emphasis inline and styles a standalone standfirst', () => {
  assert.equal(render('<p><em>A title</em> appears in this sentence.</p>').children.length, 1);
  assert.equal(render('<p><em>A title</em> appears in this sentence.</p>').querySelector('.reading-next-standfirst'), null);
  assert.equal(render(`<p><em>${lead}</em></p>`).querySelectorAll('.reading-next-standfirst').length, 1);
});

test('styles sequential paragraph labels, including already-bold labels, exactly once', () => {
  const html = '<p>A First paragraph.</p><p><strong>B</strong> Second paragraph.</p><p>C Third paragraph.</p>';
  const after = render(html);
  assert.deepEqual([...after.querySelectorAll('.reading-next-paragraph-label')].map(el => el.textContent), ['A', 'B', 'C']);
  assert.equal(after.textContent, 'A First paragraph.B Second paragraph.C Third paragraph.');
  assert.equal(formatReadingPassage(after.innerHTML, document), after.innerHTML);
});

test('does not mistake the article A or nonsequential text for paragraph labels', () => {
  assert.equal(render('<p>A collection opened.</p><p>Visitors attended.</p>').querySelector('.reading-next-paragraph-label'), null);
  assert.equal(render('<p>A collection.</p><p>C is a name.</p>').querySelector('.reading-next-paragraph-label'), null);
});
