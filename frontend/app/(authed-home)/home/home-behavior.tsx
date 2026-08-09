'use client';

// HomeBehavior — bản port của `public/js/home.js` (IIFE) sang Client Component.
//
// VÌ SAO VÁ THẲNG VÀO DOM THAY VÌ DỰNG BẰNG STATE REACT: đây là khuôn đã dùng ở
// pilot 3/4 (`profile-behavior.tsx`) và nó có lý do — vỏ trang là Server
// Component tĩnh (PPR), dữ liệu riêng tư chỉ tới ở phía client qua `window.api`
// (ADR-003 §3: bearer token không đi qua ranh giới RSC). Dựng lại bằng state sẽ
// biến cả trang thành client và làm lệch DOM so với bản legacy — mà chính DOM
// là thứ cổng parity G1 đang so.
//
// Các hàm dưới đây port SÁT NGHĨA bản legacy: `formatRelativeTime`,
// `METRIC_FORMATTERS`, `setStat`, `clearStatLoading`, `renderHero`,
// `renderSkillCard`, `renderError`, `loadClassStrip`, `loadHome`. Đổi hành vi ở
// đây là làm lệch parity, nên khi sửa phải sửa CẢ HAI bản hoặc không sửa bản nào.
//
// Khác legacy có chủ ý — đúng hai chỗ:
//   1. Cổng đăng nhập đi qua `useAuth()` (máy trạng thái ADR-011) thay vì
//      `getSession()` thô như legacy, giống hệt pilot 3/4.
//   2. Chờ `window.api` bằng `whenGlobalReady` (có hạn giờ, có báo lỗi) thay vì
//      `setTimeout(bootstrap, 30)` lặp vô hạn của legacy.
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';
import { whenGlobalReady } from '@/lib/when-global-ready.mjs';
// Phần THUẦN nằm ở module riêng để `node --test` kiểm được hành vi thật —
// `node --test` không nạp được `.tsx`. Cùng khuôn `when-global-ready.mjs`.
import {
  METRIC_FORMATTERS, SKILLS_ORDER, SKILL_META, formatRelativeTime,
} from '@/lib/home-metrics.mjs';

function $(id: string) { return document.getElementById(id); }

// Trang vẽ `…` (class is-loading, nhấp nháy theo home.css) chứ KHÔNG vẽ số 0,
// để một con số chưa tải xong không bị đọc nhầm thành dữ liệu thật. `setStat`
// ghi giá trị và tắt nhấp nháy; `clearStatLoading` là lượt quét vét cho ô nào
// đường render không chạm tới — thành công → '0' (đúng là không), lỗi → '—'
// (không có dữ liệu, không bao giờ là số 0 gây hiểu lầm, và không nhấp nháy mãi).
function setStat(el: Element | null, value: string | number) {
  if (!el) return;
  el.textContent = String(value);
  el.classList.remove('is-loading');
}
function clearStatLoading(fallback: string) {
  document.querySelectorAll('.value-num.is-loading, .js-val.is-loading')
    .forEach((el) => { el.classList.remove('is-loading'); el.textContent = fallback; });
}

function renderHero(data: any) {
  const greetName = $('greeting-name');
  if (greetName) greetName.textContent = data.student?.name || 'bạn';

  const streakEl = $('hero-streak');
  const streak = data.streak?.current_days || 0;
  if (streakEl) {
    setStat(streakEl.querySelector('.value-num'), streak);
    const unit = streakEl.querySelector('.unit');
    if (unit) unit.textContent = 'ngày';
    if (streak > 0) streakEl.classList.add('alive');
  }

  const sessionsEl = $('hero-sessions');
  if (sessionsEl) setStat(sessionsEl.querySelector('.value-num'), data.totals?.speaking_sessions || 0);

  const essaysEl = $('hero-essays');
  if (essaysEl) setStat(essaysEl.querySelector('.value-num'), data.totals?.writing_essays || 0);
}

/**
 * `permissions` là payload của GET /api/student/permissions. Kỹ năng người dùng
 * không có quyền (Sprint 5.2: Writing) render ở chế độ "locked" — cùng bố cục
 * với sắp-ra-mắt nhưng lời văn trỏ tới luồng kích hoạt thay vì bản phát hành sau.
 *
 * Ghi `innerHTML` đè lên node do React dựng là AN TOÀN ở đây vì component này
 * không giữ state nào — React không bao giờ render lại nhánh đó. Đây cũng đúng
 * là điều `profile-behavior.tsx` làm.
 */
function renderSkillCard(
  skillId: string,
  data: any,
  permissions: any,
  cleanups: Array<() => void>,
) {
  const card = document.querySelector<HTMLElement>('[data-skill="' + skillId + '"]');
  if (!card) return;

  // Module thuần là `.mjs` nên TS suy ra kiểu literal, không có index
  // signature — ép kiểu ở ĐÚNG hai chỗ tra cứu thay vì làm loãng module.
  const meta = (SKILL_META as Record<string, any>)[skillId] || ({} as any);

  if (skillId === 'writing' && permissions && permissions.writing === false) {
    card.classList.remove('skeleton');
    card.classList.add('coming-soon');
    card.dataset.locked = 'true';
    card.innerHTML =
      '<div class="head">'
        + '<div class="icon">' + meta.icon + '</div>'
        + '<span class="lock-tag">🔒 Chưa kích hoạt</span>'
      + '</div>'
      + '<h3>' + meta.name + '</h3>'
      + '<p class="desc">Quyền Writing chưa được kích hoạt cho tài khoản này. Liên hệ giảng viên để được hỗ trợ.</p>';
    const lockedAlert = () => alert('Quyền Writing chưa được kích hoạt. Liên hệ admin để được hỗ trợ.');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lockedAlert(); }
    };
    card.tabIndex = 0;
    card.addEventListener('click', lockedAlert);
    card.addEventListener('keydown', onKey);
    cleanups.push(() => {
      card.removeEventListener('click', lockedAlert);
      card.removeEventListener('keydown', onKey);
    });
    return;
  }

  if (data && data.status === 'coming_soon') {
    card.classList.remove('skeleton');
    card.classList.add('coming-soon');
    card.innerHTML =
      '<div class="head">'
        + '<div class="icon">' + meta.icon + '</div>'
        + '<span class="lock-tag">Sắp ra mắt</span>'
      + '</div>'
      + '<h3>' + meta.name + '</h3>'
      + '<p class="desc">' + meta.desc + '</p>';
    return;
  }

  const formatter = (METRIC_FORMATTERS as Record<string, (s: any) => any>)[skillId];
  if (!formatter) return;
  const m = formatter(data || {});

  const jsVal = card.querySelector('.js-val');
  if (jsVal) {
    // Chế độ VÁ: thẻ đã render sẵn — cập nhật các span dữ liệu tại chỗ. Bản
    // Next luôn đi nhánh này vì vỏ tĩnh đã dựng đủ các hook `.js-*`.
    setStat(jsVal, m.primary.value);
    const jsUnit = card.querySelector('.js-unit');
    if (jsUnit) jsUnit.textContent = m.primary.unit;
    const jsSub = card.querySelector('.js-sub');
    if (jsSub) jsSub.innerHTML = m.sub;
    const jsActivity = card.querySelector('.js-activity');
    if (jsActivity) jsActivity.textContent = formatRelativeTime(data?.last_activity_at);
    const jsCta = card.querySelector('.js-cta');
    if (jsCta) jsCta.textContent = data?.primary_cta || meta.name;
  } else {
    // Chế độ legacy: thẻ skeleton do JS dựng — thay cả innerHTML. Giữ lại để
    // hai bản không rẽ nhánh khác nhau nếu vỏ đổi.
    card.classList.remove('skeleton');
    card.innerHTML =
      '<div class="head">'
        + '<div class="icon">' + meta.icon + '</div>'
        + '<span class="arrow">→</span>'
      + '</div>'
      + '<h3>' + meta.name + '</h3>'
      + '<div class="metric-row">'
        + '<span class="metric">' + m.primary.value + '<span class="unit">' + m.primary.unit + '</span></span>'
      + '</div>'
      + '<div class="sub-metric">' + m.sub + '</div>'
      + '<div class="footer">'
        + '<span class="last-activity">' + formatRelativeTime(data?.last_activity_at) + '</span>'
        + '<span class="cta">' + (data?.primary_cta || meta.name) + '</span>'
      + '</div>';
  }

  if (data?.primary_cta_url) {
    const go = () => { window.location.href = data.primary_cta_url; };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    };
    card.tabIndex = 0;
    card.setAttribute('role', 'link');
    card.setAttribute('aria-label', meta.name + ' — ' + (data.primary_cta || ''));
    card.addEventListener('click', go);
    card.addEventListener('keydown', onKey);
    cleanups.push(() => {
      card.removeEventListener('click', go);
      card.removeEventListener('keydown', onKey);
    });
  }
}

function renderError(msg: string) {
  const banner = $('error-banner');
  if (banner) {
    banner.textContent = msg;
    banner.classList.remove('hidden');
    banner.hidden = false;
  }
}

/**
 * Dải "Lớp của tôi" — fetch RIÊNG, cố ý không gộp vào home-summary: học viên
 * không thuộc lớp nào (phần lớn, vào bằng mã đại trà) không phải trả giá cho nó,
 * và một lỗi ở đây không được kéo sập lưới kỹ năng. Lỗi thì dải ở yên trạng thái
 * ẩn — hiện "0 bài cần nộp" từ một request chưa từng trả lời là điều DUY NHẤT nó
 * không bao giờ được nói.
 */
async function loadClassStrip(api: any, cancelled: () => boolean) {
  let data: any;
  try {
    // summary=true: dải chỉ đọc một cái tên và hai con số, còn payload đầy đủ
    // mang theo mọi bài học đã publish — không giới hạn, và phình theo những gì
    // giảng viên viết.
    data = await api.get('/api/class/me?summary=true');
  } catch {
    return;                       // ở yên trạng thái ẩn; trang lớp sẽ báo lỗi
  }
  if (cancelled()) return;
  if (!data || !data.has_class) return;

  const p = data.progress;
  const cls = data.class || {};
  const nameEl = $('class-strip-name');
  if (nameEl) nameEl.textContent = cls.name || 'Lớp của tôi';
  const metaEl = $('class-strip-meta');
  if (metaEl) metaEl.textContent = cls.course ? cls.course.name : '';

  // Khối assignments suy giảm nghĩa là ta KHÔNG BIẾT con số. Nói vậy, đừng in
  // ra một con số không ai tính.
  const todoEl = $('class-strip-todo');
  if (todoEl) todoEl.textContent = p ? String(p.todo) : '—';

  const alarm = $('class-strip-alarm') as HTMLElement | null;
  if (alarm) {
    if (p && p.missing > 0) {
      alarm.textContent = p.missing + ' bài quá hạn';
      alarm.style.color = 'var(--av-warning)';
    } else {
      alarm.textContent = '';
    }
  }
  const strip = $('class-strip') as HTMLElement | null;
  if (strip) strip.hidden = false;
}

/**
 * Ô kết quả thi thử đã CÔNG BỐ — port của `public/js/home-mock-tiles.js`.
 *
 * VÌ SAO PORT THAY VÌ NẠP TỆP ĐÓ: bản legacy tự chạy lúc `DOMContentLoaded`.
 * Trên trang legacy thứ tự thẻ script bảo đảm `initSupabase` đã chạy trước;
 * trong Next mọi script ngoài đều `defer` còn script nội tuyến chạy lúc parse,
 * nên nó bắn `/api/mock-exams/my-sittings` TRƯỚC khi phiên sẵn sàng → 401 →
 * `api.js:130` đẩy sang `/login.html` và CẢ TRANG biến mất. Cổng parity authed
 * bắt đúng vậy: `title-mismatch: Trang chủ → Đăng nhập`, 68 phát hiện.
 *
 * Ở đây nó chạy SAU khi `useAuth()` xác nhận đã đăng nhập và `window.api` sẵn
 * sàng, nên không còn cửa sổ nào để bắn request thiếu token.
 *
 * Vẫn best-effort và không chặn: thẻ "bắt đầu thi thử" luôn tự đứng được.
 */
async function renderMockTiles(api: any, cancelled: () => boolean) {
  // Đặt tên `hub` chứ không phải "grid": một biến grid bị phủ định sẽ khiến bộ
  // quét nội dung của Tailwind phát ra một utility important-grid thừa.
  const hub = document.getElementById('mock-hub-grid');
  if (!hub) return;

  // Escaper dùng chung (`window.WC.escapeHtml`, định nghĩa ở api.js) — không
  // thêm escaper riêng cho từng tệp (audit C4).
  const esc = (v: unknown) => {
    const wc = (window as any).WC;
    if (wc && typeof wc.escapeHtml === 'function') return wc.escapeHtml(v);
    return String(v == null ? '' : v).replace(/[&<>"\']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "\'": '&#39;' } as any)[c]);
  };
  const fmtBand = (v: any) => (v == null || v === '' ? '—' : Number(v).toFixed(1));

  let res: any;
  try {
    res = await api.get('/api/mock-exams/my-sittings');
  } catch {
    return;                       // im lặng — thẻ bắt đầu vẫn hiện
  }
  if (cancelled()) return;

  const sittings = (res && res.sittings) || [];
  // Mới công bố trước (endpoint đã xếp mới-nhất-trước).
  sittings.filter((s: any) => s.released).forEach((s: any) => {
    hub.insertAdjacentHTML('beforeend',
      '<a class="mock-result-tile" href="/mock/result?sitting='
        + encodeURIComponent(s.sitting_id) + '">'
      + '<span class="mock-result-tile__band">' + fmtBand(s.overall) + '</span>'
      + '<span class="mock-result-tile__body">'
      + '<span class="mock-result-tile__title">Kết quả: ' + esc(s.code || 'Thi thử') + '</span>'
      + '<span class="mock-result-tile__hint">Xem điểm 4 kỹ năng + chữa bài →</span>'
      + '</span></a>');
  });
}

async function loadHome(api: any, cancelled: () => boolean, cleanups: Array<() => void>) {
  let data: any;
  let permissions: any = null;
  try {
    // Chạy song song — home-summary nặng, permissions rẻ. Lỗi permissions KHÔNG
    // chí mạng: thẻ kỹ năng mặc định render mở khoá và backend vẫn gác thật.
    const results = await Promise.allSettled([
      api.get('/api/student/home-summary'),
      api.get('/api/student/permissions'),
    ]);
    if (cancelled()) return;
    if (results[0].status === 'fulfilled') data = results[0].value;
    else throw results[0].reason;
    // Lời gọi home-summary ở trên chứng minh ta ĐÃ đăng nhập — điều kiện cần để
    // thanh toán một khoản nợ báo-cáo Speaking: POST khi chưa đăng nhập sẽ 401,
    // api.js chuyển hướng về login rồi resolve null, và học viên bị văng ra
    // (Codex review, PR #847). Bắn rồi quên — một lượt thi kẹt không bao giờ
    // được làm chậm trang.
    const debt = (window as any).SpeakingDebt;
    if (debt && typeof debt.retryAll === 'function') debt.retryAll();
    if (results[1].status === 'fulfilled') permissions = results[1].value;
    else console.warn('permissions fetch failed:', results[1].reason);
  } catch (err) {
    console.error('home-summary fetch failed:', err);
    renderError('Không tải được trang chủ. Vui lòng thử lại sau.');
    clearStatLoading('—');   // dừng nhấp nháy; '—' = không có dữ liệu (không phải số 0 gây hiểu lầm)
    return;
  }
  if (!data) return;   // 401 → api.js đã chuyển hướng về login

  renderHero(data);
  SKILLS_ORDER.forEach((id) => renderSkillCard(id, data.skills?.[id], permissions, cleanups));
  // Ô nào đường render không chạm tới (ví dụ kỹ năng không có formatter) thì
  // cũng không còn đang tải — hiện số 0 thật thay vì nhấp nháy mãi mãi.
  clearStatLoading('0');

  // Báo cho <aver-chrome> biết người dùng đã đăng nhập để link vocab trên thanh
  // điều hướng đổi sang /pages/vocabulary.html ngay lập tức — khử cuộc đua khi
  // việc dò phiên bất đồng bộ chưa xong mà người dùng đã bấm.
  const chrome = document.querySelector('aver-chrome') as any;
  if (chrome && typeof chrome.setUser === 'function') {
    chrome.setUser({ name: data.student?.name || 'bạn' });
  }
}

export function HomeBehavior() {
  const { status } = useAuth();
  // Đã chạy cho phiên nào. Đổi tài khoản A→B giữ nguyên status 'signed-in' (chỉ
  // `user` đổi), nên không được dùng cờ "đã init" một lần (review #742).
  const ranRef = useRef(false);

  // Cổng fail-closed (ADR-011): đăng xuất — kể cả refresh hỏng hay bfcache khôi
  // phục sau khi đã thoát — rời trang bằng replace() để nút Back không dựng lại
  // trang riêng tư từ lịch sử. Bản legacy tương ứng: home.html chuyển hướng về
  // login khi không có phiên.
  useEffect(() => {
    if (status === 'signed-out') window.location.replace('/login.html');
  }, [status]);

  useEffect(() => {
    if (status !== 'signed-in' || ranRef.current) return;
    ranRef.current = true;

    let dead = false;
    const cancelled = () => dead;
    const cleanups: Array<() => void> = [];

    (async () => {
      // `api.js` nạp bằng defer nên effect có thể chạy trước nó. Legacy lặp
      // `setTimeout(bootstrap, 30)` vô hạn; ở đây chờ có hạn giờ và báo lỗi ra
      // ngoài nếu quá hạn, để một script hỏng không biến thành trang đứng im.
      const ok = await whenGlobalReady(
        () => typeof (window as any).api?.get === 'function',
        'window.api (home)',
      );
      if (dead) return;
      if (!ok) {
        renderError('Không tải được trang chủ. Vui lòng thử lại sau.');
        clearStatLoading('—');
        return;
      }
      const api = (window as any).api;
      // Bắn ở đây, KHÔNG nằm trong loadHome(): /api/student/home-summary là một
      // endpoint không liên quan, và treo dải lớp vào thành công của nó từng làm
      // một lỗi ở đó cướp mất đường duy nhất tới trang lớp của học viên.
      loadClassStrip(api, cancelled);
      renderMockTiles(api, cancelled);
      await loadHome(api, cancelled, cleanups);
    })();

    return () => {
      dead = true;
      cleanups.forEach((fn) => fn());
    };
  }, [status]);

  return null;
}
