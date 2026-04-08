document.addEventListener("DOMContentLoaded", () => {
  const backendStatusEl = document.getElementById("backend-status");
  const connectionResultEl = document.getElementById("connection-result");
  const testBackendBtn = document.getElementById("test-backend-btn");
  const googleLoginBtn = document.getElementById("google-login-btn");

  async function checkBackendStatus() {
    try {
      const base = window.api.base;
      const response = await fetch(base + "/health");
      if (!response.ok) throw new Error("Backend not reachable");

      const data = await response.json();
      backendStatusEl.textContent = `Backend: ${data.status}`;
      backendStatusEl.className =
        "text-sm px-3 py-2 rounded-full bg-emerald-100 text-emerald-700";
    } catch (error) {
      backendStatusEl.textContent = "Backend: offline";
      backendStatusEl.className =
        "text-sm px-3 py-2 rounded-full bg-red-100 text-red-700";
    }
  }

  async function testBackend() {
    connectionResultEl.textContent = "Đang kiểm tra backend...";
    try {
      const base2 = window.api.base;
      const [healthRes, topicsRes] = await Promise.all([
        fetch(base2 + "/health"),
        fetch(base2 + "/topics"),
      ]);

      if (!healthRes.ok || !topicsRes.ok) {
        throw new Error("Không gọi được backend");
      }

      const health = await healthRes.json();
      const topics = await topicsRes.json();

      connectionResultEl.innerHTML = `
        <div class="mt-3 p-4 rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200">
          <div class="font-semibold mb-1">Kết nối backend thành công</div>
          <div>Health: ${health.status}</div>
          <div>App: ${health.app}</div>
          <div>Số topics mẫu: ${topics.length}</div>
        </div>
      `;
    } catch (error) {
      connectionResultEl.innerHTML = `
        <div class="mt-3 p-4 rounded-xl bg-red-50 text-red-800 border border-red-200">
          <div class="font-semibold mb-1">Kết nối backend thất bại</div>
          <div>${error.message}</div>
        </div>
      `;
    }
  }

  function handleGoogleLoginClick() {
    alert("Bước tiếp theo mình sẽ nối Supabase Google OAuth ở đây.");
  }

  testBackendBtn?.addEventListener("click", testBackend);
  googleLoginBtn?.addEventListener("click", handleGoogleLoginClick);

  checkBackendStatus();
});
