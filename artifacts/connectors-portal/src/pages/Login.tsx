/**
 * Connectors Portal Login — redirect shell.
 * All login is now handled by the unified /login page.
 * This component performs an immediate redirect so existing bookmarks
 * to /referrals/login continue to work.
 */
import { useEffect } from "react";

export default function LoginPage() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoError = params.get("sso_error");

    const loginUrl = new URL("/login", window.location.origin);
    loginUrl.searchParams.set("redirect", "/referrals/");
    if (ssoError) loginUrl.searchParams.set("sso_error", ssoError);
    window.location.replace(loginUrl.toString());
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="text-sm text-slate-500">Redirecting to sign in…</div>
    </div>
  );
}
