// ProfileShell — VERBATIM transcription of the pages/profile.html <body>
// skeleton (the parity method proven in pilot 2: transcribe the legacy DOM,
// keep every id profile.css/ds.css target, do NOT rebuild from JS templates).
// Server Component fragment — the (authed) layout owns body classes and the
// root layout owns <html>/<body>.
//
// Deliberate deltas from the legacy file (behavior moves to ProfileBehavior):
//   * form onsubmit="return false;"  → submit listener in ProfileBehavior
//   * button onclick="saveProfile()" → click listener in ProfileBehavior
export function ProfileShell() {
  return (
    <>
      {/* Canonical chrome (Sprint 7.13 — <aver-chrome>; home active). */}
      <aver-chrome active="home"></aver-chrome>

      {/* ─── MAIN ─────────────────────────────────────────────────── */}
      <main className="av-w-read pt-16 pb-10 space-y-6">
        {/* Page title */}
        <div>
          <p className="eyebrow">Hồ sơ</p>
          <h1 className="pf-title text-xl font-bold tracking-tight">Hồ sơ học viên</h1>
          <p className="pf-subtitle text-sm mt-1">Cập nhật thông tin và mục tiêu luyện thi của bạn.</p>
        </div>

        {/* ── IDENTITY CARD ─────────────────────────────────────── */}
        <div className="card p-6 flex items-center gap-5">
          <div
            id="profile-avatar"
            className="pf-avatar w-16 h-16 rounded-full flex-shrink-0 flex items-center justify-center text-xl font-bold"
          >
            <span id="profile-initials">—</span>
            <img id="profile-avatar-img" className="hidden w-full h-full object-cover rounded-full" alt="avatar" />
          </div>
          <div className="flex-1 min-w-0">
            <p id="profile-display-name" className="pf-identity__name font-semibold text-base truncate">—</p>
            <p id="profile-email" className="pf-identity__email text-sm mt-0.5 truncate">—</p>
            <p className="pf-identity__joined text-xs mt-1">
              Tham gia: <span id="profile-joined">—</span>
            </p>
          </div>
        </div>

        {/* ── STATS (readonly) ───────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-3">
          <div className="stat-card">
            <p className="stat-card__label text-xs mb-1">Tổng sessions</p>
            <p id="stat-sessions" className="stat-card__value text-2xl font-bold">—</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label text-xs mb-1">Band trung bình</p>
            <p id="stat-avg-band" className="stat-card__value text-2xl font-bold">—</p>
          </div>
          <div className="stat-card">
            <p className="stat-card__label text-xs mb-1">Mục tiêu/tuần</p>
            <p id="stat-weekly" className="stat-card__value text-2xl font-bold">—</p>
          </div>
        </div>

        {/* ── LEARNING FORM ──────────────────────────────────────── */}
        <form id="profile-form" className="card p-6 space-y-6">
          <h2 className="pf-section-title text-sm font-semibold">Thông tin cá nhân</h2>

          {/* Display name */}
          <div>
            <label className="field-label" htmlFor="inp-display-name">Tên hiển thị</label>
            <input
              id="inp-display-name"
              type="text"
              className="field-input"
              maxLength={100}
              placeholder="Nhập tên của bạn…"
            />
          </div>

          {/* Email (readonly) */}
          <div>
            <label className="field-label" htmlFor="inp-email">Email</label>
            <input id="inp-email" type="email" className="field-input" readOnly />
          </div>

          <hr className="pf-divider" />
          <h2 className="pf-section-title text-sm font-semibold">Mục tiêu luyện thi</h2>

          {/* Target band */}
          <div>
            <label className="field-label">Band mục tiêu</label>
            <div id="band-btns" className="flex gap-1.5">
              {/* rendered by ProfileBehavior */}
            </div>
          </div>

          {/* Exam date */}
          <div>
            <label className="field-label" htmlFor="inp-exam-date">Ngày thi dự kiến</label>
            <input id="inp-exam-date" type="date" className="field-input" />
          </div>

          {/* Self level */}
          <div>
            <label className="field-label">Trình độ hiện tại</label>
            <div className="grid grid-cols-2 gap-2" id="level-options">
              <label className="level-card" data-level="beginner">
                <input type="radio" name="self_level" value="beginner" />
                <p className="level-card__title text-sm font-semibold">Mới bắt đầu</p>
                <p className="level-card__band text-xs mt-0.5">Band 3.0–4.5</p>
              </label>
              <label className="level-card" data-level="intermediate">
                <input type="radio" name="self_level" value="intermediate" />
                <p className="level-card__title text-sm font-semibold">Trung bình</p>
                <p className="level-card__band text-xs mt-0.5">Band 5.0–5.5</p>
              </label>
              <label className="level-card" data-level="upper_intermediate">
                <input type="radio" name="self_level" value="upper_intermediate" />
                <p className="level-card__title text-sm font-semibold">Khá</p>
                <p className="level-card__band text-xs mt-0.5">Band 6.0–6.5</p>
              </label>
              <label className="level-card" data-level="advanced">
                <input type="radio" name="self_level" value="advanced" />
                <p className="level-card__title text-sm font-semibold">Nâng cao</p>
                <p className="level-card__band text-xs mt-0.5">Band 7.0+</p>
              </label>
            </div>
          </div>

          {/* Weekly goal slider */}
          <div>
            <label className="field-label" htmlFor="inp-weekly-goal">
              Mục tiêu luyện tập — <span id="goal-display" className="pf-goal__value">5</span> sessions/tuần
            </label>
            <input id="inp-weekly-goal" type="range" min={1} max={14} defaultValue={5} className="goal-slider" />
            <div className="pf-goal__scale flex justify-between text-xs mt-1">
              <span>1</span><span>7</span><span>14</span>
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center justify-end gap-4 pt-2">
            <button type="button" className="btn-save" id="btn-save">
              Lưu thay đổi
            </button>
          </div>
        </form>
      </main>

      {/* Toast */}
      <div id="toast" className="pf-toast">✓ Đã lưu thành công</div>
    </>
  );
}
