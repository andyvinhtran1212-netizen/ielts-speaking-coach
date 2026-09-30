// Spec0013: bounded read-only navigation; assignment admission has another owner.
export const WRITING_CONTENT_ROUTE = '/writing/dashboard';
export const WRITING_CONTENT_MARKER = 'averWritingContentV1';
export const WRITING_LIBRARY_MARKER = 'averWritingLibraryV1';
const tabs = ['assignments', 'essays', 'tips', 'prompt-bank'];
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function readWritingContentQuery(search = '') {
  const query = new URLSearchParams(search);
  const tabValues = query.getAll('tab');
  const tabValid = tabValues.length === 1 && tabs.includes(tabValues[0]);
  const tab = tabValid ? tabValues[0] : 'assignments';
  const assignment = query.has('assignment_id');
  const tip = query.getAll('tip'), prompt = query.getAll('prompt');
  if (assignment || !tabValid || tip.length > 1 || prompt.length > 1 || (tip.length && prompt.length)) {
    return { tab, item: null, assignment };
  }
  const kind = tip.length ? 'tip' : prompt.length ? 'prompt' : null;
  const id = kind === 'tip' ? tip[0] : prompt[0];
  const expectedTab = kind === 'tip' ? 'tips' : 'prompt-bank';
  return { tab, assignment, item: kind && tab === expectedTab && idPattern.test(id || '') ? { kind, id } : null };
}

export function writingContentLibraryHref(tab) {
  return `${WRITING_CONTENT_ROUTE}?tab=${tabs.includes(tab) ? tab : 'assignments'}`;
}

export function writingContentHref(kind, id) {
  if (!['tip', 'prompt'].includes(kind) || !idPattern.test(id || '')) return null;
  return `${writingContentLibraryHref(kind === 'tip' ? 'tips' : 'prompt-bank')}&${kind}=${encodeURIComponent(id)}`;
}

export function createWritingContentMarker(account, item, parentId) {
  return { version: 1, route: WRITING_CONTENT_ROUTE, account, kind: item.kind, id: item.id,
    parent: writingContentLibraryHref(item.kind === 'tip' ? 'tips' : 'prompt-bank'), parentId };
}

export function validWritingContentMarker(marker, account, pathname, selection, library) {
  const item = selection?.item;
  return Boolean(item && !selection.assignment && marker && marker.version === 1 && account
    && marker.account === account && pathname === WRITING_CONTENT_ROUTE && marker.route === pathname
    && marker.kind === item.kind && marker.id === item.id
    && marker.parent === writingContentLibraryHref(selection.tab)
    && typeof marker.parentId === 'string' && idPattern.test(marker.parentId)
    && validWritingLibraryMarker(library, account, selection.tab) && marker.parentId === library.id);
}

export function validWritingLibraryMarker(marker, account, tab) {
  return Boolean(marker && marker.version === 1 && marker.account === account && marker.tab === tab
    && typeof marker.id === 'string' && idPattern.test(marker.id)
    && Number.isFinite(marker.scroll) && marker.scroll >= 0
    && ['all', 'task_1', 'task_2', 'both'].includes(marker.tipFilter)
    && ['all', 'tip', 'knowledge', 'sample', 'outline'].includes(marker.tipTypeFilter)
    && ['all', 'task1_academic', 'task1_general', 'task2'].includes(marker.pbFilter));
}

export function normalizeWritingContentList(kind, payload) {
  const key = kind === 'tip' ? 'tips' : 'prompts';
  if (!payload || !Array.isArray(payload[key]) || (kind === 'prompt' && typeof payload.enabled !== 'boolean')) {
    throw new Error('Nội dung trả về không hợp lệ.');
  }
  if (kind === 'prompt' && !payload.enabled) return [];
  const ids = new Set();
  for (const item of payload[key]) {
    if (!item || typeof item.id !== 'string' || !idPattern.test(item.id) || ids.has(item.id) || typeof item.title !== 'string'
      || typeof item[kind === 'tip' ? 'body_markdown' : 'prompt_text'] !== 'string') {
      throw new Error('Nội dung trả về không hợp lệ.');
    }
    ids.add(item.id);
  }
  return payload[key];
}
