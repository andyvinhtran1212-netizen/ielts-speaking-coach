// Script CHỜ CHẾT — module THUẦN, cố ý KHÔNG `'use client'`.
//
// Nó phải nằm ngoài `components/legacy-module.tsx`: tệp đó khai `'use client'`,
// và một server component KHÔNG gọi được hàm export từ module client
// ("Attempted to call watchdogScript() from the server"). Bản đầu tôi để chung
// và build đỏ ngay ở bước prerender.
/**
 * Script CHỜ CHẾT, chạy ngoài React.
 *
 * Nó phải nằm ngoài React vì đúng ca nó phục vụ là ca React không chạy. Nó
 * KHÔNG đụng DOM — chỉ điều hướng — nên bản thân nó không thể gây ra #418.
 *
 * KHÔNG tự chèn script legacy khi hết giờ: React chỉ CHẬM thôi thì làm vậy là
 * dựng lại đúng cuộc đua vừa sửa. Sang hẳn bản legacy, giữ nguyên query/hash.
 */
export function watchdogScript(legacyPath: string): string {
  return `
(function () {
  // Dem TU LUC su kien load, khong tu luc parse. Mot dem co dinh tinh tu dau se bao
  // gom ca thoi gian TAI - tren 3G nguoi dung con dang tai binh thuong thi da
  // bi da sang legacy, mat luon nhung gi ho vua chon tren form SSR (codex #1004).
  var chay = function () {
    setTimeout(function () {
      if (window.__averHydrated) return;
      console.error('[aver] React khong hydrate sau 20s ke tu load - sang ban legacy');
      window.location.replace(${JSON.stringify(legacyPath)} + window.location.search + window.location.hash);
    }, 20000);
  };
  if (document.readyState === 'complete') chay();
  else window.addEventListener('load', chay, { once: true });
})();
`.trim();
}
