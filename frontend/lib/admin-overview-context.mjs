const field = (raw, name) => typeof raw?.getAll === 'function'
  ? (raw.getAll(name).length === 1 ? raw.get(name) : undefined) : raw?.[name];

export function adminOverviewContext(raw = {}) {
  const days = Number(field(raw, 'window'));
  return { windowDays: [7, 30, 90].includes(days) ? days : 30, pane: field(raw, 'pane') === 'content' ? 'content' : 'ops' };
}

export function adminOverviewHref(raw = {}) {
  const context = adminOverviewContext(raw);
  const query = new URLSearchParams();
  if (context.windowDays !== 30) query.set('window', String(context.windowDays));
  if (context.pane !== 'ops') query.set('pane', context.pane);
  return `/admin${query.size ? `?${query}` : ''}`;
}
