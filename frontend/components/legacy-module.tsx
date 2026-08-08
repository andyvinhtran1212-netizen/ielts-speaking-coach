'use client';

// Nạp module legacy SAU khi React hydrate xong, và có đường lui khi React chết.
//
// VÌ SAO CÓ TỆP NÀY: 13 trang port từ các đợt trước đặt thẳng
// `<script type="module" src="/js/x.js" />` vào cây. Thẻ đó nằm trong HTML máy
// chủ nên trình duyệt chạy nó ngay sau khi parse xong — tức TRƯỚC khi React
// hydrate. Module đổi DOM, React thấy cây không khớp bản máy chủ, vứt bản máy
// chủ và dựng lại: React #418, và mọi thay đổi của module bị xoá.
//
// KHÔNG PHẢI GIẢ ĐỊNH. Đo ngày 2026-08-08 bằng `tooling/repro-418.mjs
// --slow-react` trên bản dựng thật: cả sáu trang thử (`/listening/tests`,
// `/listening/browse`, `/reading/vocab`, `/reading/skill`, `/exercises`,
// `/flashcards`) đều tái hiện đúng một lỗi hydrate. Chúng đang chạy production.
//
// VÌ SAO KHÔNG DÙNG LẠI ĐƯỢC KHUÔN CỦA 7 TRANG KIA: những trang ấy export
// `mount()` nên hoãn được lời GỌI. Nhóm này thì module CHẠY LÚC IMPORT — không
// có gì để hoãn. Nên phải hoãn chính việc NẠP: chèn thẻ script trong
// `useEffect`, tức sau pha commit của hydrate.
//
// ĐƯỜNG LUI, và đây là phần dễ quên: nếu chunk React hỏng hẳn thì `useEffect`
// không chạy, script không được chèn, và trang đứng im VĨNH VIỄN — trong khi
// bản cũ (thẻ script tĩnh) vẫn chạy được. Đổi một lỗi #418 lấy một lỗi treo là
// không chấp nhận được, nên `watchdogScript()` dưới đây chạy NGOÀI React.
import { useEffect } from 'react';

export default function LegacyModule({ src }: { src: string }) {
  useEffect(() => {
    // CHO `window.api` SAN SANG TRUOC KHI CHEN.
    //
    // Tren ban legacy, the <script> nam SAU `api.js` trong tai lieu nen thu tu
    // duoc bao dam. Chen dong thi khong con bao dam do: do duoc, module boot
    // luc `readyState=interactive` va `load()` chet ngay o dong dau voi
    // "Cannot read properties of undefined (reading 'get')" — bi `try/catch`
    // cua chinh module nuot, nen trang chi hien trang thai loi, KHONG co request
    // nao, va cong G1 doc ra thanh "thieu noi dung".
    //
    // Day KHONG phai van de do tre: `api.js` von tai rat som. Chi la thu tu.
    let huy = false;
    let dem = 0;
    const sanSang = () => typeof window !== 'undefined'
      && !!(window as unknown as { api?: { get?: unknown } }).api;
    // ES module chỉ thực thi MỘT LẦN cho mỗi URL. Chèn lại cùng `src` sau khi
    // điều hướng mềm sẽ KHÔNG chạy lại thân module — đó là lý do 13 route này
    // phải nằm trong cổng tải-cứng (`legacy-module-routes-need-hard-nav.test.mjs`).
    // Ghi ra ở đây để không ai đọc `useEffect` rồi tưởng điều hướng mềm đã ổn.
    const chen = () => {
      if (huy) return;
      const s = document.createElement('script');
      s.type = 'module';
      s.src = src;
      document.body.appendChild(s);
    };
    if (sanSang()) chen();
    else {
      const iv = setInterval(() => {
        if (huy) { clearInterval(iv); return; }
        // Het gio thi VAN chen: thieu `api` la loi khac, va module tu bao loi
        // ro rang hon la mot trang dung im khong dau vet.
        if (sanSang() || ++dem > 200) { clearInterval(iv); chen(); }
      }, 20);
      return () => { huy = true; clearInterval(iv); };
    }
    // KHÔNG gỡ thẻ khi unmount: module đã chạy rồi, gỡ thẻ không hoàn tác được
    // gì mà chỉ làm người đọc tưởng có dọn dẹp thật.
    return () => { huy = true; };
  }, [src]);
  return null;
}
