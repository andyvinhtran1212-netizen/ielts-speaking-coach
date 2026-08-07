'use client';

// CourseBehavior — phần động của trang làm bài tập theo buổi.
//
// Toàn bộ QUYẾT ĐỊNH nằm ở `public/js/course-runner.js` (module thuần, không
// chạm DOM, có bộ test chạy thật). Tệp này chỉ VẼ và nối sự kiện. Tách như vậy
// vì phần dễ sai của tính năng là vòng đời phiên làm bài, và một bộ test khớp
// chuỗi trong tệp render không chứng minh được gì về nó.
//
// Auth đi qua useAuth() (ADR-011) thay vì tự gọi getSession(), và `window.api`
// được layout (authed) khởi tạo ở DOMContentLoaded — trang legacy trước đó gọi
// `initSupabase` bằng một thẻ script nội tuyến chạy TRƯỚC cả SDK `defer`, nên
// nó ném lỗi và mọi request đi không kèm token.
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth/auth-provider';

const API_READY_TIMEOUT_MS = 10_000;

function waitForApi(): Promise<any | null> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const tick = () => {
      const api = (window as any).api;
      if (api && typeof api.get === 'function') return resolve(api);
      if (performance.now() - startedAt > API_READY_TIMEOUT_MS) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export function CourseBehavior() {
  const { status, user } = useAuth();
  // Khoá theo ID người dùng, KHÔNG dùng cờ "đã chạy một lần": đổi tài khoản giữa
  // hai tab giữ nguyên status 'signed-in' và chỉ `user` đổi, nên một cờ một-lần
  // sẽ để nguyên tiến độ của người trước trên màn hình (review #742).
  const bootedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'signed-in' || !user?.id) return;
    if (bootedFor.current === user.id) return;
    bootedFor.current = user.id;

    let runner: any = null;
    let onClick: ((e: Event) => void) | null = null;
    let onLeave: (() => void) | null = null;
    let onInput: ((e: Event) => void) | null = null;
    let onHide: (() => void) | null = null;

    (async () => {
      const [{ createRunner, splitStem, md, esc, KEYS, DANG }, CW, CR, api] = await Promise.all([
        import(/* webpackIgnore: true */ '/js/course-runner.js' as any),
        import(/* webpackIgnore: true */ '/js/course-writing.js' as any),
        // Bộ vẽ báo cáo — CHUNG với mặt đọc của giáo viên.
        import(/* webpackIgnore: true */ '/js/course-report.js' as any),
        waitForApi(),
      ]);

      const $ = (id: string) => document.getElementById(id);
      const fail = (msg: string) => {
        const l = $('cx-loading'); if (l) l.hidden = true;
        const e = $('cx-error'); if (e) { e.hidden = false; e.textContent = msg; }
      };

      if (!api) return fail('Không tải được thành phần kết nối. Hãy tải lại trang.');

      const bankId = new URLSearchParams(location.search).get('bank');
      if (!bankId) return fail('Thiếu mã bài tập trên đường dẫn (?bank=…).');

      runner = createRunner({ api, storage: window.localStorage });
      try {
        await runner.load(bankId);
      } catch (err: any) {
        return fail('Không mở được bài tập: ' + (err?.message || err));
      }

      // Phần tự luận nạp RIÊNG và không chặn phần trắc nghiệm: nó chỉ cần thiết
      // khi học viên đã đi hết các chặng, còn một lỗi ở đây không được làm cả
      // bài tập không mở được.
      const writing = CW.createWriting({
        api, storage: window.localStorage,
        // localStorage là bộ nhớ CHUNG của trình duyệt: hai học viên dùng chung
        // một máy mà khoá nháp chỉ theo bank sẽ mở ra bài của nhau.
        userId: user.id,
      });
      let writingReady = false;
      // Giữ LỜI HỨA, không chỉ một cờ. Màn kết luận có thể vẽ TRƯỚC khi lượt
      // nạp này xong (khôi phục từ localStorage, hoặc mạng chậm) — lúc ấy một
      // cờ `false` làm nút "Làm phần tự luận" biến mất vĩnh viễn cho tới khi
      // học viên tự tải lại trang và thắng cuộc đua (codex #935).
      const writingLoaded = writing.load(bankId)
        .then(() => { writingReady = true; })
        .catch(() => { writingReady = false; });

      // ── Vẽ ──────────────────────────────────────────────────────────────
      const dots = (n: number) => {
        let out = '';
        for (let i = 1; i <= 3; i++) out += `<i${i <= (n || 1) ? ' data-on' : ''}></i>`;
        return `<span class="cx-level" aria-label="Mức ${n || 1} trên 3">${out}</span>`;
      };

      function renderStage() {
        const qs = runner.stageQuestions();
        const marks = runner.marks;
        const el = $('cx-stage'); if (el) el.hidden = false;
        // Bài kiểm tra lại KHÔNG phải "chặng 11": gọi tên nó ra để học viên
        // biết mình đang ở đâu và vì sao chỉ có một chặng.
        $('cx-stage-label')!.innerHTML = runner.mode === 'retake'
          ? `${esc(runner.bank.title)} · <strong>kiểm tra lại · lần ${runner.retakeNo}</strong>`
          : `${esc(runner.bank.title)} · chặng <strong>${runner.stage + 1}/${runner.stageCount}</strong>`
            + (runner.mastery && runner.mastery.passed_at
              ? ' <span class="cx-passbadge">✓ đã đạt</span>' : '');
        $('cx-stage-ticks')!.innerHTML = qs.map((_q: any, i: number) => {
          const s = marks[i] || (i === runner.at ? 'now' : '');
          return `<i${s ? ` data-s="${s}"` : ''}></i>`;
        }).join('');
      }

      function renderQuestion() {
        const q = runner.current();
        if (!q) return renderDone();
        runner.show();
        const { ask, spec } = splitStem(q.prompt);
        const isWrite = q.type === 'writing';

        let body = '<div class="cx-q__head">'
          + `<span class="cx-tag"><b>${esc(q.subtype || '')}</b>${esc(DANG[q.subtype] || '')}</span>`
          + dots(q.points) + '</div>'
          + `<p class="cx-q__ask">${md(ask)}</p>`
          + (spec ? `<div class="cx-spec">${md(spec)}</div>` : '');

        if (isWrite) {
          body += '<textarea class="cx-write" id="cx-write" '
            + 'placeholder="Viết câu trả lời của bạn…" aria-label="Câu trả lời"></textarea>'
            + '<div id="cx-selfcheck"></div>';
        } else {
          body += '<div class="cx-opts" id="cx-opts" role="group">'
            + (q.options || []).map((o: string, i: number) =>
              `<button type="button" class="cx-opt" data-i="${i}">`
              + `<span class="cx-opt__key">${KEYS[i]}</span>`
              + `<span class="cx-opt__body"><span class="cx-opt__text">${md(o)}</span></span>`
              + '</button>').join('')
            + '</div>';
        }
        body += '<div id="cx-why"></div>';

        $('cx-q')!.innerHTML = body;
        $('cx-q')!.hidden = false;
        $('cx-done')!.hidden = true;
        $('cx-next')!.hidden = false;
        $('cx-next')!.innerHTML = isWrite
          ? '<button class="av-button av-button-primary" id="cx-reveal" type="button">Xem đáp án mẫu</button>'
          : '';
        renderStage();
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      }

      function onAnswered(picked: number) {
        const q = runner.current();
        const res = runner.answer(picked);
        if (!res) return;
        document.querySelectorAll('.cx-opt').forEach((node) => {
          const el = node as HTMLButtonElement;
          el.disabled = true;
          const idx = Number(el.dataset.i);
          const role = idx === q.answer
            ? (idx === picked ? 'hit' : 'key')
            : (idx === picked ? 'miss' : 'off');
          el.dataset.r = role;
          // Chỉ ô ĐÃ CHỌN mới nở bẫy. Bung cả bốn dòng là trả bài về đúng chỗ nó
          // bắt đầu: một đống chữ mà học viên phải tự tìm phần nói về mình.
          if (role === 'miss' && res.trap) {
            el.querySelector('.cx-opt__body')!.insertAdjacentHTML('beforeend',
              `<span class="cx-trap"><b>Bẫy ở đây</b>${esc(res.trap)}</span>`);
          }
        });
        $('cx-why')!.innerHTML = `<div class="cx-why">${md(res.explain)}`
          + (q.item_key ? `<span class="cx-why__axis">Trục: ${esc(q.item_key)}</span>` : '')
          + '</div>';
        $('cx-next')!.innerHTML =
          '<button class="av-button av-button-primary" id="cx-go" type="button">Câu tiếp</button>';
        renderStage();
      }

      function onSelfCheck() {
        const res = runner.selfCheck();
        if (!res) return;
        const ta = $('cx-write') as HTMLTextAreaElement | null;
        if (ta) ta.readOnly = true;
        $('cx-selfcheck')!.innerHTML = '<div class="cx-selfcheck">'
          + '<p><strong>Tự đối chiếu.</strong> Câu này không chấm máy — so bài của bạn '
          + 'với đáp án mẫu bên dưới.</p>'
          + md(res.explain).split('\n\n').map((p: string) => `<p>${p}</p>`).join('')
          + '</div>';
        $('cx-next')!.innerHTML =
          '<button class="av-button av-button-primary" id="cx-go" type="button">Câu tiếp</button>';
        renderStage();
      }

      async function renderDone() {
        const res = await runner.finishStage();
        $('cx-q')!.hidden = true;
        $('cx-next')!.hidden = true;
        $('cx-done')!.hidden = false;
        $('cx-done')!.innerHTML =
          `<div class="cx-done__score">${res.right}<small>/ ${res.graded} câu đúng</small></div>`
          + (res.axes.length
            ? '<h2>Sai dồn vào những trục này</h2><ul class="cx-axes">'
              + res.axes.map((a: any) =>
                `<li class="cx-axis"><span>${esc(a.axis)}</span>`
                + `<span class="cx-axis__n">${a.n} câu</span></li>`).join('')
              + '</ul>'
            : '<h2>Không sai câu nào trong chặng này.</h2>')
          // Chặng chưa tới máy chủ thì KHÔNG cho đi tiếp: đi tiếp là mang theo
          // một lỗ không vá được và verdict phủ-đủ-đề sẽ bác cả lượt ở phút
          // chót. Bài làm còn nguyên trong bộ nhớ — gửi lại là một lần thật.
          + (res.persisted ? ''
            : '<p class="cx-empty">Chưa gửi được kết quả chặng này lên hệ thống — '
              + 'bài làm vẫn còn nguyên ở đây. Kiểm tra kết nối rồi gửi lại.</p>'
              + '<div class="cx-next" style="position:static">'
              + '<button class="av-button av-button-primary" id="cx-resend" type="button">'
              + 'Gửi lại kết quả chặng</button></div>')
          + (!res.persisted ? ''
            : res.hasMore
              ? '<div class="cx-next" style="position:static">'
                + `<button class="av-button av-button-primary" id="cx-more" type="button">Làm chặng ${runner.stage + 2}</button></div>`
              : '<div id="cx-verdict"></div>');
        renderStage();
        // Hết lượt (chặng cuối, hoặc xong bài kiểm tra lại) → xét đạt. Sau khi
        // markup ở trên đã vào DOM, vì kết quả vẽ vào #cx-verdict. Chỉ xét khi
        // chặng đã THẬT SỰ tới máy chủ.
        if (res.persisted && !res.hasMore) renderVerdict();
      }

      let lastVerdict: any = null;

      /**
       * Màn kết luận. Ba trạng thái, không trạng thái nào im lặng:
       * đang xét → ĐẠT (chốt bài) → hoặc CHƯA ĐẠT kèm đúng một việc phải làm.
       */
      async function renderVerdict() {
        const box = $('cx-verdict'); if (!box) return;
        box.innerHTML = '<p class="cx-empty">Đang xét kết quả…</p>';
        // Chờ phần tự luận biết mình có gì trước khi vẽ — nút của nó nằm trong
        // chính khối này. Hỏng thì `catch` ở trên đã nuốt, nên không treo.
        await writingLoaded;
        let v: any = null;
        try {
          v = await runner.verdict();
        } catch (err: any) {
          // Xét hỏng KHÔNG được đọc thành "chưa đạt" — đó là hai câu khác nhau.
          box.innerHTML = '<div class="cx-verdict" data-v="wait">'
            + `<p class="cx-verdict__sub">Chưa xét được kết quả: ${esc(err?.message || err)}</p>`
            + '<button class="av-button" id="cx-verdict-retry" type="button">Xét lại</button></div>';
          return;
        }
        lastVerdict = v;
        // Còn phần tự luận thì nói ra — dù đạt hay chưa. Học viên đi hết mười
        // chặng rồi dừng ở đây sẽ không bao giờ biết còn mười câu nữa.
        const more = (writingReady && runner.hasWriting && !writing.submitted)
          ? '<button class="av-button" id="cx-writing" type="button">'
            + `Làm phần tự luận (${runner.writing.length} câu)</button>`
          : (writingReady && writing.submitted
              ? '<button class="av-button" id="cx-writing" type="button">Xem phần tự luận đã chấm</button>'
              : '');
        // XEM LẠI BÀI CHỈ MỞ SAU KHI ĐÃ ĐẠT.
        //
        // Màn này phát ra đáp án đúng của từng câu kèm lời giải, mà kỳ kiểm tra
        // lại bốc mẫu từ chính bộ câu ấy. Mở trước khi đạt là đưa trọn bộ đáp án
        // cho một em sắp phải làm lại — và "đạt" sau đó không còn nghĩa gì.
        //
        // Đây là ĐỔI so với trước: bản cũ mở báo cáo ở cả hai kết luận, kể cả
        // khi chưa đạt. Máy chủ cũng chặn (`locked`), nên nút này chỉ là lớp
        // ngoài — bỏ nút đi vẫn không đọc được.
        // HAI MỨC, nên nút mở ở CẢ HAI kết luận — chỉ khác nó dẫn tới đâu.
        //
        // Chưa đạt: máy chủ cắt phần lộ đáp án và chỉ trả trục. Em chưa đạt
        // mới là em cần biết mình yếu chỗ nào nhất; khoá cả hai mức là sai
        // chiều (bản #964 khoá cả hai).
        const seeReport = '<button class="av-button" id="cx-see-report" type="button">'
          + (v.passed ? 'Xem lại toàn bộ bài làm' : 'Xem mình yếu trục nào')
          + '</button>';
        if (v.passed) {
          box.innerHTML = '<div class="cx-verdict" data-v="pass">'
            + '<p class="cx-verdict__title">Đã ĐẠT bài tập buổi này</p>'
            + `<p class="cx-verdict__sub">Điểm gộp <strong>${v.pct}%</strong> · ngưỡng ${v.threshold}%`
            + (v.retakes ? ` · chốt ở lần kiểm tra lại thứ ${v.retakes}` : '')
            + '</p>' + seeReport + more + '</div>';
        } else {
          box.innerHTML = '<div class="cx-verdict" data-v="fail">'
            + `<p class="cx-verdict__title">Chưa đạt: ${v.pct}% — cần ${v.threshold}%</p>`
            + `<p class="cx-verdict__sub">Làm bài kiểm tra lại để chốt buổi này: ${v.retake_size} câu `
            + 'bốc ngẫu nhiên từ bộ đề, thứ tự câu và thứ tự đáp án được trộn lại — '
            + 'thuộc vị trí không giúp gì đâu.</p>'
            + '<button class="av-button av-button-primary" id="cx-retake" type="button">'
            + `Làm kiểm tra lại (${v.retake_size} câu)</button>` + seeReport + more + '</div>';
        }
      }

      /**
       * Báo cáo: yếu trục nào, sai câu nào, chọn nhầm phương án nào.
       *
       * Nạp LÚC CẦN, không nạp sẵn: phần lớn lượt mở bài tập là để LÀM bài, và
       * một lượt gọi mạng lúc mở trang làm chậm đúng thứ học viên đang chờ.
       */
      async function showReport() {
        const box = $('cx-report');
        if (!box) return;
        box.hidden = false;
        box.innerHTML = '<p class="cx-empty">Đang dựng báo cáo…</p>';
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try {
          const d = await api.get('/api/quiz/course/report?bank_id='
            + encodeURIComponent(bankId!));
          // `renderReport` tự biết `d.locked`: nó vẽ trục và nói điều kiện mở
          // mức hai. Không cần nhánh riêng ở đây.
          box.innerHTML = CR.renderReport(d);
          CR.bindReport(box);
        } catch (err: any) {
          // Rỗng đọc ra là "em chưa làm câu nào" — một khẳng định mà lượt đọc
          // hỏng không chứng minh được.
          box.innerHTML = '<p class="cx-empty">Chưa đọc được báo cáo: '
            + esc(err?.message || String(err)) + '. Tải lại trang để thử lại.</p>';
        }
      }

      /** Màn TỰ LUẬN — cả cụm một lần, nộp một lần. */
      function renderWriting() {
        $('cx-q')!.hidden = true;
        $('cx-next')!.hidden = true;
        const done = $('cx-done')!;
        done.hidden = false;
        // Mở lại màn viết thì về BƯỚC MỘT. "Đã đọc lại rồi" là chuyện của lượt
        // ngồi trước màn hình vừa xong; quay lại sau khi đi xem chỗ khác mà vẫn
        // thấy nút "Nộp luôn" chờ sẵn là dựng lại đúng cú bấm-một-nhát.
        writing.disarm();
        done.innerHTML = writing.submitted ? writing.renderResult() : writing.renderForm();
        if (!writing.submitted) syncWritingNote();
        const st = $('cx-stage'); if (st) st.hidden = true;
        window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      }

      // Vẽ lại CẢ thanh nộp, không chỉ dòng chữ: nút và trạng thái tắt/bật nằm
      // trong cùng một khối do module dựng, nên hai bên không thể lệch nhau.
      function syncWritingNote() {
        const bar = $('cw-bar');
        if (bar) bar.innerHTML = writing.renderBar();
      }

      /** Bấm Nộp lần đầu: chỉ tay chỗ còn thiếu, hoặc sang bước xác nhận. */
      function onWritingArm() {
        const miss = writing.missing;
        if (miss.length) {
          // Đánh dấu ĐÚNG những ô còn trống rồi nhảy tới ô đầu tiên.
          miss.forEach((qid: string) => {
            const el = document.getElementById('cw-' + qid);
            if (el) el.dataset.missing = 'true';
          });
          document.getElementById('cw-' + miss[0])?.scrollIntoView({ block: 'center' });
          syncWritingNote();
          return;
        }
        writing.arm();
        syncWritingNote();
        // Con trỏ về nút AN TOÀN, không về nút nộp: bàn phím Enter hai lần liên
        // tiếp không được biến bước xác nhận thành một thủ tục bấm cho xong.
        ($('cw-cancel') as HTMLButtonElement | null)?.focus();
      }

      async function onWritingSubmit() {
        const btn = $('cw-confirm') as HTMLButtonElement | null;
        if (!writing.armed) return onWritingArm();
        if (btn) { btn.disabled = true; btn.textContent = 'Đang chấm…'; }
        try {
          await writing.submit();
        } catch (err: any) {
          if (btn) { btn.disabled = false; btn.textContent = 'Nộp luôn'; }
          const note = $('cw-note');
          if (note) {
            // 422 của server mang `message` nói rõ chuyện gì (thiếu câu / câu
            // quá dài). Hiện nguyên câu ấy, đừng đắp một câu chung chung lên
            // trên — học viên cần biết PHẢI SỬA GÌ.
            const d = err && err.detail;
            const why = (d && typeof d === 'object' && d.message)
              ? d.message : (err?.message || err);
            note.textContent = 'Chưa nộp được: ' + why
              + ' Bài viết của bạn vẫn còn ở đây.';
          }
          return;
        }
        renderWriting();
      }

      async function startRetakeFlow() {
        // DỌN báo cáo cũ trước khi làm lại.
        //
        // Nó nói "chi tiết từng câu còn khoá". Làm kiểm tra lại rồi ĐẠT thì
        // dòng ấy sai, nhưng nó nằm ở một khung khác nên không ai vẽ lại — màn
        // hình vừa nói "Đã ĐẠT" vừa nói "còn khoá" (codex #968). Dọn ở ĐÂY chứ
        // không đợi lúc đạt: lượt làm lại có thể lại chưa đạt, và giữ một bảng
        // trục của lượt TRƯỚC cũng là nói sai.
        const rep = $('cx-report');
        if (rep) { rep.hidden = true; rep.innerHTML = ''; }
        const size = (lastVerdict && lastVerdict.retake_size)
          || (runner.mastery && runner.mastery.retake_size) || 20;
        await runner.startRetake(size);
        renderQuestion();
      }

      const l = $('cx-loading'); if (l) l.hidden = true;
      if (runner.sessionFailed) {
        const e = $('cx-error');
        if (e) {
          e.hidden = false;
          e.textContent = 'Không kết nối được để lưu bài. Bạn vẫn làm được, nhưng kết '
            + 'quả sẽ KHÔNG tới giáo viên — tải lại trang để thử lại.';
        }
      }
      // Bank CHỈ có câu tự luận: không có chặng nào để chạy, và một phiên quiz
      // rỗng sẽ bị cổng xét đạt bác vì bộ đề không có câu trắc nghiệm nào
      // (codex #935). Vào thẳng màn tự luận.
      if (!runner.total && runner.hasWriting) {
        await writingLoaded;
        renderWriting();
      } else if (runner.isStageDone()) renderDone(); else renderQuestion();

      // Uỷ quyền: nội dung được vẽ lại sau mỗi câu, nên gắn tay từng nút sẽ mất
      // ngay ở lần vẽ kế tiếp.
      onClick = (e: Event) => {
        const t = e.target as HTMLElement;
        const opt = t.closest?.('.cx-opt') as HTMLButtonElement | null;
        if (opt && !opt.disabled) return onAnswered(Number(opt.dataset.i));
        if (t.id === 'cx-go') { runner.next(); return renderQuestion(); }
        if (t.id === 'cx-reveal') return onSelfCheck();
        if (t.id === 'cx-more') return runner.nextStage().then(renderQuestion);
        if (t.id === 'cx-retake') return void startRetakeFlow();
        if (t.id === 'cx-verdict-retry') return void renderVerdict();
        // Gửi lại = chạy lại đúng finishStage: sessionId + hàng đợi còn nguyên,
        // nên đây là một lần đẩy thật chứ không phải vẽ lại màn hình.
        if (t.id === 'cx-resend') return void renderDone();
        if (t.id === 'cx-see-report') return void showReport();
        if (t.id === 'cx-writing') return renderWriting();
        // Hai nút, hai việc: `cw-submit` mở bước xác nhận, `cw-confirm` mới nộp
        // thật. Dùng chung một id cho cả hai là dựng lại đúng cú bấm-một-nhát.
        if (t.id === 'cw-submit') return onWritingArm();
        if (t.id === 'cw-cancel') { writing.disarm(); return syncWritingNote(); }
        if (t.id === 'cw-confirm') return void onWritingSubmit();
      };
      document.addEventListener('click', onClick);

      // Lưu nháp NGAY khi gõ: mười ô nhập là một buổi ngồi viết, và mất nó vì
      // một lần lỡ tay đóng tab thì học viên sẽ không viết lại lần hai.
      onInput = (e: Event) => {
        const el = e.target as HTMLTextAreaElement;
        if (!el || !el.classList || !el.classList.contains('cw-write')) return;
        writing.write(el.dataset.qid, el.value);
        const card = el.closest('.cw-item') as HTMLElement | null;
        if (card && el.value.trim()) card.dataset.missing = 'false';
        syncWritingNote();
      };
      document.addEventListener('input', onInput);

      // Đẩy nốt lượt làm khi rời trang. `pagehide` KHÔNG đủ trên điện thoại —
      // chuyển sang app khác hay khoá màn hình thường chỉ bắn `visibilitychange`,
      // và học viên ở đây chủ yếu dùng điện thoại. Bỏ lỡ mốc ấy là bỏ lỡ đúng
      // lúc cần đẩy: những câu chưa tới máy chủ thì mở lại KHÔNG khôi phục được.
      // Rời trang: đẩy nốt CẢ lượt làm trắc nghiệm LẪN nháp tự luận. Bỏ sót vế
      // thứ hai thì đoạn học viên vừa gõ chỉ còn trong trình duyệt này.
      onLeave = () => { runner.leave(); writing.flushDraft(); };
      onHide = () => {
        if (document.visibilityState === 'hidden') { runner.leave(); writing.flushDraft(); }
      };
      window.addEventListener('pagehide', onLeave);
      document.addEventListener('visibilitychange', onHide);
    })();

    return () => {
      if (onClick) document.removeEventListener('click', onClick);
      if (onInput) document.removeEventListener('input', onInput);
      if (onLeave) window.removeEventListener('pagehide', onLeave);
      if (onHide) document.removeEventListener('visibilitychange', onHide);
    };
  }, [status, user?.id]);

  return null;
}
