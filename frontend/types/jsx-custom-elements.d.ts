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
        subsection?: string;
        embed?: string;
      };
      'audio-player': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        'duration-hint'?: string | number;
        'refetch-url'?: string;
        'segment-start'?: string | number;
        'segment-end'?: string | number;
        compact?: string;
      };
    }
  }
}
