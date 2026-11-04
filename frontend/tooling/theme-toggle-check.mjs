// Light/dark toggle contract for signed-in routes that render their own
// header (`chrome="none"`, PC-J577): at 360 and 1280 px the button is in the
// viewport, flips `[data-theme]` + `av-theme` both ways, swaps its icon, and
// sends no write — the toggle is local-only.
const TELEMETRY = /\/api\/(analytics\/events|error-logs)$/;

export async function checkThemeToggle(page, check, route) {
  const initialViewport = page.viewportSize();
  const writes = [];
  const onRequest = (request) => {
    const { pathname } = new URL(request.url());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method()) && !TELEMETRY.test(pathname)) {
      writes.push(`${request.method()} ${pathname}`);
    }
  };
  page.on('request', onRequest);
  const toggle = page.locator('button.av-theme-toggle');
  const state = () => toggle.evaluate((button) => ({
    theme: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('av-theme'),
    pressed: button.getAttribute('aria-pressed'),
    icon: [...button.querySelectorAll('svg')].filter((svg) => getComputedStyle(svg).display !== 'none').map((svg) => svg.getAttribute('class')).join(' '),
  }));
  const shows = (s, theme) => s.theme === theme && s.stored === theme
    && s.pressed === String(theme === 'dark') && s.icon.includes(theme === 'dark' ? 'icon-sun' : 'icon-moon')
    && !s.icon.includes(theme === 'dark' ? 'icon-moon' : 'icon-sun');
  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const visible = await toggle.first().waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    const box = visible ? await toggle.first().boundingBox() : null;
    check(`${route} ${width}px: có đúng một nút đổi theme, nằm trong khung nhìn`, await toggle.count() === 1
      && !!box && box.x >= 0 && box.x + box.width <= width && box.width >= 40 && box.height >= 40, JSON.stringify(box));
    if (!visible) continue;
    // aria-pressed is written by bindToggleButton once the component mounts.
    await page.waitForFunction(() => document.querySelector('button.av-theme-toggle')?.hasAttribute('aria-pressed'));
    const before = await state();
    const other = before.theme === 'dark' ? 'light' : 'dark';
    await toggle.click();
    const flipped = await state();
    await toggle.click();
    const back = await state();
    check(`${route} ${width}px: bấm đổi ${before.theme} → ${other} rồi trả lại ${before.theme}`, shows(flipped, other) && shows(back, before.theme),
      JSON.stringify({ before, flipped, back }));
  }
  page.off('request', onRequest);
  if (initialViewport) await page.setViewportSize(initialViewport);
  check(`${route}: nút đổi theme không gửi request ghi`, writes.length === 0, writes.join(', '));
}
