export function foldVietnamese(value: unknown): string;
export function filterHelp<I extends { q: string; a: string }, G extends { items: readonly I[] }>(
  groups: readonly G[],
  query: unknown,
): { groups: (G & { items: I[] })[]; hits: number; searching: boolean };
