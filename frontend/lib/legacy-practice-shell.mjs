// Transitional extractor for the Speaking core dark route.
//
// The legacy body is the canonical markup while behavior is still supplied by
// practice.js. Keeping the extraction strict makes this an explicit bridge:
// malformed source or an accidentally retained script fails the build instead
// of shipping a half-booted player.

export function extractLegacyPracticeBody(source) {
  if (typeof source !== 'string' || !source) {
    throw new Error('legacy-practice-source-missing');
  }

  const body = source.match(/<body\b[^>]*>([\s\S]*?)<!--\s*─+\s*SCRIPTS/);
  if (!body) throw new Error('legacy-practice-body-boundary-missing');

  let markup = body[1];
  const chrome = markup.match(/<aver-chrome\b[^>]*><\/aver-chrome>/g) || [];
  if (chrome.length !== 1) throw new Error('legacy-practice-chrome-boundary-invalid');
  markup = markup.replace(chrome[0], '').trim();

  if (/<script\b/i.test(markup)) throw new Error('legacy-practice-script-leaked');
  if (!/id="state-loading"/.test(markup) || !/id="state-completion"/.test(markup)) {
    throw new Error('legacy-practice-state-contract-incomplete');
  }
  return markup;
}
