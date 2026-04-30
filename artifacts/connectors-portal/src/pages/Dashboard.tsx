import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { SiteHeader } from "@/components/SiteHeader";
import {
  connectorsApi,
  ApiError,
  type ReferralInput,
  type ConnectorReferral,
} from "@/lib/connectorsApi";
import { useAuth } from "@/lib/auth-context";

const SERVICE_OPTIONS = [
  "Managed IT",
  "Cybersecurity",
  "Cloud / Microsoft 365",
  "Help Desk",
  "Compliance (HIPAA, PCI, etc.)",
  "Network / Wi-Fi",
  "VoIP / Phones",
  "Backup & Disaster Recovery",
];

const COMPANY_SIZES = ["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"] as const;

const STATUS_LABELS: Record<ConnectorReferral["status"], { label: string; classes: string }> = {
  submitted: { label: "Submitted", classes: "bg-slate-100 text-slate-700" },
  qualified: { label: "Qualified", classes: "bg-sky-100 text-sky-800" },
  in_progress: { label: "In progress", classes: "bg-indigo-100 text-indigo-800" },
  won: { label: "Won 🎉", classes: "bg-emerald-100 text-emerald-800" },
  lost: { label: "Lost", classes: "bg-rose-100 text-rose-800" },
  duplicate: { label: "Duplicate", classes: "bg-amber-100 text-amber-800" },
};

const EMPTY_FORM: ReferralInput = {
  companyName: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  contactTitle: "",
  companySize: undefined,
  multiLocation: undefined,
  servicesNeeded: [],
  notes: "",
};

function formatMoney(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export default function DashboardPage() {
  const { connector, refresh } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ReferralInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: connectorsApi.me,
  });

  const referralsQuery = useQuery({
    queryKey: ["referrals"],
    queryFn: connectorsApi.listReferrals,
  });

  const payoutsQuery = useQuery({
    queryKey: ["payouts"],
    queryFn: connectorsApi.listPayouts,
  });

  const submitMutation = useMutation({
    mutationFn: (input: ReferralInput) => connectorsApi.submitReferral(input),
    onSuccess: () => {
      setSuccess("Referral submitted! We'll reach out to them within 1-2 business days.");
      setError(null);
      setForm(EMPTY_FORM);
      setShowForm(false);
      void queryClient.invalidateQueries({ queryKey: ["referrals"] });
      void queryClient.invalidateQueries({ queryKey: ["me"] });
      void refresh();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Failed to submit referral.");
      setSuccess(null);
    },
  });

  function update<K extends keyof ReferralInput>(key: K, value: ReferralInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleService(s: string) {
    setForm((f) => ({
      ...f,
      servicesNeeded: f.servicesNeeded.includes(s)
        ? f.servicesNeeded.filter((x) => x !== s)
        : [...f.servicesNeeded, s],
    }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    submitMutation.mutate(form);
  }

  const stats = meQuery.data?.stats;
  const referrals = referralsQuery.data?.referrals ?? [];
  const payouts = payoutsQuery.data?.payouts ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">
              Welcome back, {connector?.firstName} 👋
            </h1>
            <p className="mt-1 text-slate-600">
              Submit a new referral or check the status of the ones you've sent in.
            </p>
          </div>
          <button
            onClick={() => {
              setShowForm((s) => !s);
              setSuccess(null);
              setError(null);
            }}
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
          >
            {showForm ? "Cancel" : "+ Submit a referral"}
          </button>
        </div>

        {success && (
          <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            {success}
          </div>
        )}

        {/* Stats */}
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <Stat label="Total referrals" value={stats?.totalReferrals?.toString() ?? "—"} />
          <Stat label="Qualified+" value={stats?.totalQualified?.toString() ?? "—"} />
          <Stat label="Won" value={stats?.totalWon?.toString() ?? "—"} accent="text-emerald-700" />
          <Stat
            label="Total earned"
            value={stats ? formatMoney(stats.totalPaidCents) : "—"}
            accent="text-indigo-700"
            sublabel={
              stats && stats.totalPendingCents > 0
                ? `+ ${formatMoney(stats.totalPendingCents)} pending`
                : undefined
            }
          />
        </div>

        {/* Submit form */}
        {showForm && (
          <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">New referral</h2>
            <p className="mt-1 text-sm text-slate-600">
              Tell us about a business that could use better IT. We do the rest.
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Company name" required>
                  <input
                    type="text"
                    required
                    value={form.companyName}
                    onChange={(e) => update("companyName", e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Company size">
                  <select
                    value={form.companySize ?? ""}
                    onChange={(e) =>
                      update(
                        "companySize",
                        (e.target.value || undefined) as ReferralInput["companySize"],
                      )
                    }
                    className={inputClass}
                  >
                    <option value="">Select…</option>
                    {COMPANY_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} employees
                      </option>
                    ))}
                  </select>
                </FormField>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Primary contact name" required>
                  <input
                    type="text"
                    required
                    value={form.contactName}
                    onChange={(e) => update("contactName", e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Contact title">
                  <input
                    type="text"
                    value={form.contactTitle}
                    onChange={(e) => update("contactTitle", e.target.value)}
                    placeholder="e.g. Owner, COO, IT Manager"
                    className={inputClass}
                  />
                </FormField>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField label="Contact email" required>
                  <input
                    type="email"
                    required
                    value={form.contactEmail}
                    onChange={(e) => update("contactEmail", e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Contact phone">
                  <input
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => update("contactPhone", e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              </div>

              <FormField label="Multiple physical locations?" hint="3+ locations qualifies for the +$500 bonus">
                <div className="flex gap-3">
                  {(["yes", "no", "unknown"] as const).map((opt) => (
                    <label
                      key={opt}
                      className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm font-medium capitalize ${
                        form.multiLocation === opt
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-slate-300 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="multiLocation"
                        value={opt}
                        checked={form.multiLocation === opt}
                        onChange={() => update("multiLocation", opt)}
                        className="sr-only"
                      />
                      {opt === "unknown" ? "Not sure" : opt}
                    </label>
                  ))}
                </div>
              </FormField>

              <FormField label="Services they likely need">
                <div className="flex flex-wrap gap-2">
                  {SERVICE_OPTIONS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => toggleService(s)}
                      className={`rounded-full border px-3 py-1 text-xs font-medium ${
                        form.servicesNeeded.includes(s)
                          ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </FormField>

              <FormField label="Notes / context" hint="Anything we should know before reaching out — pain points, timing, your relationship to them, etc.">
                <textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => update("notes", e.target.value)}
                  className={inputClass}
                />
              </FormField>

              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={submitMutation.isPending}
                  className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {submitMutation.isPending ? "Submitting…" : "Submit referral"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Referrals table */}
        <div className="mt-10 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Your referrals</h2>
            <span className="text-xs text-slate-500">
              {referrals.length} total
            </span>
          </div>
          {referralsQuery.isLoading ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">Loading…</div>
          ) : referrals.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-slate-500">
              No referrals yet. Click "Submit a referral" to send your first one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Company</th>
                    <th className="px-6 py-3">Contact</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Reward</th>
                    <th className="px-6 py-3">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {referrals.map((r) => {
                    const status = STATUS_LABELS[r.status];
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td className="px-6 py-3">
                          <div className="font-medium text-slate-900">{r.companyName}</div>
                          {r.companySize && (
                            <div className="text-xs text-slate-500">{r.companySize} employees</div>
                          )}
                        </td>
                        <td className="px-6 py-3">
                          <div className="text-slate-700">{r.contactName}</div>
                          <div className="text-xs text-slate-500">{r.contactEmail}</div>
                        </td>
                        <td className="px-6 py-3">
                          <span
                            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${status.classes}`}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          {r.rewardAmountCents
                            ? formatMoney(r.rewardAmountCents)
                            : r.status === "won"
                              ? "Calculating…"
                              : "—"}
                        </td>
                        <td className="px-6 py-3 text-slate-600">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Payouts */}
        {payouts.length > 0 && (
          <div className="mt-10 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Payouts</h2>
              <span className="text-xs text-slate-500">{payouts.length} total</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3">Amount</th>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Method</th>
                    <th className="px-6 py-3">Reference</th>
                    <th className="px-6 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payouts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-6 py-3 font-semibold text-slate-900">
                        {formatMoney(p.amountCents)}
                      </td>
                      <td className="px-6 py-3 capitalize">{p.status}</td>
                      <td className="px-6 py-3 capitalize text-slate-700">
                        {p.payoutMethod ?? "—"}
                      </td>
                      <td className="px-6 py-3 text-slate-600">{p.payoutReference ?? "—"}</td>
                      <td className="px-6 py-3 text-slate-600">
                        {p.paidAt
                          ? new Date(p.paidAt).toLocaleDateString()
                          : new Date(p.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sublabel,
  accent = "text-slate-900",
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${accent}`}>{value}</div>
      {sublabel && <div className="mt-1 text-xs text-slate-500">{sublabel}</div>}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function FormField({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
