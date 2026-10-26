'use client';

import { usePathname } from 'next/navigation';
import { useLayoutEffect } from 'react';

const ENGLISH_EXAM_ROUTES = new Set([
  '/reading/exam/session', '/listening/test/session', '/mock-exam',
]);

export function ExamLanguageBridge() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    if (!pathname || !ENGLISH_EXAM_ROUTES.has(pathname.replace(/\/$/, ''))) return;
    const root = document.documentElement;
    const previous = root.getAttribute('lang');
    root.lang = 'en';
    return () => {
      if (previous === null) root.removeAttribute('lang');
      else root.setAttribute('lang', previous);
    };
  }, [pathname]);

  return null;
}
