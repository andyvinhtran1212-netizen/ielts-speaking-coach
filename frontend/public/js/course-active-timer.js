/**
 * Đồng hồ thời gian hoạt động cho một phần bài tập.
 *
 * Module bài tập được load từ lúc bootstrap nhưng chỉ được tính giờ khi màn
 * của nó thực sự hiện. `setActive` có thể gọi lặp lại an toàn; khi tab ẩn,
 * CourseBehavior tạm dừng rồi tiếp tục đúng phần đang mở lúc tab hiện lại.
 */
export function createActiveTimer(now = () => Date.now()) {
  let elapsedMs = 0;
  let activeSince = null;

  const stamp = () => {
    const value = Number(now());
    return Number.isFinite(value) ? value : 0;
  };

  return {
    setActive(active) {
      const at = stamp();
      if (active && activeSince == null) activeSince = at;
      if (!active && activeSince != null) {
        elapsedMs += Math.max(0, at - activeSince);
        activeSince = null;
      }
    },
    reset() {
      const wasActive = activeSince != null;
      elapsedMs = 0;
      activeSince = wasActive ? stamp() : null;
    },
    seconds() {
      const liveMs = activeSince == null ? 0 : Math.max(0, stamp() - activeSince);
      return Math.max(0, Math.round((elapsedMs + liveMs) / 1000));
    },
  };
}
