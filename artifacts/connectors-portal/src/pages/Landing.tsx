import { Link } from "wouter";
import { SiteHeader } from "@/components/SiteHeader";

const tiers = [
  {
    name: "Tier 1",
    range: "Up to $25K ACV",
    payout: "$150",
    color: "from-slate-500 to-slate-700",
  },
  {
    name: "Tier 2",
    range: "$25K – $75K ACV",
    payout: "$500",
    color: "from-sky-500 to-blue-700",
  },
  {
    name: "Tier 3",
    range: "$75K – $200K ACV",
    payout: "$1,250",
    color: "from-indigo-500 to-purple-700",
  },
  {
    name: "Tier 4",
    range: "$200K+ ACV",
    payout: "$2,500",
    color: "from-amber-500 to-rose-600",
  },
];

const steps = [
  {
    title: "1. Sign up",
    body: "Tell us a bit about yourself. Approval is instant — no formal partnership required.",
  },
  {
    title: "2. Submit a referral",
    body: "Use your dashboard to introduce a company that needs IT help. We do the selling.",
  },
  {
    title: "3. Get paid when they sign",
    body: "Earn $150 to $2,500 per closed deal — paid 30 days after their first paid invoice.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <SiteHeader />

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-20">
        <div className="max-w-3xl">
          <span className="inline-block rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-700">
            Referral Program for Individuals
          </span>
          <h1 className="mt-5 text-5xl font-bold leading-tight tracking-tight md:text-6xl">
            Know a business that needs better IT?
            <br />
            <span className="bg-gradient-to-r from-indigo-600 to-blue-600 bg-clip-text text-transparent">
              Earn up to $2,500 per referral.
            </span>
          </h1>
          <p className="mt-6 text-lg text-slate-600">
            The Siebert Services Connector Program rewards individuals — not just consultants — for
            introducing us to growing businesses. No quotas, no contracts, no awkward sales pitches.
            Just an introduction.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/signup"
              className="rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700"
            >
              Become a Connector
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50"
            >
              I already have an account
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
            <span>✓ Free to join</span>
            <span>✓ No quotas</span>
            <span>✓ Paid in cash, not credits</span>
            <span>✓ +$500 multi-location bonus</span>
          </div>
        </div>
      </section>

      {/* Tiers */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="mb-10 max-w-2xl">
            <h2 className="text-3xl font-bold tracking-tight">Tiered rewards based on deal size</h2>
            <p className="mt-3 text-slate-600">
              The bigger the customer, the bigger your reward. Tiers are based on the closed
              annual contract value (ACV).
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-lg"
              >
                <div className={`bg-gradient-to-br ${tier.color} px-5 py-4`}>
                  <div className="text-sm font-semibold uppercase tracking-wide text-white/80">
                    {tier.name}
                  </div>
                  <div className="mt-1 text-3xl font-bold text-white">{tier.payout}</div>
                </div>
                <div className="p-5 text-sm text-slate-600">{tier.range}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Multi-location bonus:</strong> +$500 added to your reward when the referred
            business operates in 3 or more physical locations.
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">How it works</h2>
          <p className="mt-3 text-slate-600">
            Simple enough for a 5-minute coffee break, structured enough that you always know where
            your referral stands.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <div className="text-lg font-semibold text-slate-900">{step.title}</div>
              <p className="mt-2 text-slate-600">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust / FAQ-lite */}
      <section className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 md:grid-cols-3">
          <div>
            <h3 className="font-semibold text-slate-900">When do I get paid?</h3>
            <p className="mt-2 text-sm text-slate-600">
              30 days after your referral's first paid invoice — once we know the deal is real and
              sticky.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Do I need a tax ID?</h3>
            <p className="mt-2 text-sm text-slate-600">
              For US payments above $600 in a calendar year, we'll request a W-9. Below that
              threshold, no paperwork.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">What if my referral cancels?</h3>
            <p className="mt-2 text-sm text-slate-600">
              We have a 90-day clawback window. If a customer cancels in the first 90 days after
              starting service, the reward is withdrawn — but this is rare.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h2 className="text-4xl font-bold tracking-tight">Your network is worth something.</h2>
        <p className="mx-auto mt-4 max-w-xl text-lg text-slate-600">
          Most people know at least one growing business that's outgrowing its IT setup. Refer
          them to Siebert Services and we'll thank you in cash.
        </p>
        <Link
          href="/signup"
          className="mt-8 inline-block rounded-lg bg-indigo-600 px-8 py-3 text-base font-semibold text-white shadow-lg shadow-indigo-600/30 hover:bg-indigo-700"
        >
          Sign up — it's free
        </Link>
      </section>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-slate-500 md:flex-row">
          <div>© {new Date().getFullYear()} Siebert Services Connector Program</div>
          <div>
            Looking for the partner program?{" "}
            <a href="/partners/" className="font-medium text-indigo-600 hover:text-indigo-700">
              Visit the Partner Portal
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
