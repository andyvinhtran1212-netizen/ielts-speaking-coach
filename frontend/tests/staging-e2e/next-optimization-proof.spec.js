// Live staging proof for the two external-only Next.js optimization gates.
// This spec never targets production. Its one canonical write creates a unique
// Vocabulary probe under an isolated topic and removes both exact rows in finally.
// @ts-check

const https = require('node:https');
const { test, expect } = require('@playwright/test');

const {
  BYPASS_HEADERS,
  STAGING_API,
  signIn,
} = require('./helpers');

const STAGING_ORIGIN = process.env.STAGING_BASE_URL || 'https://staging.averlearning.com';
if (new URL(STAGING_ORIGIN).origin !== 'https://staging.averlearning.com') {
  throw new Error(`refusing non-staging optimization proof target: ${STAGING_ORIGIN}`);
}
const HTML_BUDGET_BYTES = 60 * 1024;
const PUBLIC_HEADERS = Object.freeze({
  ...BYPASS_HEADERS,
  'x-vercel-skip-toolbar': '1',
});

function auth(token) {
  return { Authorization: `Bearer ${token}` };
}

function getCompressed(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        ...PUBLIC_HEADERS,
        'accept-encoding': 'br, gzip',
        'user-agent': 'aver-staging-next-optimization-proof/1.0',
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode || 0,
        encoding: String(response.headers['content-encoding'] || ''),
        bytes: Buffer.concat(chunks).byteLength,
      }));
    });
    request.setTimeout(15_000, () => request.destroy(new Error('compressed HTML request timed out')));
    request.on('error', reject);
    request.end();
  });
}

test.describe.serial('Next optimization live staging evidence', () => {
  test('Vocabulary document stays below the compressed HTML budget', async () => {
    const result = await getCompressed(`${STAGING_ORIGIN}/vocabulary`);
    expect(result.status).toBe(200);
    expect(['br', 'gzip']).toContain(result.encoding);
    expect(result.bytes).toBeLessThan(HTML_BUDGET_BYTES);
  });

  test('canonical Vocabulary write invalidates the warmed Next cache', async ({ request }) => {
    test.setTimeout(90_000);
    const adminToken = await signIn(request, 'admin');
    const suffix = `${(process.env.RELEASE_SOURCE_SHA || 'manual').slice(0, 10)}-${Date.now().toString(36)}`;
    const slug = `e2e-cache-${suffix}`.toLowerCase();
    const category = `e2e-cache-topic-${suffix}`.toLowerCase();
    const originalHeadword = `CacheProbeA${suffix.replace(/[^a-z0-9]/gi, '')}`;
    const updatedHeadword = `CacheProbeB${suffix.replace(/[^a-z0-9]/gi, '')}`;
    const publicUrl = `${STAGING_ORIGIN}/vocabulary?cat=${encodeURIComponent(category)}&slug=${encodeURIComponent(slug)}`;
    const markdown = `---\nheadword: "${originalHeadword}"\nslug: "${slug}"\ncategory: "${category}"\nlevel: "B2"\npart_of_speech: "noun"\npronunciation: "/keɪʃ/"\nsource: "staging-e2e"\n---\n\n**Đầu dò cache staging có thể xóa an toàn.**\n`;
    let createdId = '';
    let createdTopicId = '';
    let importAttempted = false;
    let topicCreateAttempted = false;
    let probeWasCreated = false;

    const findProbeId = async () => {
      for (const headword of [updatedHeadword, originalHeadword]) {
        const response = await request.get(
          `${STAGING_API}/admin/vocabulary?q=${encodeURIComponent(headword)}&limit=10&offset=0`,
          { headers: auth(adminToken) },
        );
        if (!response.ok()) continue;
        const row = (await response.json()).words?.find((word) => word.slug === slug);
        if (row?.id) return row.id;
      }
      return '';
    };

    const findProbeTopicId = async () => {
      const response = await request.get(`${STAGING_API}/admin/content-topics?skill_area=vocab`, {
        headers: auth(adminToken),
      });
      if (!response.ok()) return '';
      return (await response.json()).find((topic) => topic.slug === category)?.id || '';
    };

    try {
      topicCreateAttempted = true;
      const topicCreated = await request.post(`${STAGING_API}/admin/content-topics`, {
        headers: auth(adminToken),
        data: {
          title: `Staging cache proof ${suffix}`,
          slug: category,
          skill_area: 'vocab',
          is_published: true,
        },
      });
      const topicBody = await topicCreated.json();
      if (topicCreated.status() === 201 && topicBody?.id) createdTopicId = topicBody.id;
      expect(topicCreated.status()).toBe(201);
      expect(topicBody.slug).toBe(category);
      expect(createdTopicId).toBeTruthy();

      const before = await request.get(
        `${STAGING_API}/admin/vocabulary?q=${encodeURIComponent(originalHeadword)}&limit=10&offset=0`,
        { headers: auth(adminToken) },
      );
      expect(before.status()).toBe(200);
      expect((await before.json()).words).toEqual([]);

      importAttempted = true;
      const imported = await request.post(`${STAGING_API}/admin/vocabulary/import?dry_run=false`, {
        headers: auth(adminToken),
        multipart: {
          file: {
            name: `${slug}.md`,
            mimeType: 'text/markdown',
            buffer: Buffer.from(markdown, 'utf8'),
          },
        },
      });
      expect(imported.status()).toBe(200);
      const importBody = await imported.json();
      expect(importBody.action).toBe('created');
      probeWasCreated = importBody.action === 'created';
      expect(importBody.validation_errors).toEqual([]);
      expect(importBody.committed_ids).toEqual([slug]);

      const listed = await request.get(
        `${STAGING_API}/admin/vocabulary?q=${encodeURIComponent(originalHeadword)}&limit=10&offset=0`,
        { headers: auth(adminToken) },
      );
      expect(listed.status()).toBe(200);
      const rows = (await listed.json()).words;
      expect(rows).toHaveLength(1);
      expect(rows[0].slug).toBe(slug);
      createdId = rows[0].id;

      const warmed = await request.get(publicUrl, { headers: PUBLIC_HEADERS });
      expect(warmed.status()).toBe(200);
      expect(await warmed.text()).toContain(originalHeadword);

      const patched = await request.patch(`${STAGING_API}/admin/vocabulary/${encodeURIComponent(createdId)}`, {
        headers: auth(adminToken),
        data: { headword: updatedHeadword },
      });
      expect(patched.status()).toBe(200);
      expect((await patched.json()).id).toBe(createdId);

      await expect.poll(async () => {
        const response = await request.get(publicUrl, { headers: PUBLIC_HEADERS });
        const html = await response.text();
        return {
          status: response.status(),
          hasNew: html.includes(updatedHeadword),
          hasOld: html.includes(originalHeadword),
        };
      }, {
        message: 'warmed public:vocabulary data must refresh after the canonical PATCH',
        timeout: 30_000,
        intervals: [500, 1_000, 2_000],
      }).toEqual({ status: 200, hasNew: true, hasOld: false });
    } finally {
      const cleanupFailures = [];
      try {
        if (importAttempted && !createdId) createdId = await findProbeId();
        if (probeWasCreated) expect(createdId, 'created probe must remain discoverable for cleanup').toBeTruthy();
        if (createdId) {
          const removed = await request.delete(
            `${STAGING_API}/admin/vocabulary/${encodeURIComponent(createdId)}`,
            { headers: auth(adminToken) },
          );
          expect(removed.status()).toBe(200);
          expect((await removed.json()).id).toBe(createdId);
        }
      } catch (error) {
        cleanupFailures.push(error);
      }
      try {
        if (topicCreateAttempted && !createdTopicId) createdTopicId = await findProbeTopicId();
        if (createdTopicId) {
          const removedTopic = await request.delete(
            `${STAGING_API}/admin/content-topics/${encodeURIComponent(createdTopicId)}`,
            { headers: auth(adminToken) },
          );
          expect(removedTopic.status()).toBe(200);
          expect((await removedTopic.json()).id).toBe(createdTopicId);
        }
      } catch (error) {
        cleanupFailures.push(error);
      }
      if (cleanupFailures.length) throw new AggregateError(cleanupFailures, 'staging cache proof cleanup failed');
    }
  });
});
