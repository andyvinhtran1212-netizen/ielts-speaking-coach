import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  GRAMMAR_REVISION_CODES, commandFits, freezeRevisionCommand, grammarSourceHash,
  isGrammarRevisionCode, normalizeRevisionAck, normalizeRevisionPreview, normalizeRevisionRead,
  revisionReadbackMatches, sourceBytes,
} from '../lib/admin-grammar-revision-model.ts';

const load = (name) => JSON.parse(readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8'));
const fixture = load('admin-grammar-revision.json');
const sources = load('grammar-exact-form-banks.json');
const clone = structuredClone;
const row = fixture.rows[0];
const sourceFor = (code) => sources.banks.find((b) => b.code === code).raw_source;
const commandFor = (r = row) => freezeRevisionCommand(fixture.actor, r.code, sourceFor(r.code), r.preview, fixture.operation_id);

test('actual local PG/ASGI public read/preview/applied/replayed/current wire retains exact command and canonical identities', async () => {
  const captured = fixture.actual_admin_capture;
  const [initial, preview, applied, replayed, current] = captured.requests;
  const code = captured.canonical_code;
  const raw = sourceFor(code);
  assert.equal(await grammarSourceHash(raw), captured.provenance.source_sha256);
  assert.ok(captured.requests.every((r) => r.status === 200));
  const canonical = normalizeRevisionRead(initial.response, code);
  assert.ok(canonical);
  const checked = normalizeRevisionPreview(preview.response, canonical, captured.provenance.source_sha256);
  assert.ok(checked);
  const command = freezeRevisionCommand(captured.actor_id, code, raw, checked, applied.request_without_source.operation_id);
  assert.ok(command);
  assert.deepEqual(command.body, { source_markdown: raw, ...applied.request_without_source });
  assert.deepEqual(applied.request_without_source, replayed.request_without_source);
  const ack = normalizeRevisionAck(applied.response, command);
  const replay = normalizeRevisionAck(replayed.response, command);
  assert.ok(ack); assert.ok(replay);
  assert.equal(ack.outcome, 'applied'); assert.equal(replay.outcome, 'already_applied');
  assert.ok(revisionReadbackMatches(normalizeRevisionRead(current.response, code), ack));
  assert.ok(revisionReadbackMatches(normalizeRevisionRead(current.response, code), replay));
});

test('all twelve schema-shaped admin wires bind the real reviewed source/diff fixture', async () => {
  assert.deepEqual(new Set(GRAMMAR_REVISION_CODES), new Set(fixture.rows.map((r) => r.code)));
  assert.equal(createHash('sha256').update(readFileSync(new URL('fixtures/grammar-exact-form-banks.json', import.meta.url))).digest('hex'), fixture.source_fixture.sha256);
  for (const r of fixture.rows) {
    const digest = await grammarSourceHash(sourceFor(r.code));
    assert.equal(digest, r.preview.source_sha256);
    assert.ok(normalizeRevisionRead(r.read, r.code));
    assert.ok(normalizeRevisionPreview(r.preview, r.read, digest));
    const command = commandFor(r);
    assert.ok(command); assert.ok(Object.isFrozen(command)); assert.ok(Object.isFrozen(command.body));
    const ack = normalizeRevisionAck(r.ack, command);
    assert.ok(ack); assert.ok(revisionReadbackMatches(r.ack.canonical, ack));
  }
});

test('UTF-8 is raw identity, unpaired Unicode rejects, and JSON command bytes have their own actual route cap', async () => {
  assert.equal(sourceBytes('中文'), 6);
  assert.equal(sourceBytes('\ud800'), null); assert.equal(sourceBytes('\udc00'), null);
  assert.equal(sourceBytes(''), null); assert.equal(sourceBytes('a'.repeat(262145)), null);
  assert.equal(sourceBytes('a'.repeat(262144)), 262144);
  assert.equal(commandFits({source_markdown: 'a'.repeat(262144)}), false);
  assert.equal(commandFits({source_markdown: '\n'.repeat(150000)}), false);
  assert.notEqual(await grammarSourceHash('hello\r\n'), await grammarSourceHash('hello\n'));
  assert.notEqual(await grammarSourceHash('\ufeffhello'), await grammarSourceHash('hello'));
});

for (const [name, mutate] of [
  ['missing footprint', (v) => delete v.footprint],
  ['null footprint', (v) => v.footprint = null],
  ['string count', (v) => v.footprint.sessions = '2'],
  ['boolean count', (v) => v.footprint.actors = true],
  ['overlimit', (v) => v.footprint.sessions = 2049],
  ['classification/count disagreement', (v) => v.footprint.classifications = {}],
  ['unknown falsely complete', (v) => v.footprint.classifications = { unknown_reset_or_review: 1 }],
  ['missing authoritative flag', (v) => delete v.footprint.authoritative_review_required],
  ['private proof extra', (v) => v.cohort = []],
  ['wrong code', (v) => v.canonical_code = 'G-unreviewed'],
  ['unmanaged swapped ID', (v) => v.current_bank_id = fixture.operation_id],
  ['false managed mapping', (v) => v.is_managed = true],
]) test(`canonical refuses ${name}, rather than presenting zero`, () => {
  const value = clone(row.read); mutate(value); assert.equal(normalizeRevisionRead(value, row.code), null);
});

test('verified zero footprint is supported and authoritative review prevents commit even with a valid preview', () => {
  const v = clone(row.read);
  v.footprint = {actors:0,sessions:0,stats:0,attempts:0,assignments:0,open_sessions:0,paused_sessions:0,classifications:{},authoritative_review_required:false};
  assert.ok(normalizeRevisionRead(v, row.code));
  const p = clone(row.preview); p.canonical.footprint.authoritative_review_required = true;
  p.canonical.footprint.classifications = {unknown_reset_or_review:1};
  assert.ok(normalizeRevisionPreview(p, row.read, p.source_sha256));
  assert.equal(freezeRevisionCommand(fixture.actor,row.code,sourceFor(row.code),p,fixture.operation_id),null);
});

for (const [name, mutate] of [
  ['source mismatch', (v) => v.source_sha256 = 'a'.repeat(64)],
  ['stale canonical revision', (v) => v.canonical.revision = 'a'.repeat(64)],
  ['wrong topic', (v) => v.canonical.topic_id = fixture.operation_id],
  ['duplicate qid', (v) => v.changed_questions.push(v.changed_questions[0])],
  ['identity field change', (v) => v.changed_questions[0].fields = ['qid']],
  ['empty field list', (v) => v.changed_questions[0].fields = []],
  ['duplicate field', (v) => v.changed_questions[0].fields = ['answer','answer']],
  ['malformed fingerprint', (v) => v.preview_fingerprint = 'bad'],
]) test(`preview refuses ${name}`, () => {
  const v=clone(row.preview);mutate(v);assert.equal(normalizeRevisionPreview(v,row.read,row.preview.source_sha256),null);
});

for (const [name, mutate] of [
  ['wrong UUID', (v) => v.operation_id = fixture.actor],
  ['wrong source', (v) => v.source_sha256 = 'b'.repeat(64)],
  ['wrong bank', (v) => v.corrected_bank_id = fixture.actor],
  ['wrong original', (v) => v.original_bank_id = fixture.actor],
  ['wrong frozen bank revision', (v) => v.canonical.current_bank_revision = 'b'.repeat(64)],
  ['unmanaged ACK', (v) => v.canonical.is_managed = false],
  ['false equality', (v) => v.current_matches_committed = false],
  ['string equality', (v) => v.current_matches_committed = 'true'],
  ['history unknown', (v) => v.original_history_sha256 = null],
  ['foreign metadata', (v) => v.canonical.original_metadata_sha256 = 'b'.repeat(64)],
]) test(`ACK refuses ${name}`, () => {
  const v=clone(row.ack);mutate(v);assert.equal(normalizeRevisionAck(v,commandFor()),null);
});

test('same receipt replay may legitimately have later paused current revision; immutable history hash is not today history', () => {
  const v=clone(row.ack);v.outcome='already_applied';v.current_revision='c'.repeat(64);v.canonical.revision=v.current_revision;
  v.current_matches_committed=false;v.canonical.new_starts_enabled=false;
  const accepted=normalizeRevisionAck(v,commandFor());assert.ok(accepted);
  const read=clone(v.canonical);read.footprint.attempts+=1;
  assert.ok(revisionReadbackMatches(read,accepted));
  read.revision='d'.repeat(64);assert.equal(revisionReadbackMatches(read,accepted),false);
});

test('only exact enum is recognized; malformed actors/operation and managed state cannot create a new command', () => {
  for (const value of [null,'grammar','G-tenses-present-simple ','G-unreviewed']) assert.equal(isGrammarRevisionCode(value),false);
  assert.equal(freezeRevisionCommand('not-an-actor',row.code,sourceFor(row.code),row.preview,fixture.operation_id),null);
  assert.equal(freezeRevisionCommand(fixture.actor,row.code,sourceFor(row.code),row.preview,'not-a-uuid'),null);
  const p=clone(row.preview);p.canonical=row.ack.canonical;
  assert.equal(freezeRevisionCommand(fixture.actor,row.code,sourceFor(row.code),p,fixture.operation_id),null);
});

test('actual captured read, preview, command and both ACKs work without the structuredClone global', () => {
  const captured = fixture.actual_admin_capture;
  const [initial, preview, applied, replayed] = clone(captured.requests);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'structuredClone');
  try {
    assert.equal(Reflect.deleteProperty(globalThis, 'structuredClone'), true);
    const read = normalizeRevisionRead(initial.response, captured.canonical_code);
    assert.deepEqual(read, initial.response);
    const checked = normalizeRevisionPreview(preview.response, read, captured.provenance.source_sha256);
    assert.deepEqual(checked, preview.response);
    const command = freezeRevisionCommand(captured.actor_id, captured.canonical_code, sourceFor(captured.canonical_code), checked, applied.request_without_source.operation_id);
    assert.ok(command);
    assert.deepEqual(command.body, { source_markdown: sourceFor(captured.canonical_code), ...applied.request_without_source });
    assert.deepEqual(normalizeRevisionAck(applied.response, command), applied.response);
    assert.deepEqual(normalizeRevisionAck(replayed.response, command), replayed.response);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'structuredClone', descriptor);
  }
});

test('canonical DTO copies isolate both directions through footprint and classifications', () => {
  const raw = clone(fixture.actual_admin_capture.requests[0].response);
  const read = normalizeRevisionRead(raw, raw.canonical_code);
  assert.deepEqual(read, raw);
  assert.notEqual(read, raw); assert.notEqual(read.footprint, raw.footprint);
  assert.notEqual(read.footprint.classifications, raw.footprint.classifications);
  const expected = clone(read);
  raw.footprint.sessions++; raw.footprint.classifications.raw_only = 1;
  assert.deepEqual(read, expected);
  const rawAfter = clone(raw);
  read.footprint.stats++; read.footprint.classifications.copy_only = 1;
  assert.deepEqual(raw, rawAfter);
});

test('preview copies every nested branch and later mutations cannot change a frozen command', () => {
  const captured = fixture.actual_admin_capture;
  const raw = clone(captured.requests[1].response);
  const read = normalizeRevisionRead(captured.requests[0].response, captured.canonical_code);
  const preview = normalizeRevisionPreview(raw, read, captured.provenance.source_sha256);
  assert.deepEqual(preview, raw); assert.notEqual(preview, raw);
  assert.notEqual(preview.canonical, raw.canonical);
  assert.notEqual(preview.canonical.footprint, raw.canonical.footprint);
  assert.notEqual(preview.canonical.footprint.classifications, raw.canonical.footprint.classifications);
  assert.notEqual(preview.changed_questions, raw.changed_questions);
  assert.ok(preview.changed_questions.length > 0);
  preview.changed_questions.forEach((question, i) => {
    assert.notEqual(question, raw.changed_questions[i]);
    assert.notEqual(question.fields, raw.changed_questions[i].fields);
  });
  assert.notEqual(preview.validation_messages, raw.validation_messages);
  const command = freezeRevisionCommand(captured.actor_id, captured.canonical_code, sourceFor(captured.canonical_code), preview, captured.requests[2].request_without_source.operation_id);
  assert.ok(command); assert.ok(Object.isFrozen(command)); assert.ok(Object.isFrozen(command.body));
  const expectedPreview = clone(preview); const expectedCommand = clone(command);
  raw.canonical.revision = 'a'.repeat(64); raw.canonical.footprint.sessions++;
  raw.canonical.footprint.classifications.raw_only = 1;
  raw.changed_questions[0].qid = 'raw-only'; raw.changed_questions[0].fields.push('prompt');
  raw.validation_messages.push('raw-only'); raw.source_sha256 = 'b'.repeat(64);
  raw.proposed_revision = 'c'.repeat(64); raw.preview_fingerprint = 'd'.repeat(64);
  assert.deepEqual(preview, expectedPreview);
  const rawAfter = clone(raw);
  preview.canonical.revision = 'e'.repeat(64); preview.canonical.current_bank_id = fixture.actor;
  preview.canonical.topic_id = fixture.operation_id; preview.canonical.original_metadata_sha256 = 'f'.repeat(64);
  preview.canonical.footprint.stats++; preview.canonical.footprint.classifications.copy_only = 1;
  preview.changed_questions[0].qid = 'copy-only'; preview.changed_questions[0].fields.push('hint');
  preview.validation_messages.push('copy-only'); preview.source_sha256 = '0'.repeat(64);
  preview.proposed_revision = '1'.repeat(64); preview.preview_fingerprint = '2'.repeat(64);
  assert.deepEqual(raw, rawAfter); assert.deepEqual(command, expectedCommand);
});

test('applied and replayed ACK copies isolate canonical footprint and classifications', () => {
  const captured = fixture.actual_admin_capture;
  const preview = normalizeRevisionPreview(captured.requests[1].response, captured.requests[0].response, captured.provenance.source_sha256);
  const command = freezeRevisionCommand(captured.actor_id, captured.canonical_code, sourceFor(captured.canonical_code), preview, captured.requests[2].request_without_source.operation_id);
  assert.ok(command);
  for (const request of captured.requests.slice(2, 4)) {
    const raw = clone(request.response); const ack = normalizeRevisionAck(raw, command);
    assert.deepEqual(ack, raw); assert.notEqual(ack, raw); assert.notEqual(ack.canonical, raw.canonical);
    assert.notEqual(ack.canonical.footprint, raw.canonical.footprint);
    assert.notEqual(ack.canonical.footprint.classifications, raw.canonical.footprint.classifications);
    const expected = clone(ack);
    raw.canonical.revision = 'a'.repeat(64); raw.canonical.footprint.sessions++;
    raw.canonical.footprint.classifications.raw_only = 1;
    assert.deepEqual(ack, expected);
    const rawAfter = clone(raw);
    ack.canonical.current_bank_id = fixture.actor; ack.canonical.footprint.stats++;
    ack.canonical.footprint.classifications.copy_only = 1;
    assert.deepEqual(raw, rawAfter);
  }
});

test('synthetic JSON classifications retain special own keys as detached data properties', () => {
  const raw = clone(row.read);
  raw.footprint.actors = 1;
  raw.footprint.classifications = JSON.parse('{"__proto__":1,"constructor":0,"prototype":0}');
  const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
  const read = normalizeRevisionRead(raw, row.code); assert.ok(read);
  assert.deepEqual(read.footprint.classifications, raw.footprint.classifications);
  assert.equal(Object.hasOwn(read.footprint.classifications, '__proto__'), true);
  assert.equal(read.footprint.classifications.__proto__, 1);
  assert.equal(read.footprint.classifications.constructor, 0);
  assert.equal(read.footprint.classifications.prototype, 0);
  assert.equal(Object.getPrototypeOf(read.footprint.classifications), Object.prototype);
  raw.footprint.classifications.__proto__ = 2;
  assert.equal(read.footprint.classifications.__proto__, 1);
  read.footprint.classifications.__proto__ = 3;
  assert.equal(raw.footprint.classifications.__proto__, 2);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototypeBefore);
});
