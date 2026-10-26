// U-01/U-17: exercise the real Next header and shadow chrome with synthetic
// auth/read fixtures. No backend request or database mutation leaves this spec.
// @ts-check
const { test, expect } = require('@playwright/test');
const { primeBypassCookie } = require('./helpers');

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ context, baseURL }) => {
  await primeBypassCookie(context, baseURL);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL).origin) {
      if (url.pathname === '/js/runtime-config.js') {
        return route.fulfill({ contentType: 'application/javascript', body:
          'window.__AVER_RUNTIME_CONFIG__=Object.freeze({environment:"test",apiBase:"https://mobile-nav-fixture.invalid",supabaseUrl:"https://example.supabase.co",supabaseAnonKey:"synthetic-key"});' });
      }
      // Let the bypass helper apply its origin-scoped Vercel toolbar header.
      return route.fallback();
    }
    const json = (body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/me') return json({ id: 'u01', display_name: 'Mobile learner', email: 'mobile@local', role: 'user', is_active: true, onboarding_completed: true });
    if (url.pathname === '/api/class/me') return json({ has_class: false });
    if (url.pathname.includes('assignments') || url.pathname.includes('sessions')) return json([]);
    if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) return route.abort();
    return json({});
  });
});

test('mobile landing menu reaches Đăng nhập and restores keyboard focus', async ({ page }) => {
  await page.goto('/');
  const theme = page.getByRole('button', { name: 'Chuyển giao diện sáng/tối' });
  await expect(theme).toBeVisible();
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const toggle = page.getByRole('button', { name: 'Mở menu', exact: true });
  const menu = page.locator('#ix-mobile-menu');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link', { name: 'Đăng nhập', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(menu).toBeHidden();
  await toggle.click();
  // The expanded header covers the hero heading; click the exposed page.
  await page.mouse.click(380, 700);
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await menu.getByRole('link', { name: 'Tính năng', exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await menu.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('mobile app menu reaches MY CLASS, marks active links and keeps logout working', async ({ context, page }) => {
  await context.addInitScript(() => {
    let session = sessionStorage.getItem('u01-signout') ? null
      : { access_token: 'synthetic-u01-token', user: { id: 'u01', email: 'mobile@local' } };
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => { session = null; sessionStorage.setItem('u01-signout', 'called'); return { error: null }; },
    } };
  });
  await page.goto('/home');
  const chrome = page.locator('aver-chrome');
  const toggle = chrome.locator('#mobile-nav-toggle');
  const menu = chrome.locator('.nav-links');
  await expect(menu).toBeHidden();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('link')).toHaveCount(8);
  await expect(menu.getByRole('link', { name: 'Trang chủ', exact: true })).toHaveAttribute('aria-current', 'page');
  for (const link of await menu.getByRole('link').all()) {
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(menu).toBeHidden();
  await toggle.click();
  await page.mouse.click(380, 800);
  await expect(menu).toBeHidden();
  await expect(toggle).toBeFocused();
  await toggle.click();
  await menu.getByRole('link', { name: 'MY CLASS', exact: true }).click();
  await expect(page).toHaveURL(/\/my-class$/);
  // Next may retain the prior route in a hidden Activity tree.
  const classChrome = page.locator('aver-chrome[active="class"]');
  await expect(classChrome).toBeVisible();
  await classChrome.locator('#mobile-nav-toggle').click();
  await expect(classChrome.locator('a[data-tab="class"]')).toHaveAttribute('aria-current', 'page');
  await page.keyboard.press('Escape');
  await classChrome.locator('#user-pill').click();
  await expect(classChrome.locator('#instructor-link')).toBeHidden();
  await classChrome.locator('#user-menu-logout').click();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('u01-signout'))).toBe('called');
});

// U-20: from 721px to ~1180px the full nav wrapped to 2-3 rows and the /home
// hero stats scrolled the page sideways. Every tablet width must keep one nav
// row or the hamburger, and never scroll horizontally.
test('tablet widths keep the app nav on one row or behind the hamburger', async ({ context, page }) => {
  await context.addInitScript(() => {
    const session = { access_token: 'synthetic-u20-token', user: { id: 'u01', email: 'mobile@local', user_metadata: { display_name: 'Vinh Tran' } } };
    window.__AVER_SUPABASE_CLIENT__ = { auth: {
      getSession: async () => ({ data: { session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    } };
  });
  // The audited account: /home names the pill from home-summary (later routes win).
  await context.route('**/api/student/home-summary', (route) => route.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ student: { name: 'Vinh Tran' }, streak: { current_days: 2 }, totals: { speaking_sessions: 0, writing_essays: 0 } }) }));
  await page.goto('/home');
  const pill = page.locator('aver-chrome #user-pill-name');
  await expect(pill).toHaveText('Vinh Tran');
  for (const width of [721, 800, 900, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => {
      const root = document.querySelector('aver-chrome').shadowRoot;
      const links = [...root.querySelectorAll('.nav-links a')];
      const toggle = root.getElementById('mobile-nav-toggle');
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        hamburger: getComputedStyle(toggle).display !== 'none',
        visibleLinks: links.filter((a) => a.getBoundingClientRect().width > 0).length,
        linkRows: new Set(links.map((a) => Math.round(a.getBoundingClientRect().top))).size,
      };
    });
    expect(layout.overflow, `${width}px horizontal overflow`).toBeLessThanOrEqual(0);
    if (layout.hamburger) expect(layout.visibleLinks, `${width}px links stay behind the menu`).toBe(0);
    else expect(layout.linkRows, `${width}px nav rows`).toBe(1);
  }
});
