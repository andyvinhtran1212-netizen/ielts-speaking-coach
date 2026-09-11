function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function normalizeCorrectionPerformance(value) {
  const root = object(value);
  const summary = object(root?.summary);
  if (!root || !summary || !Array.isArray(root.items)) return null;
  const items = root.items.filter((row) => {
    const item = object(row);
    return item && typeof item.id === 'string' && ['reading', 'listening'].includes(item.skill)
      && Number.isInteger(Number(item.question_number));
  });
  return { ...root, summary, items, malformedCount: root.items.length - items.length };
}

export function normalizeCorrectionTimeline(value) {
  const root = object(value);
  if (!root || !object(root.item) || !Array.isArray(root.events)) return null;
  return { ...root, events: root.events.filter((event) => object(event) && typeof event.event_name === 'string') };
}

export function normalizeCorrectionContentHealth(value) {
  const root = object(value);
  const versions = object(root?.versions);
  if (!root || !versions || !Number.isFinite(Number(root.object_count))) return null;
  return { ...root, versions };
}
