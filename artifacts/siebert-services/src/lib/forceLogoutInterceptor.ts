/**
 * Global fetch interceptor — Task #187.
 *
 * The API server returns `{ force_logout: true, error: "..." }` (HTTP 401)
 * when an active session is revoked or its underlying Azure AD identity has
 * lost access. This interceptor catches that signal, wipes the local token,
 * and bounces the user to the portal landing page so they can sign in again.
 */
let installed = false;

const TOKEN_KEYS = ["siebert_token"];

export function installForceLogoutInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (response.status !== 401) return response;

    let payload: any = null;
    try {
      payload = await response.clone().json();
    } catch {
      return response;
    }
    if (!payload || payload.force_logout !== true) return response;

    for (const key of TOKEN_KEYS) {
      try { localStorage.removeItem(key); } catch { /* noop */ }
    }
    const code = typeof payload.error === "string" && payload.error
      ? payload.error
      : "session_revoked";
    const base = (import.meta as any).env?.BASE_URL || "/";
    const target = `${base.replace(/\/+$/, "")}/portal?sso_error=${encodeURIComponent(code)}`;
    window.location.replace(target);
    return response;
  };
}
