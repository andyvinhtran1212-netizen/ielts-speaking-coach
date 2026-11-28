export type SkillFacts = { done: string; result: string | null; warning?: string };
export function speakingRow(raw: unknown): SkillFacts | null;
export function writingRow(raw: unknown): SkillFacts | null;
export function listeningRow(raw: unknown): SkillFacts | null;
export function vocabRow(raw: unknown): SkillFacts | null;
export function goalFromMe(me: unknown): { band: string; examDate: string };
export function isFeatureDisabled(error: unknown): boolean;
export function isContentExpired(error: unknown): boolean;
