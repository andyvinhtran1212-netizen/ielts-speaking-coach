// `/pricing` is intentionally closed pre-launch, so visual parity cannot
// compare it: both implementations end at `/` and the parity runner correctly
// rejects same-final-url comparisons. Verify the server boundary directly.
const BASE = process.argv[2] || 'http://localhost:3001';
const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const manual = await fetch(`${BASE}/pricing`, { redirect: 'manual' });
const location = manual.headers.get('location') || '';
const body = await manual.text();
check('canonical route redirects temporarily', manual.status === 307, `status=${manual.status}`);
check('redirect target is exactly the homepage', new URL(location, BASE).pathname === '/', `location=${location || '(missing)'}`);
check('unreleased pricing UI is not sent', !body.includes('Chọn gói phù hợp với bạn'));

const followed = await fetch(`${BASE}/pricing`);
check('normal navigation finishes on homepage', followed.ok && new URL(followed.url).pathname === '/', `status=${followed.status} url=${followed.url}`);

const failed = checks.filter((item) => !item.ok);
console.log(`\nPricing redirect flow: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
