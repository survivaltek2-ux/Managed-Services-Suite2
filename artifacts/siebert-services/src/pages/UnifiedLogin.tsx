import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { broadcastLogin } from "@/lib/sso-sync";
import { AlertCircle, ArrowRight, Building2, KeyRound } from "lucide-react";

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

const SSO_ERROR_MESSAGES: Record<string, string> = {
  sso_not_configured: "Microsoft sign-in is not available right now. Please use email and password.",
  access_denied: "Sign-in was cancelled. Please try again.",
  token_failed: "Could not complete sign-in. Please try again.",
  profile_failed: "Could not retrieve your profile. Please try again.",
  wrong_tenant: "Your Microsoft account belongs to an unauthorized organization.",
  no_email: "Could not retrieve your email from Microsoft. Please try again.",
  not_authorized: "Your account isn't authorized for this portal. Contact your administrator.",
  azure_unreachable: "We can't reach the directory right now. Please try again in a few minutes.",
  invalid_state: "Sign-in session expired. Please try again.",
  csrf_check_failed: "Security check failed. Please try again.",
};

function getRedirectParam(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("redirect") || "";
}

async function exchangeSsoCode(code: string): Promise<string | null> {
  try {
    const res = await fetch("/api/sso/exchange-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    return data.token ?? null;
  } catch {
    return null;
  }
}

export default function UnifiedLogin() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  // Handle SSO codes in query string (from Microsoft OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoCode = params.get("sso_code");
    const partnerSsoCode = params.get("partner_sso_code");
    const connectorSsoCode = params.get("connector_sso_code");
    const ssoError = params.get("sso_error");
    const redirectTo = params.get("redirect") || "";

    if (ssoError) {
      setError(SSO_ERROR_MESSAGES[ssoError] ?? "Sign-in failed. Please try again.");
      window.history.replaceState({}, "", window.location.pathname + (redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : ""));
      return;
    }

    if (ssoCode || partnerSsoCode || connectorSsoCode) {
      // Strip codes from URL immediately
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (redirectTo ? `?redirect=${encodeURIComponent(redirectTo)}` : "")
      );
      setExchanging(true);

      // Exchange all codes in parallel
      Promise.all([
        ssoCode ? exchangeSsoCode(ssoCode) : Promise.resolve(null),
        partnerSsoCode ? exchangeSsoCode(partnerSsoCode) : Promise.resolve(null),
        connectorSsoCode ? exchangeSsoCode(connectorSsoCode) : Promise.resolve(null),
      ]).then(async ([userToken, partnerToken, connectorToken]) => {
        if (!userToken && !partnerToken && !connectorToken) {
          setError("Sign-in failed. Please try again.");
          setExchanging(false);
          return;
        }

        // Store tokens for this portal's auth state
        if (userToken) {
          // Fetch user data to populate auth context
          const meRes = await fetch("/api/auth/me", {
            headers: { Authorization: `Bearer ${userToken}` },
          }).catch(() => null);
          const userData = meRes?.ok ? await meRes.json() : null;
          if (userData) login(userToken, userData);
        }

        // Broadcast all tokens to other portals
        broadcastLogin({
          userToken: userToken ?? null,
          partnerToken: partnerToken ?? null,
          connectorToken: connectorToken ?? null,
        });

        setExchanging(false);

        // Determine where to redirect
        const destination = redirectTo || (userToken ? "/portal" : partnerToken ? "/partners/" : "/referrals/");
        window.location.href = destination;
      }).catch(() => {
        setError("Sign-in failed. Please try again.");
        setExchanging(false);
      });
    }
  }, [login]);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const redirectTo = getRedirectParam();
      const res = await fetch("/api/auth/unified-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setError(data.message || "Invalid email or password.");
        return;
      }

      const data = await res.json() as {
        userToken?: string;
        partnerToken?: string;
        connectorToken?: string;
        primaryRedirect: string;
      };

      // Store tokens and sync across tabs/portals
      broadcastLogin({
        userToken: data.userToken ?? null,
        partnerToken: data.partnerToken ?? null,
        connectorToken: data.connectorToken ?? null,
      });

      // Populate this portal's auth context
      if (data.userToken) {
        const meRes = await fetch("/api/auth/me", {
          headers: { Authorization: `Bearer ${data.userToken}` },
        }).catch(() => null);
        const userData = meRes?.ok ? await meRes.json() : null;
        if (userData) login(data.userToken, userData);
      }

      const destination = redirectTo || data.primaryRedirect;
      window.location.href = destination;
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleMicrosoftSSO = () => {
    setError("");
    setSsoLoading(true);
    const redirectTo = getRedirectParam();
    const params = new URLSearchParams({ type: "unified" });
    if (redirectTo) params.set("redirect", redirectTo);
    window.location.href = `/api/auth/sso/microsoft?${params}`;
  };

  if (exchanging) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground text-sm">Signing you in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white border border-slate-200 shadow-xl rounded-3xl p-8">
        <div className="flex justify-center mb-8">
          <div className="bg-navy/10 text-navy p-3 rounded-2xl">
            <Building2 className="w-8 h-8" />
          </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-slate-900 mb-2">Sign In</h1>
        <p className="text-center text-slate-500 text-sm mb-8">
          Access your Siebert Services portal
        </p>

        {error && (
          <div className="flex items-start gap-2.5 bg-red-50 text-red-700 text-sm p-3.5 rounded-xl mb-5 border border-red-200 font-medium">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              onClick={() => setError("")}
              className="ml-1 flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}

        <div className="mb-6">
          <button
            type="button"
            onClick={handleMicrosoftSSO}
            disabled={ssoLoading || loading}
            className="w-full flex items-center justify-center gap-3 h-12 px-4 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors font-semibold text-sm text-slate-800 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            <MicrosoftIcon />
            {ssoLoading ? "Redirecting…" : "Sign in with Microsoft"}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 border-t border-slate-200" />
          <span className="text-xs text-slate-400 font-medium">or continue with email</span>
          <div className="flex-1 border-t border-slate-200" />
        </div>

        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@company.com"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              <span className="flex justify-between items-center">
                <span>Password</span>
                <a href="/portal?reset=1" className="text-xs font-normal text-primary hover:underline">
                  Forgot password?
                </a>
              </span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition"
            />
          </div>
          <button
            type="submit"
            disabled={loading || ssoLoading}
            className="w-full flex items-center justify-center gap-2 h-12 px-4 bg-primary text-white rounded-xl font-semibold text-sm hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            <KeyRound className="w-4 h-4" />
            {loading ? "Signing in…" : "Sign In"}
            {!loading && <ArrowRight className="w-4 h-4 ml-1" />}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-100 space-y-2 text-center text-xs text-slate-400">
          <p>
            Need a client account?{" "}
            <a href="/portal" className="text-primary font-semibold hover:underline">Register here</a>
          </p>
          <p>
            Partner?{" "}
            <a href="/partners/register" className="text-primary font-semibold hover:underline">Apply to the partner program</a>
          </p>
          <p>
            Referral connector?{" "}
            <a href="/referrals/signup" className="text-primary font-semibold hover:underline">Join the network</a>
          </p>
        </div>
      </div>
    </div>
  );
}
