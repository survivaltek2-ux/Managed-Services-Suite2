/**
 * Partner Portal Login — redirect shell.
 * All login is now handled by the unified /login page.
 * This component performs an immediate redirect so existing bookmarks to
 * /partners/login continue to work.
 */
import { useEffect } from "react";

export default function Login() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get("sso_error");
    const ssoCode = params.get("sso_code");

    // Legacy SSO code from the old partner-only callback: exchange it and forward
    if (ssoCode) {
      fetch("/api/sso/exchange-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ssoCode }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.token) {
            localStorage.setItem("partner_token", data.token);
          }
          window.location.href = "/partners/dashboard";
        })
        .catch(() => {
          window.location.href = `/login?redirect=/partners/${ssoError ? `&sso_error=${encodeURIComponent(ssoError)}` : ""}`;
        });
      return;
    }

    // Build redirect to central login page, preserving any SSO error
    const loginUrl = new URL("/login", window.location.origin);
    loginUrl.searchParams.set("redirect", "/partners/");
    if (ssoError) loginUrl.searchParams.set("sso_error", ssoError);
    window.location.replace(loginUrl.toString());
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-sm text-slate-500">Redirecting to sign in…</div>
    </div>
  );
}
