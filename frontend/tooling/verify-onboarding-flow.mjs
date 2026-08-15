// Fixture-backed interaction contract for the native /onboarding wizard.
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.argv[2] || 'http://localhost:3011';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function launch() {
  try { return await chromium.launch(); } catch (error) {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (process.platform === 'darwin' && existsSync(chrome)) {
      return chromium.launch({ executablePath: chrome });
    }
    throw error;
  }
}

const browser = await launch();

async function fixture({
  session = true,
  profile,
  ambiguousPatch = false,
  patchDelayMs = 0,
  viewport = { width: 1280, height: 900 },
}) {
  const context = await browser.newContext({ viewport });
  const errors = [];
  const reads = [];
  const writes = [];
  let canonical = { ...profile };
  const supabaseStub = `
window.supabase = {
  createClient: function () {
    return { auth: {
      getSession: async function () {
        return { data: { session: ${session ? "{ access_token: 'fixture-token', user: { id: 'user-1', email: 'learner@example.com' } }" : 'null'} }, error: null };
      },
      onAuthStateChange: function () {
        return { data: { subscription: { unsubscribe: function () {} } } };
      },
      signOut: async function () { return { error: null }; }
    } };
  }
};`;

  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.includes('supabase-js')) {
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: supabaseStub });
    }
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname) || url.hostname === 'unpkg.com') return route.abort();
    if (url.origin === BASE) {
      if (request.isNavigationRequest() && ['/home', '/login'].includes(url.pathname)) {
        return route.fulfill({ status: 200, contentType: 'text/html', body: `<title>destination</title><h1>${url.pathname}</h1>` });
      }
      return route.continue();
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (request.method() === 'GET' && url.pathname === '/auth/me') {
      reads.push(url.pathname);
      return json(canonical);
    }
    if (request.method() === 'PATCH' && url.pathname === '/auth/profile') {
      const payload = JSON.parse(request.postData() || '{}');
      writes.push(payload);
      if (patchDelayMs) await new Promise((resolve) => setTimeout(resolve, patchDelayMs));
      canonical = { ...canonical, onboarding_completed: true };
      if (ambiguousPatch) return route.abort('connectionfailed');
      return json({ ...canonical, ...payload });
    }
    if (url.pathname === '/api/error-logs') return json({ ok: true });
    return json({});
  });

  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(String(error)));
  return { context, page, errors, reads, writes };
}

const signedOut = await fixture({ session: false, profile: {} });
await signedOut.page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
await signedOut.page.waitForURL('**/login');
check('không có session thì fail closed về canonical /login', signedOut.reads.length === 0);
await signedOut.context.close();

const inactive = await fixture({
  profile: { id: 'user-1', is_active: false, onboarding_completed: false },
});
await inactive.page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
await inactive.page.waitForURL('**/login');
check('profile chưa kích hoạt không được sửa onboarding', inactive.reads.length >= 1 && inactive.writes.length === 0,
  `reads=${inactive.reads.length}; url=${new URL(inactive.page.url()).pathname}`);
await inactive.context.close();

const malformed = await fixture({ profile: { id: 'user-1', is_active: true } });
await malformed.page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
const malformedRetry = malformed.page.getByRole('button', { name: 'Thử lại' });
await malformedRetry.waitFor();
const malformedRetryVisible = await malformedRetry.isVisible();
const malformedFormCount = await malformed.page.locator('#target-band').count();
check('profile sai contract hiện lỗi blocking thay vì mở form',
  malformedRetryVisible
    && malformedFormCount === 0
    && malformed.writes.length === 0,
  `retry=${malformedRetryVisible}; form=${malformedFormCount}; writes=${malformed.writes.length}; reads=${malformed.reads.length}; url=${new URL(malformed.page.url()).pathname}`);
await malformed.context.close();

async function wizardSnapshot(page) {
  const cardStyle = await page.locator('.ob-card').evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      color: style.color,
      fontFamily: style.fontFamily,
    };
  });
  return {
    step: (await page.locator('.ob-step-label').innerText()).trim(),
    percent: (await page.locator('.ob-step-pct').innerText()).trim(),
    title: (await page.locator('.step-panel.active .ob-step__title').innerText()).trim(),
    subtitle: (await page.locator('.step-panel.active .ob-step__subtitle').innerText()).trim(),
    next: (await page.locator('.btn-primary').innerText()).trim(),
    cardStyle,
    contained: await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  };
}

async function runParityLeg(path, legacy) {
  const leg = await fixture({
    profile: { id: 'user-1', is_active: true, onboarding_completed: false },
    viewport: { width: 390, height: 844 },
  });
  await leg.page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' });
  await leg.page.locator('#target-band').waitFor();
  const steps = [await wizardSnapshot(leg.page)];

  await leg.page.locator('#target-band').selectOption('7.0');
  await leg.page.locator('#exam-date').fill('2027-04-05');
  await leg.page.locator('.btn-primary').click();
  if (legacy) {
    await leg.page.locator('#level-cards [data-value="upper_intermediate"]').click();
  } else {
    const level = leg.page.getByRole('radio', { name: /Trên trung cấp/ });
    await level.focus();
    await leg.page.keyboard.press('Space');
    await leg.page.waitForFunction(() => document.querySelector('input[name="self-level"]:checked')?.value === 'upper_intermediate');
  }
  steps.push(await wizardSnapshot(leg.page));

  await leg.page.locator('.btn-primary').click();
  if (legacy) {
    await leg.page.locator('#topic-cards [data-value="technology"]').click();
  } else {
    const topic = leg.page.getByRole('radio', { name: /Công nghệ & Xã hội số/ });
    await topic.focus();
    await leg.page.keyboard.press('Space');
    await leg.page.waitForFunction(() => document.querySelector('input[name="first-topic"]:checked')?.value === 'technology');
  }
  steps.push(await wizardSnapshot(leg.page));

  await leg.page.locator('.btn-primary').click();
  await leg.page.waitForURL('**/home?first_topic=technology');
  const result = {
    steps,
    writes: leg.writes,
    destination: `${new URL(leg.page.url()).pathname}${new URL(leg.page.url()).search}`,
    errors: leg.errors,
  };
  await leg.context.close();
  return result;
}

function sameWizardContract(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const [rollbackParity, nativeParity] = await Promise.all([
  runParityLeg('/onboarding.html', true),
  runParityLeg('/onboarding', false),
]);
const parityMatches = sameWizardContract(rollbackParity, nativeParity);
check('rollback và native giữ cùng nội dung, style, hành vi và payload trên profile chưa hoàn tất',
  parityMatches,
  parityMatches ? '' : `legacy=${JSON.stringify(rollbackParity)}; next=${JSON.stringify(nativeParity)}`);
const intentionalMismatch = structuredClone(nativeParity);
intentionalMismatch.steps[0].title = 'INTENTIONAL PARITY MISMATCH';
check('bộ so hai-leg chặn được một sai khác cố ý',
  !sameWizardContract(rollbackParity, intentionalMismatch));

const wizard = await fixture({
  profile: { id: 'user-1', is_active: true, onboarding_completed: false },
  ambiguousPatch: true,
  patchDelayMs: 150,
  viewport: { width: 390, height: 844 },
});
await wizard.page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
await wizard.page.getByRole('heading', { name: /Chào mừng/ }).waitFor();
await wizard.page.getByRole('button', { name: 'Tiếp theo →' }).click();
check('bước 1 chặn dữ liệu thiếu bằng alert rõ ràng', await wizard.page.locator('.ob-error-banner[role="alert"]').isVisible());
await wizard.page.getByLabel('Mục tiêu band score').selectOption('7.0');
await wizard.page.getByLabel(/Ngày thi dự kiến/).fill('2027-04-05');
await wizard.page.getByRole('button', { name: 'Tiếp theo →' }).click();
const level = wizard.page.getByRole('radio', { name: /Trên trung cấp/ });
await level.focus();
await wizard.page.keyboard.press('Space');
const keyboardLevelChecked = await level.isChecked();
await wizard.page.getByRole('button', { name: 'Tiếp theo →' }).click();
const topic = wizard.page.getByRole('radio', { name: /Công nghệ & Xã hội số/ });
await topic.focus();
await wizard.page.keyboard.press('Space');
const keyboardTopicChecked = await topic.isChecked();
const mobileContained = await wizard.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const mobileDimensions = await wizard.page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
const readsBeforeSubmit = wizard.reads.length;
await wizard.page.getByRole('button', { name: /Bắt đầu luyện tập ngay/ }).evaluate((node) => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await wizard.page.waitForURL('**/home?first_topic=technology');
check('click lặp chỉ ghi một PATCH; mất ACK vẫn reconcile canonical truth',
  wizard.writes.length === 1
    && wizard.reads.length === readsBeforeSubmit + 1
    && wizard.writes[0].onboarding_completed === true);
check('payload giữ đúng năm field đã kiểm chứng',
  JSON.stringify(wizard.writes[0]) === JSON.stringify({
    target_band: 7,
    exam_date: '2027-04-05',
    self_level: 'upper_intermediate',
    preferred_topics: ['technology'],
    onboarding_completed: true,
  }));
check('mobile không tràn ngang và radio dùng được bằng bàn phím',
  keyboardLevelChecked && keyboardTopicChecked && mobileContained,
  `level=${keyboardLevelChecked}; topic=${keyboardTopicChecked}; scrollWidth=${mobileDimensions.scrollWidth}; innerWidth=${mobileDimensions.innerWidth}`);
check('wizard không có lỗi JavaScript', wizard.errors.length === 0, wizard.errors.join(' | '));
await wizard.context.close();

const completed = await fixture({
  profile: { id: 'user-1', is_active: true, onboarding_completed: true },
});
await completed.page.goto(`${BASE}/onboarding`, { waitUntil: 'domcontentloaded' });
await completed.page.waitForURL('**/home');
check('profile đã hoàn tất đi thẳng home, không phát mutation', completed.reads.length >= 1 && completed.writes.length === 0,
  `reads=${completed.reads.length}`);
await completed.context.close();

await browser.close();
const failed = results.filter((item) => !item.ok);
console.log(`\nOnboarding flow: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
