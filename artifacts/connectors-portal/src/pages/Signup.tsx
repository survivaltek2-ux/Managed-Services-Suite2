import { useState } from "react";
import { Link, useLocation } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";
import { connectorsApi, ApiError, type SignupInput } from "@/lib/connectorsApi";
import { useAuth } from "@/lib/auth-context";

const INITIAL: SignupInput = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  phone: "",
  city: "",
  state: "",
  occupation: "",
  howHeard: "",
};

export default function SignupPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [form, setForm] = useState<SignupInput>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof SignupInput>(key: K, value: SignupInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await connectorsApi.signup(form);
      login(result.token, result.connector);
      setLocation("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create account.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Join the Referral Network</h1>
          <p className="mt-1 text-sm text-slate-600">
            Free to join. No contracts. Get paid for the introductions you already make.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="First name" required>
                <input
                  type="text"
                  required
                  value={form.firstName}
                  onChange={(e) => update("firstName", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Last name" required>
                <input
                  type="text"
                  required
                  value={form.lastName}
                  onChange={(e) => update("lastName", e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="Email" required>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                className={inputClass}
              />
            </Field>

            <Field label="Password" required hint="At least 8 characters">
              <input
                type="password"
                required
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                className={inputClass}
              />
            </Field>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Phone">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Occupation / role">
                <input
                  type="text"
                  value={form.occupation}
                  onChange={(e) => update("occupation", e.target.value)}
                  placeholder="e.g. CPA, Realtor, Attorney"
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="City">
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => update("city", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="State">
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => update("state", e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label="How did you hear about us?">
              <input
                type="text"
                value={form.howHeard}
                onChange={(e) => update("howHeard", e.target.value)}
                className={inputClass}
              />
            </Field>

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {submitting ? "Creating account…" : "Create my account"}
            </button>

            <p className="text-center text-xs text-slate-500">
              By signing up you agree to refer companies you have a legitimate relationship with.
              W-9 will be requested only when annual earnings exceed $600.
            </p>
          </form>

          <div className="mt-6 text-center text-sm text-slate-600">
            Already a member?{" "}
            <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

function Field({
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
