import type { components } from '../../types/api.d.ts';

type Schemas = components['schemas'];
type EditItem = Schemas['ReadingGrammarFocusEditItem'];
type ReadItem = Schemas['ReadingGrammarFocusItem'];

// Accepted wire payloads may omit these fields; explicit empty strings also
// remain distinguishable from omission after GET/PATCH serialization.
const pointOnlyEdit: EditItem = { point: 'Main clause: Ostrom showed' };
const pointOnlyRead: ReadItem = { point: 'Main clause: Ostrom showed' };
const request: Schemas['ReadingGrammarFocusEditRequest'] = {
  expected_revision: 'a'.repeat(64),
  operation_id: '00000000-0000-0000-0000-000000000314',
  grammar_focus: [pointOnlyEdit, { point: 'Content clause', example: '', analysis: 'had managed' }],
};
const response: Schemas['ReadingGrammarFocusRead'] = {
  passage_id: '00000000-0000-0000-0000-000000000313',
  slug: 'sample', library: 'l1_vocab', title: 'Sample', status: 'published',
  body_markdown: 'Ostrom showed…',
  grammar_focus: [pointOnlyRead, { point: 'Content clause', review: '', tip: 'Past perfect' }],
  updated_at: '2026-09-30T08:00:00Z', revision: 'a'.repeat(64),
  source_sha256: 'b'.repeat(64), unrelated_metadata_sha256: 'c'.repeat(64),
  questions_sha256: 'd'.repeat(64),
};
const result: Schemas['ReadingGrammarFocusEditResult'] = {
  passage_id: response.passage_id, slug: response.slug, library: 'l1_vocab',
  outcome: 'updated', operation_id: request.operation_id,
  committed_revision: response.revision, current_revision: response.revision,
  current_matches_committed: true, updated_at: response.updated_at,
  grammar_focus: [{ point: 'A point without optional fields' }],
  source_sha256: response.source_sha256,
  unrelated_metadata_sha256: response.unrelated_metadata_sha256,
  questions_sha256: response.questions_sha256,
  current_source_sha256: response.source_sha256,
  current_unrelated_metadata_sha256: response.unrelated_metadata_sha256,
  current_questions_sha256: response.questions_sha256,
};

// @ts-expect-error optional request fields are not nullable when present
const nullEditExample: EditItem = { point: 'Valid', example: null };
// @ts-expect-error optional request fields are not nullable when present
const nullEditAnalysis: EditItem = { point: 'Valid', analysis: null };
// @ts-expect-error optional request fields are not nullable when present
const nullEditReview: EditItem = { point: 'Valid', review: null };
// @ts-expect-error optional request fields are not nullable when present
const nullEditTip: EditItem = { point: 'Valid', tip: null };
// @ts-expect-error optional response fields are not nullable when present
const nullReadExample: ReadItem = { point: 'Valid', example: null };
// @ts-expect-error optional response fields are not nullable when present
const nullReadAnalysis: ReadItem = { point: 'Valid', analysis: null };
// @ts-expect-error optional response fields are not nullable when present
const nullReadReview: ReadItem = { point: 'Valid', review: null };
// @ts-expect-error optional response fields are not nullable when present
const nullReadTip: ReadItem = { point: 'Valid', tip: null };
// @ts-expect-error point remains required
const missingPoint: EditItem = {};
// @ts-expect-error unknown focus keys are rejected
const unknownKey: EditItem = { point: 'Valid', invented: 'Not accepted' };

void [request, response, result, nullEditExample, nullEditAnalysis, nullEditReview,
  nullEditTip, nullReadExample, nullReadAnalysis, nullReadReview, nullReadTip,
  missingPoint, unknownKey];
