import { useState } from "react";
import { Shield, AlertTriangle, RotateCcw, CheckCircle, Clock } from "lucide-react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { getAuthHeaders } from "@/hooks/use-auth";

function getAdminAuthHeaders() {
  const token = localStorage.getItem("token") || localStorage.getItem("partner_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "Never";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function SecuritySettings() {
  const [lastRevoked, setLastRevoked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [fetched, setFetched] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);

  async function fetchSettings() {
    setFetchLoading(true);
    try {
      const res = await fetch("/api/admin/security/settings", {
        headers: getAdminAuthHeaders() as HeadersInit,
      });
      if (res.ok) {
        const data = await res.json();
        setLastRevoked(data.sessionsRevokedBefore ?? null);
        setFetched(true);
      }
    } finally {
      setFetchLoading(false);
    }
  }

  if (!fetched && !fetchLoading) {
    fetchSettings();
  }

  async function handleRevoke() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/security/revoke-all-sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(getAdminAuthHeaders() as HeadersInit),
        },
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setLastRevoked(data.sessionsRevokedBefore);
        if (data.freshToken) {
          localStorage.setItem("token", data.freshToken);
        }
        setResult({ ok: true, message: "All sessions revoked. Your session has been automatically refreshed." });
      } else {
        setResult({ ok: false, message: data.message ?? "An error occurred." });
      }
    } catch {
      setResult({ ok: false, message: "Network error. Please try again." });
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  return (
    <PortalLayout>
      <div className="max-w-2xl mx-auto py-8 px-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#032d60] flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Security Settings</h1>
            <p className="text-sm text-slate-500">Manage session security and credential rotation</p>
          </div>
        </div>

        {/* Current status */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Last global revocation</span>
          </div>
          {fetchLoading ? (
            <div className="h-5 w-40 bg-slate-100 animate-pulse rounded" />
          ) : (
            <p className="text-sm text-slate-900 font-mono">
              {lastRevoked ? formatDate(lastRevoked) : "No revocation on record"}
            </p>
          )}
          {lastRevoked && (
            <p className="text-xs text-slate-400 mt-1">
              Any token issued before this time has been invalidated.
            </p>
          )}
        </div>

        {/* Revoke all sessions card */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0 mt-0.5">
              <RotateCcw className="w-4 h-4 text-red-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Revoke All Sessions</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Immediately invalidates every active login session across all portals. Use this before or after rotating your <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">JWT_SECRET</code> to ensure no stale tokens remain valid. Your own session will be refreshed automatically so you won't be logged out.
              </p>
            </div>
          </div>

          {result && (
            <div className={`flex items-start gap-2 rounded-lg p-3 mb-4 text-sm ${result.ok ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"}`}>
              {result.ok
                ? <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                : <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              }
              <span>{result.message}</span>
            </div>
          )}

          {!confirming ? (
            <button
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Revoke All Sessions
            </button>
          ) : (
            <div className="border border-amber-300 bg-amber-50 rounded-lg p-4">
              <div className="flex items-start gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800 font-medium">
                  This will immediately log out every user on every portal. Continue?
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRevoke}
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-60"
                >
                  {loading ? (
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <RotateCcw className="w-4 h-4" />
                  )}
                  {loading ? "Revoking…" : "Yes, Revoke All"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 transition-colors disabled:opacity-60"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Instructions card */}
        <div className="mt-4 bg-slate-50 border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">How to rotate JWT_SECRET without downtime</h3>
          <ol className="text-sm text-slate-600 space-y-1 list-decimal list-inside">
            <li>Click <strong>Revoke All Sessions</strong> above — all current sessions are invalidated and your session is auto-refreshed.</li>
            <li>Go to <strong>Secrets</strong> in the Replit sidebar and update <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">JWT_SECRET</code> to a new value.</li>
            <li>Restart the API Server workflow so it picks up the new secret.</li>
            <li>Users will be prompted to sign in again with their credentials.</li>
          </ol>
        </div>
      </div>
    </PortalLayout>
  );
}
