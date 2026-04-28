import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth, PartnerStatusError } from "@/hooks/use-auth";
import { Building2, ArrowRight, Mail, KeyRound, AlertCircle } from "lucide-react";

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
  sso_not_configured: "Microsoft sign-in is not available right now. Please use email/password instead.",
  access_denied: "Sign-in was cancelled. Please try again.",
  token_failed: "Could not complete sign-in. Please try again.",
  profile_failed: "Could not retrieve your profile. Please try again.",
  no_account: "No partner account found for your email. Please contact your account manager to get access.",
  wrong_tenant: "Your Microsoft account belongs to an unauthorized organization. Please sign in with your company account.",
  server_error: "An error occurred during sign-in. Please try again.",
  no_email: "Could not retrieve your email. Please try again.",
  pending_approval: "Your partner account application has been received and is pending review. You'll be notified once approved.",
  account_rejected: "Your partner account application was not approved. Please contact us for more information.",
  // ── Task #187 — Azure AD authorization codes ────────────────────────
  not_authorized: "Your account isn't authorized to access this portal. Please ask your administrator to grant you access.",
  ca_required: "Your organization requires Conditional Access. Please complete the Microsoft prompt and try again.",
  stepup_required: "We need to confirm your identity again before continuing.",
  azure_unreachable: "We can't reach the directory right now. Please try again in a few minutes.",
  session_revoked: "Your session has been revoked. Please sign in again.",
  access_revoked: "Your access has been revoked. Please contact your administrator.",
  team_member_revoked: "Your team access has been revoked. Please contact your company admin.",
  team_member_company_inactive: "Your company's account is no longer active. Please contact support.",
  invite_expired: "Your invite has expired. Please ask your company admin to resend it.",
  domain_already_registered: "Your domain is already registered. Please ask the existing admin for an invite.",
};

export default function Login() {
  const { login, isLoggingIn, handleSsoToken } = useAuth();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ssoLoading, setSsoLoading] = useState(false);
  const [mode, setMode] = useState<"password" | "code" | "forgot">("password");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoCode = params.get("sso_code");
    const ssoError = params.get("sso_error");

    if (ssoCode) {
      // Strip the one-time code from the URL immediately before making the exchange
      // request so the code never lingers in browser history.
      window.history.replaceState({}, "", window.location.pathname);
      fetch("/api/sso/exchange-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ssoCode }),
      })
        .then(r => r.json())
        .then(data => {
          if (data.token) {
            handleSsoToken(data.token);
          } else {
            setError("Sign-in failed. Please try again.");
          }
        })
        .catch(() => setError("Sign-in failed. Please try again."));
      return;
    }

    if (ssoError) {
      if (ssoError === "pending_approval") {
        window.history.replaceState({}, "", window.location.pathname);
        window.location.href = `${import.meta.env.BASE_URL}pending`;
        return;
      }
      const message = SSO_ERROR_MESSAGES[ssoError] ?? "Sign-in failed. Please try again.";
      setError(message);
      setMode("password");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [handleSsoToken]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await login({ email: email.trim().toLowerCase(), password });
    } catch (err) {
      if (err instanceof PartnerStatusError && err.code === "pending_approval") {
        const params = new URLSearchParams({ company: err.companyName, email: err.partnerEmail });
        window.location.href = `${import.meta.env.BASE_URL}pending?${params}`;
        return;
      }
      setError((err as Error).message || "Failed to login. Check credentials.");
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError("Please enter your email address."); return; }
    setError("");
    setCodeLoading(true);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: "partner" }),
      });
      const d = await res.json();
      if (res.ok) {
        setCodeSent(true);
      } else {
        setError(d.message || "Failed to send code.");
      }
    } catch {
      setError("Failed to send code. Please try again.");
    } finally {
      setCodeLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCodeLoading(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code, type: "partner" }),
      });
      const d = await res.json();
      if (res.ok) {
        login({ token: d.token as string, user: d.user });
      } else {
        setError(d.message || "Invalid or expired code.");
      }
    } catch {
      setError("Failed to verify code. Please try again.");
    } finally {
      setCodeLoading(false);
    }
  };

  const handleMicrosoftSSO = () => {
    setError("");
    setSsoLoading(true);
    window.location.href = "/api/auth/sso/microsoft?type=partner";
  };


  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setError("Please enter your email address."); return; }
    setError("");
    setForgotLoading(true);
    try {
      await fetch("/api/partner/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setForgotSent(true);
    } catch {
      setError("Failed to send reset link. Please try again.");
    } finally {
      setForgotLoading(false);
    }
  };

  const switchMode = (m: "password" | "code" | "forgot") => {
    setMode(m);
    setError("");
    setCodeSent(false);
    setCode("");
    setForgotSent(false);
  };

  return (
    <PublicLayout>
      <div className="flex-1 flex flex-col items-center justify-center p-4 bg-slate-50 dark:bg-slate-900">
        <div className="w-full max-w-md bg-card border border-border shadow-xl rounded-3xl p-8">
          <div className="flex justify-center mb-8">
            <div className="bg-primary/10 text-primary p-3 rounded-2xl">
              <Building2 className="w-8 h-8" />
            </div>
          </div>
          <h2 className="text-2xl font-display font-bold text-center text-foreground mb-2">Partner Login</h2>
          <p className="text-center text-muted-foreground mb-6">Welcome back to the portal.</p>

          {mode !== "forgot" && (
            <div className="flex rounded-xl border border-border overflow-hidden mb-6">
              <button
                type="button"
                onClick={() => switchMode("password")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${mode === "password" ? "bg-primary text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              >
                <KeyRound className="w-4 h-4" /> Password
              </button>
              <button
                type="button"
                onClick={() => switchMode("code")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition-colors ${mode === "code" ? "bg-primary text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}
              >
                <Mail className="w-4 h-4" /> Email Code
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2.5 bg-destructive/10 text-destructive text-sm p-3.5 rounded-xl mb-4 border border-destructive/20 font-medium">
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

          {mode === "forgot" ? (
            forgotSent ? (
              <div className="text-center space-y-4 py-2">
                <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-xl p-5">
                  <Mail className="w-8 h-8 text-green-600 mx-auto mb-3" />
                  <p className="font-semibold text-foreground mb-1">Check your email</p>
                  <p className="text-sm text-muted-foreground">
                    If a partner account exists for <strong>{email}</strong>, we've sent a reset link. Check your inbox (and spam folder).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => switchMode("password")}
                  className="text-sm text-primary font-semibold hover:underline"
                >
                  Back to Sign In
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground mb-5">
                  Enter your account email and we'll send you a link to reset your password. The link expires in 1 hour.
                </p>
                <form onSubmit={handleForgotPassword} className="space-y-5">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground ml-1">Work Email</label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      placeholder="you@company.com"
                      className="bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                  <Button type="submit" className="w-full h-12 text-base rounded-xl" disabled={forgotLoading}>
                    {forgotLoading ? "Sending..." : "Send Reset Link"} <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </form>
                <button
                  type="button"
                  onClick={() => switchMode("password")}
                  className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors mt-4 text-center"
                >
                  Back to Sign In
                </button>
              </>
            )
          ) : mode === "password" ? (
            <>
              <div className="flex flex-col gap-3 mb-6">
                <button
                  type="button"
                  onClick={handleMicrosoftSSO}
                  disabled={ssoLoading || isLoggingIn}
                  className="w-full flex items-center justify-center gap-3 h-12 px-4 border border-border rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors font-semibold text-sm text-foreground disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
                >
                  <MicrosoftIcon />
                  {ssoLoading ? "Redirecting..." : "Sign in with Microsoft"}
                </button>

              </div>

              <div className="flex items-center gap-3 mb-6">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground font-medium">or sign in with email</span>
                <div className="flex-1 border-t border-border" />
              </div>

              <form onSubmit={handlePasswordSubmit} className="space-y-5">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground ml-1">Work Email</label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@company.com"
                    className="bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center ml-1">
                    <label className="text-sm font-semibold text-foreground">Password</label>
                    <button
                      type="button"
                      onClick={() => switchMode("forgot")}
                      className="text-xs text-primary font-semibold hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="bg-slate-50 dark:bg-slate-950"
                  />
                </div>
                <Button type="submit" className="w-full h-12 text-base rounded-xl" disabled={isLoggingIn || ssoLoading}>
                  {isLoggingIn ? "Signing in..." : "Sign In"} <ArrowRight className="ml-2 w-4 h-4" />
                </Button>
              </form>
            </>
          ) : !codeSent ? (
            <form onSubmit={handleRequestCode} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground ml-1">Work Email</label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="you@company.com"
                  className="bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <Button type="submit" className="w-full h-12 text-base rounded-xl" disabled={codeLoading}>
                <Mail className="mr-2 w-4 h-4" />
                {codeLoading ? "Sending..." : "Send Login Code"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyCode} className="space-y-5">
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 text-center">
                <p className="text-sm text-muted-foreground">We sent a 6-digit code to</p>
                <p className="font-semibold text-foreground mt-1">{email}</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground ml-1">Enter Code</label>
                <Input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  required
                  placeholder="000000"
                  maxLength={6}
                  className="bg-slate-50 dark:bg-slate-950 text-center text-2xl tracking-widest font-bold"
                />
              </div>
              <Button type="submit" className="w-full h-12 text-base rounded-xl" disabled={codeLoading || code.length !== 6}>
                {codeLoading ? "Verifying..." : "Verify & Sign In"} <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
              <button
                type="button"
                onClick={() => { setCodeSent(false); setCode(""); setError(""); }}
                className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Didn't receive it? Send again
              </button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground mt-8">
            Not a partner yet? <Link href="/register" className="text-primary font-semibold hover:underline">Apply here</Link>
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}
