// Operate on already-sanitized markup, preserving every authored text node.
export function formatReadingPassage(html, document) {
  const body = document.createElement('div');
  body.innerHTML = html;
  const paragraphs = [...body.querySelectorAll(':scope > p')];
  const firstParagraph = paragraphs[0];
  const lead = firstParagraph?.firstChild;
  // Imported papers can join a long italic standfirst to the opening prose.
  // Short inline emphasis (a name or term) must remain inside its sentence.
  if (lead?.nodeName === 'EM' && lead.textContent.trim().split(/\s+/).length >= 20) {
    if (lead.nextSibling && firstParagraph.textContent.slice(lead.textContent.length).trim()) {
      const standfirst = document.createElement('p');
      standfirst.className = 'reading-next-standfirst';
      firstParagraph.before(standfirst);
      standfirst.append(lead);
    } else {
      firstParagraph.classList.add('reading-next-standfirst');
    }
  }
  const labels = paragraphs.map((paragraph) => /^([A-Z])\s/.exec(paragraph.textContent || '')?.[1]);
  const labelled = labels.filter(Boolean);
  // A sequence distinguishes paragraph labels from an ordinary sentence beginning "A".
  if (labelled.length >= 2 && labelled.every((label, index) => label === String.fromCharCode(65 + index))) {
    paragraphs.forEach((paragraph, index) => {
      if (!labels[index]) return;
      const walker = document.createTreeWalker(paragraph, 4);
      const first = walker.nextNode();
      if (!first || !/^[A-Z](?:\s|$)/.test(first.textContent || '')) return;
      if (first.parentElement?.tagName === 'STRONG' && first.parentElement.textContent.trim() === labels[index]) {
        first.parentElement.classList.add('reading-next-paragraph-label');
        return;
      }
      const label = document.createElement('strong');
      label.className = 'reading-next-paragraph-label';
      label.textContent = first.textContent.slice(0, 1);
      first.textContent = first.textContent.slice(1);
      first.parentNode.insertBefore(label, first);
    });
  }
  return body.innerHTML;
}
