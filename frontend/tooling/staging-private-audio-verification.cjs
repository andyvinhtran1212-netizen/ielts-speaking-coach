// Only the seeded smoke identity and one metadata-verified synthetic response.
// Never print credentials, signed URLs, object paths or response bodies.
const assert = require('node:assert/strict');
const { request } = require('@playwright/test');
const { STAGING_API, STAGING_SUPABASE, signIn } = require('../tests/staging-e2e/helpers.js');
const SESSION = 'e4017c2d-93da-47d1-80a3-13fdd0209866';
const RESPONSE = '4f976722-90f3-44ff-9bc6-e39ed15b5dab';
const RELEASE = 'f82e25a9a00d46300b566f8075e3799375e9956c';
const EXPECT_PRIVATE = process.env.EXPECT_PRIVATE === 'true';

async function main() {
  const api = await request.newContext({ timeout: 20000 });
  const checks = [];
  const record = (name, passed) => { checks.push({ name, passed }); assert.ok(passed, name); };
  try {
    const student = await signIn(api, 'student');
    const admin = await signIn(api, 'admin');
    const other = await signIn(api, 'instructor');
    const auth = token => ({ Authorization: `Bearer ${token}` });
    const runtime = await api.get(`${STAGING_API}/health/runtime`, { headers: auth(admin) });
    record('backend release matches audited code', runtime.ok() && (await runtime.json()).git_sha === RELEASE);
    const endpoint = `${STAGING_API}/sessions/${SESSION}/audio-urls`;
    const ownerResponse = await api.get(endpoint, { headers: auth(student) });
    record('owner audio endpoint succeeds', ownerResponse.status() === 200);
    const items = await ownerResponse.json();
    const item = items.find(row => row.response_id === RESPONSE);
    record('synthetic recording is present with one-hour TTL', Boolean(item) && item.expires_in === 3600);
    const signed = new URL(item.url);
    record('owner receives same-origin signed URL, not public URL',
      signed.origin === STAGING_SUPABASE && signed.pathname.startsWith('/storage/v1/object/sign/audio-responses/') && signed.searchParams.has('token'));
    // A small range from the approved synthetic object, never learner audio.
    const media = await api.get(signed.href, { headers: { Range: 'bytes=0-15' }, maxRedirects: 0 });
    record('owner signed playback/download succeeds', [200, 206].includes(media.status()) && (await media.body()).length > 0);
    const nonowner = await api.get(endpoint, { headers: auth(other) });
    record('different student is denied', nonowner.status() === 404);
    const anonymous = await api.get(endpoint);
    record('anonymous API request is denied', [401, 403].includes(anonymous.status()));
    const adminResponse = await api.get(`${STAGING_API}/admin/sessions/${SESSION}`, { headers: auth(admin) });
    record('admin review endpoint succeeds', adminResponse.status() === 200);
    const staffRow = (await adminResponse.json()).responses.find(row => row.id === RESPONSE);
    record('admin receives playable private recording', staffRow?.audio_available === true && Boolean(staffRow?.audio_playback_url));
    const publicUrl = new URL(signed.href);
    publicUrl.pathname = publicUrl.pathname.replace('/object/sign/', '/object/public/');
    publicUrl.search = '';
    const publicHead = await api.head(publicUrl.href, { maxRedirects: 0 });
    record(EXPECT_PRIVATE ? 'anonymous public URL denied' : 'public baseline observed before private flip',
      EXPECT_PRIVATE ? [400, 401, 403, 404].includes(publicHead.status()) : publicHead.status() === 200);
    console.log(JSON.stringify({ environment: 'staging', release: RELEASE, privateExpected: EXPECT_PRIVATE, checks, gateEvidence: false }));
  } catch {
    console.log(JSON.stringify({ environment: 'staging', privateExpected: EXPECT_PRIVATE, checks, failed: true, gateEvidence: false }));
    process.exitCode = 1;
  } finally { await api.dispose(); }
}
main().catch(() => { console.error('Synthetic audio verification could not complete.'); process.exitCode = 1; });
