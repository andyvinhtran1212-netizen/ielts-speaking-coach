export type HelpItem = { id: string; q: string; a: string; link?: string; href?: string };
export type HelpGroup = { id: string; name: string; items: readonly HelpItem[] };
export const HELP_GROUPS: readonly HelpGroup[];
