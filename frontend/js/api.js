let supabase = null;

function initSupabase(url, anonKey) {
  supabase = window.supabase.createClient(url, anonKey);
}

const API_BASE =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:8000"
    : "https://your-app.railway.app";

async function getAuthToken() {
  if (!supabase) return null;
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function apiRequest(method, path, body = null, isFormData = false) {
  const token = await getAuthToken();
  const headers = {};

  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (!isFormData) headers["Content-Type"] = "application/json";

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: isFormData ? body : body ? JSON.stringify(body) : null,
  });

  if (response.status === 401) {
    window.location.href = "/index.html";
    return null;
  }

  if (!response.ok) {
    let err = {};
    try {
      err = await response.json();
    } catch (_) {}
    throw new Error(err.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

const api = {
  get: (path) => apiRequest("GET", path),
  post: (path, body) => apiRequest("POST", path, body),
  patch: (path, body) => apiRequest("PATCH", path, body),
  delete: (path) => apiRequest("DELETE", path),
  upload: (path, formData) => apiRequest("POST", path, formData, true),
};
