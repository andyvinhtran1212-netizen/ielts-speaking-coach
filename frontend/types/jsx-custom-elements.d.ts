// Legacy Web Components rendered from React during coexistence (Phase 1+).
// React 19 puts the JSX namespace under the 'react' module.
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'aver-chrome': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        active?: string;
      };
      'aver-admin-chrome': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        active?: string;
      };
    }
  }
}
