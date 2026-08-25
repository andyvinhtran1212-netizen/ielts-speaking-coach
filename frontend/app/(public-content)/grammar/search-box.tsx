'use client';

// Ô tìm kiếm của trang chủ Grammar. Đây là mảnh DUY NHẤT của trang cần chạy
// phía client — legacy cũng chỉ làm đúng một việc: Enter hoặc bấm icon thì
// chuyển sang route kết quả Next canonical.
//
// Giữ nguyên id `search-input` / `search-btn` vì `grammar-wiki.css` bám vào.
import { useState } from 'react';

export function SearchBox() {
  const [q, setQ] = useState('');

  const submit = () => {
    const value = q.trim();
    if (!value) return;
    window.location.assign(`/grammar/search?q=${encodeURIComponent(value)}`);
  };

  return (
    <div className="relative max-w-lg mx-auto mb-8">
      <button
        id="search-btn"
        type="button"
        aria-label="Tìm kiếm"
        onClick={submit}
        className="absolute left-4 top-1/2 -translate-y-1/2 p-1 text-white/30 hover:text-teal-light transition-colors"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0" />
        </svg>
      </button>
      <input
        id="search-input"
        className="search-input pl-12"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="Tìm kiếm: present simple, conditionals, passive voice..."
      />
    </div>
  );
}
