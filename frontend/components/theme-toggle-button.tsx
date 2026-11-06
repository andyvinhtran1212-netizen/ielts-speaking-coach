'use client';

import { useEffect, useRef } from 'react';

import { bindToggleButton } from '@/lib/theme-toggle.mjs';
import styles from './theme-toggle-button.module.css';

/**
 * Light/dark toggle for signed-in routes that render their own header
 * (`chrome="none"`), e.g. /instructor. Same markup and behaviour as the
 * button inside <aver-chrome>/<aver-admin-chrome>: `bindToggleButton` flips
 * `[data-theme]`, stores `av-theme` and keeps aria-label/aria-pressed in step.
 * Local only — it sends no request.
 */
export function ThemeToggleButton() {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => bindToggleButton(button.current), []);
  return (
    <button ref={button} className={`av-theme-toggle ${styles.toggle}`} type="button" aria-label="Chuyển giao diện sáng/tối">
      <svg className={`icon-sun ${styles.sun}`} viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
      <svg className={`icon-moon ${styles.moon}`} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    </button>
  );
}
