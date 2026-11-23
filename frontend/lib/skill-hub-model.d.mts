export type Skill = 'speaking' | 'writing' | 'listening' | 'reading';
export type SkillHubBlock = 'credits' | 'resume' | 'suggestions' | 'catalog' | 'history';
export type SkillHubCredits = { total: number; metering: 'metered' | 'not_metered' | 'unknown' };
export type SkillHubResume = { kind: string; title: string; state: string; href: string; updatedAt: string | null };
export type SkillHubStarter = { title: string; meta: string | null; usesCredit: boolean; href: string };
export type SkillHubSuggestion = { kind: string; title: string; why: string; href: string };
export type SkillHubGroup = { group: string; label: string; count: number | null; done: number | null; href: string };
export type SkillHubResult = { band: number | null; correct: number | null; total: number | null; pending: boolean };
export type SkillHubHistory = {
  submittedAt: string | null; title: string; kind: string; source: string; result: SkillHubResult; href: string | null;
};
export type SkillHub = {
  skill: Skill;
  credits: SkillHubCredits | null;
  resume: SkillHubResume[];
  starter: SkillHubStarter | null;
  suggestions: SkillHubSuggestion[];
  catalog: SkillHubGroup[];
  catalogHref: string | null;
  history: SkillHubHistory[];
  historyHref: string | null;
  blocked: boolean;
  degraded: Set<SkillHubBlock>;
};

export const SKILLS: readonly Skill[];
export const SKILL_LABELS: Readonly<Record<Skill, string>>;
export const SKILL_HUB_HREFS: Readonly<Record<Skill, string>>;
export function normalizeSkillHub(raw: unknown, skill: Skill): SkillHub | null;
export function creditsEmpty(credits: SkillHubCredits | null): boolean;
export function sourceCopy(source: string): string;
export function resultCopy(result: SkillHubResult | null): string;
export function vnDateCopy(value: unknown): string | null;
export function catalogMetaCopy(group: SkillHubGroup): string;
export function wantsClassicView(search: string): boolean;
export function readingFallbackHref(search: string): string;
