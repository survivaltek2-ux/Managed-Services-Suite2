/**
 * Global fetch interceptor — Task #187.
 *
 * The API server returns `{ force_logout: true, error: "..." }` (HTTP 401)
 * when an active session is revoked or its underlying Azure AD identity has
 * lost access. This interceptor catches that signal anywhere in the app,
 * wipes the local token, and bounces the user to the login page with the
 * server's error code preserved as `?sso_error=…` so Login.tsx can render
 * a friendly message.
 */
let installed = false;

const TOKEN_KEYS = ["partner_token", "token"];

export function installForceLogoutInterceptor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await originalFetch(input, init);
    if (response.status !== 401) return response;

    // Inspect a clone so callers still see the original body.
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
    const target = `${base.replace(/\/+$/, "")}/login?sso_error=${encodeURIComponent(code)}`;
    if (window.location.pathname !== `${base.replace(/\/+$/, "")}/login`) {
      window.location.replace(target);
    }
    return response;
  };
}
