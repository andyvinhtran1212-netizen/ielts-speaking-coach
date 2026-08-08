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
  setTimeout(function () {
    if (window.__averHydrated) return;
    console.error('[aver] React khong hydrate sau 12s - sang ban legacy');
    window.location.replace('${legacyPath}' + window.location.search + window.location.hash);
  }, 12000);
})();
`.trim();
}
