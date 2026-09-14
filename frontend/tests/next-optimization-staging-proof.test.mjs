import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const FRONTEND = join(import.meta.dirname, '..');
const SPEC = readFileSync(join(FRONTEND, 'tests', 'staging-e2e', 'next-optimization-proof.spec.js'), 'utf8');
const require = createRequire(import.meta.url);
const { selectCanonicalVocabularyTopic } = require('../tooling/staging-vocabulary-topic.cjs');

describe('Next optimization staging proof safety', () => {
  test('measures raw compressed HTML against the explicit 60 KiB budget', () => {
    assert.match(SPEC, /'accept-encoding': 'br, gzip'/);
    assert.match(SPEC, /HTML_BUDGET_BYTES = 60 \* 1024/);
    assert.match(SPEC, /Buffer\.concat\(chunks\)\.byteLength/);
    assert.match(SPEC, /toBeLessThan\(HTML_BUDGET_BYTES\)/);
  });

  test('warms one exact cache key before PATCH and polls the same URL', () => {
    assert.deepEqual(
      selectCanonicalVocabularyTopic([
        { slug: 'business_finance', is_published: true },
        { slug: 'work-and-careers', is_published: true },
        { slug: 'travel', is_published: false },
      ]),
      { slug: 'work-and-careers', is_published: true },
    );
    assert.equal(selectCanonicalVocabularyTopic([{ slug: 'Work & Careers', is_published: true }]), null);
    assert.match(SPEC, /const category = existingTopic\.slug/);
    assert.match(SPEC, /const publicUrl = `\$\{STAGING_ORIGIN\}\/vocabulary\?cat=\$\{encodeURIComponent\(category\)\}&slug=/);
    assert.match(SPEC, /expect\(await warmed\.text\(\)\)\.toContain\(originalHeadword\)/);
    assert.match(SPEC, /request\.patch\(`\$\{STAGING_API\}\/admin\/vocabulary\/\$\{encodeURIComponent\(createdId\)\}`/);
    assert.match(SPEC, /expect\.poll/);
    assert.match(SPEC, /hasNew: html\.includes\(updatedHeadword\)/);
    assert.match(SPEC, /hasOld: html\.includes\(originalHeadword\)/);
  });

  test('is staging-only and cleans the exact created row even after failure', () => {
    assert.doesNotMatch(SPEC, /ielts-speaking-coach-production|huwsmtubwulikhlmcirx/);
    assert.match(SPEC, /new URL\(STAGING_ORIGIN\)\.origin !== 'https:\/\/staging\.averlearning\.com'/);
    assert.match(SPEC, /refusing non-staging optimization proof target/);
    assert.match(SPEC, /expect\(importBody\.action\)\.toBe\('created'\)/);
    assert.match(SPEC, /finally \{/);
    assert.match(SPEC, /if \(probeWasCreated && !createdId\) createdId = await findProbeId\(\)/);
    assert.match(SPEC, /admin\/content-topics\?skill_area=vocab/);
    assert.match(SPEC, /staging must retain at least one canonical Vocabulary topic/);
    assert.match(SPEC, /request\.delete\(/);
    assert.match(SPEC, /encodeURIComponent\(createdId\)/);
    assert.doesNotMatch(SPEC, /bulk-delete|all=true/);
  });
});
