'use client';

import { useEffect } from 'react';

/**
 * Đánh dấu điều đang nằm trong khung nhìn trên mục lục (aria-current
 * "location", kiểu dáng ở `legal.css`). Chọn một mục trong mục lục điện thoại
 * thì khối mục lục đóng lại. Không có IntersectionObserver thì mục lục vẫn là
 * danh sách neo bình thường.
 */
export function LegalTocSpy() {
  useEffect(() => {
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-toc-target]'));
    const mobile = document.querySelector<HTMLDetailsElement>('.lg-toc__mobile');
    const closeMobile = () => { if (mobile) mobile.open = false; };
    links.forEach((link) => link.addEventListener('click', closeMobile));

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      const mark = (id: string) => {
        links.forEach((link) => {
          if (link.dataset.tocTarget === id) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      };
      observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) mark((visible[0].target as HTMLElement).id);
      }, { rootMargin: '0px 0px -70% 0px' });
      document.querySelectorAll<HTMLElement>('.lg-article').forEach((section) => observer!.observe(section));
    }

    return () => {
      links.forEach((link) => link.removeEventListener('click', closeMobile));
      observer?.disconnect();
    };
  }, []);
  return null;
}
