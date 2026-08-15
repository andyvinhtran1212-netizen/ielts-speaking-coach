const VALID_STATUS = new Set(['weak', 'learning', 'unseen', 'strong']);

function objectOf(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function textOf(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Fail closed on malformed private data. An unreadable payload must never be
 * presented as an honest empty roadmap, because that would hide real weak KPs.
 */
export function normalizePersonalRoadmap(value) {
  const raw = objectOf(value);
  if (!raw || (raw.mode !== 'static' && raw.mode !== 'personal') || !Array.isArray(raw.nodes)) {
    throw new Error('invalid-personal-roadmap');
  }
  if (raw.mode === 'static') {
    if (raw.nodes.length) throw new Error('invalid-personal-roadmap');
    return { mode: 'static', weakCount: 0, nodes: [] };
  }

  const weakCount = Number(raw.weak_count);
  if (!Number.isInteger(weakCount) || weakCount < 0) throw new Error('invalid-personal-roadmap');

  const nodes = raw.nodes.map((value, index) => {
    const node = objectOf(value);
    const slug = textOf(node?.slug);
    const title = textOf(node?.title);
    const category = textOf(node?.category) || null;
    const status = textOf(node?.status);
    if (!node || !slug || !title || !VALID_STATUS.has(status) || typeof node.is_weak !== 'boolean') {
      throw new Error(`invalid-personal-roadmap-node:${index}`);
    }
    return { slug, title, category, status, isWeak: node.is_weak };
  });
  return { mode: 'personal', weakCount, nodes };
}
