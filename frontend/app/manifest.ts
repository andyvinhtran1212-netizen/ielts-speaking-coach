import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Aver Learning — IELTS Practice',
    short_name: 'Aver Learning',
    description:
      'Luyện IELTS Speaking, Writing, Reading, Listening, Grammar và Từ vựng trên một nền tảng.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f8f7',
    theme_color: '#0f766e',
    lang: 'vi',
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ],
  };
}
