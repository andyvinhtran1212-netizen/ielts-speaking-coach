// These helpers only annotate already sanitised Markdown. They never render raw HTML.
export function decorateGlossary(root, glossary) {
  const candidates = glossary.flatMap((entry, index) => [entry.term, ...(entry.aliases || [])]
    .filter(Boolean).map((term) => ({ term, index }))).sort((a, b) => b.term.length - a.term.length);
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) if (!walker.currentNode.parentElement?.closest('a,button,code,pre,script,style')) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const text = node.nodeValue || '';
    const lower = text.toLocaleLowerCase();
    const matches = [];
    for (const { term, index } of candidates) {
      const needle = term.toLocaleLowerCase();
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
        const end = at + needle.length;
        if ((at && /[\p{L}\p{N}]/u.test(text[at - 1])) || /[\p{L}\p{N}]/u.test(text[end] || '')) continue;
        if (!matches.some((match) => at < match.end && match.at < end)) matches.push({ at, end, index });
      }
    }
    if (!matches.length) continue;
    const fragment = root.ownerDocument.createDocumentFragment();
    let start = 0;
    for (const match of matches.sort((a, b) => a.at - b.at)) {
      fragment.append(text.slice(start, match.at));
      const button = root.ownerDocument.createElement('button');
      button.type = 'button'; button.className = 'glossary-term';
      button.dataset.glossaryIndex = String(match.index);
      button.setAttribute('aria-label', `Định nghĩa: ${glossary[match.index].term}`);
      button.textContent = text.slice(match.at, match.end);
      fragment.append(button); start = match.end;
    }
    fragment.append(text.slice(start)); node.replaceWith(fragment);
  }
}

// A normalised text index keeps exact offsets through emphasis and glossary buttons.
function textIndex(root) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const positions = []; let text = '';
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement?.closest('code,pre,script,style,.rp-actions,.rp-slot')) continue;
    for (let offset = 0; offset < (node.nodeValue || '').length; offset += 1) {
      const char = node.nodeValue[offset];
      if (/\s/.test(char)) {
        if (!text || text.endsWith(' ')) continue;
        text += ' ';
      } else text += char;
      positions.push({ node, offset });
    }
  }
  return { text: text.trimEnd(), positions };
}

export function markQuote(root, quote, attributes, within = null) {
  const { text, positions } = textIndex(root);
  const contextAt = within ? text.indexOf(within) : 0;
  const context = within || text;
  const relativeAt = context.indexOf(quote);
  const at = contextAt + relativeAt;
  if (contextAt < 0 || relativeAt < 0 || context.indexOf(quote, relativeAt + 1) >= 0) return false;
  const ranges = new Map();
  for (const position of positions.slice(at, at + quote.length)) {
    const previous = ranges.get(position.node);
    ranges.set(position.node, { start: previous?.start ?? position.offset, end: position.offset + 1 });
  }
  for (const [node, { start, end }] of ranges) {
    const text = node.nodeValue || '';
    const mark = root.ownerDocument.createElement('mark');
    for (const [name, value] of Object.entries(attributes)) mark.setAttribute(name, value);
    mark.textContent = text.slice(start, end);
    const fragment = root.ownerDocument.createDocumentFragment();
    fragment.append(text.slice(0, start), mark, text.slice(end)); node.replaceWith(fragment);
  }
  return true;
}

export function annotatePracticeHtml(html, glossary, units) {
  const documentCopy = new DOMParser().parseFromString(`<div id="reading-root">${html}</div>`, 'text/html');
  const root = documentCopy.getElementById('reading-root');
  if (!root) return html;
  decorateGlossary(root, glossary);
  root.querySelectorAll('img').forEach((image) => {
    image.classList.add('prompt-chart-img'); image.setAttribute('role', 'button'); image.tabIndex = 0;
  });
  const blocks = [...root.querySelectorAll('p,li')].filter((node) => !node.querySelector('p,li'));
  for (const block of blocks) {
    const attached = [];
    units.forEach((unit, index) => {
      if (!markQuote(block, unit.source, { 'data-unit-id': unit.id, class: 'rp-source' })) return;
      (unit.phrases || []).forEach((phrase, phraseIndex) => markQuote(block, phrase.source, {
        'data-unit-id': unit.id, 'data-phrase-index': String(phraseIndex), class: 'rp-source-phrase',
      }, unit.source));
      attached.push({ unit, index });
    });
    if (!attached.length) continue;
    const actions = documentCopy.createElement('div'); actions.className = 'rp-actions';
    const slot = documentCopy.createElement('div'); slot.className = 'rp-slot';
    slot.dataset.slotId = attached[0].unit.id;
    slot.id = `rp-translation-${attached[0].unit.id}`;
    attached.forEach(({ unit, index }) => {
      const button = documentCopy.createElement('button'); button.type = 'button';
      button.dataset.unitAction = unit.id; button.textContent = `Dịch ${unit.precision === 'paragraph' ? 'đoạn' : 'câu'} ${index + 1}`;
      button.setAttribute('aria-controls', slot.id); button.setAttribute('aria-expanded', 'false');
      actions.append(button);
    });
    block.after(actions, slot);
  }
  return root.innerHTML;
}

export async function matchesSupportRevision(support, body, translation) {
  if (!support || !globalThis.crypto?.subtle) return false;
  const sha = async (value) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((n) => n.toString(16).padStart(2, '0')).join('');
  try { return support.source_sha256 === await sha(body) && support.translation_sha256 === await sha(translation || ''); }
  catch { return false; }
}
