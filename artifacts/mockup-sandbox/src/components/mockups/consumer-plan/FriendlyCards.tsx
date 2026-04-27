import {
  Shield, Wifi, AlertTriangle, CheckCircle2, Clock, CreditCard,
  UserCheck, Smartphone, Star, Home,
  PhoneCall, Download, FileCheck2,
} from "lucide-react";

const MOCK_CLIENT = "Alex Johnson";
const MOCK_PLAN_NUMBER = "SSP-2024-1041";
const MOCK_DATE = "April 27, 2026";

export function FriendlyCards() {
  return (
    <div className="min-h-screen bg-[#f8faff] font-sans">
      {/* Hero Banner */}
      <div className="bg-white border-b border-gray-100 px-5 pt-8 pb-6">
        <div className="max-w-xl mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-5 h-5 text-[#0176d3]" />
            <span className="text-xs text-[#0176d3] font-semibold uppercase tracking-widest">Siebert Services</span>
          </div>
          <h1 className="text-2xl font-bold text-[#032d60] leading-snug mb-1">
            Hi {MOCK_CLIENT.split(" ")[0]} 👋<br />
            <span className="text-gray-700 font-normal text-lg">Here's your personal tech safety plan.</span>
          </h1>
          <p className="text-xs text-gray-400 mt-2">Plan #{MOCK_PLAN_NUMBER} · {MOCK_DATE}</p>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">

        {/* At-a-Glance strip */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-gradient-to-br from-[#0176d3] to-[#032d60] text-white rounded-2xl p-4 col-span-2">
            <p className="text-xs font-semibold text-blue-200 uppercase tracking-wider mb-2">Your plan at a glance</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Devices", value: "4", icon: Smartphone },
                { label: "Urgent response", value: "2 hrs", icon: Clock },
                { label: "Est. monthly", value: "$99", icon: CreditCard },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="bg-white/10 rounded-xl py-3">
                  <Icon className="w-4 h-4 text-blue-200 mx-auto mb-1" />
                  <p className="text-lg font-bold">{value}</p>
                  <p className="text-[10px] text-blue-200">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* What we found */}
        <div>
          <SectionLabel icon={AlertTriangle} label="What we found" color="text-rose-500" />
          <div className="grid grid-cols-1 gap-2 mt-2">
            {[
              { issue: "No antivirus or malware protection", severity: "High" },

              { issue: "Home Wi-Fi lacks security layer", severity: "Medium" },
              { issue: "No automatic backup for your files", severity: "Medium" },
            ].map((f, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-100 px-4 py-3 flex items-center gap-3 shadow-sm">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                  f.severity === "High" ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
                }`}>{f.severity}</span>
                <p className="text-sm text-gray-700">{f.issue}</p>
              </div>
            ))}
          </div>
        </div>

        {/* What we'll do */}
        <div>
          <SectionLabel icon={Shield} label="How we'll protect you" color="text-emerald-500" />
          <div className="grid grid-cols-1 gap-3 mt-2">
            {[
              {
                icon: Shield,
                service: "Device Security",
                product: "Bitdefender Total Security",
                desc: "Real-time protection against viruses, ransomware & phishing for all your devices.",
                color: "bg-emerald-50 border-emerald-200",
                iconColor: "text-emerald-600",
              },
              {
                icon: Wifi,
                service: "Home Network Security",
                product: "Vivint Smart Security",
                desc: "Secure router, intrusion detection, and network-level threat blocking.",
                color: "bg-sky-50 border-sky-200",
                iconColor: "text-sky-600",
              },
              {
                icon: Home,
                service: "Connected Home Setup",
                product: "Siebert Home Tech",
                desc: "We help configure all your smart home devices securely in one visit.",
                color: "bg-amber-50 border-amber-200",
                iconColor: "text-amber-600",
              },
              {
                icon: PhoneCall,
                service: "Friendly Remote Support",
                product: "Siebert Residential",
                desc: "Call or text us any time. A real person picks up — no robots, no hold queues.",
                color: "bg-rose-50 border-rose-200",
                iconColor: "text-rose-600",
              },
            ].map((s, i) => (
              <div key={i} className={`bg-white rounded-2xl border ${s.color} p-4 shadow-sm flex gap-4`}>
                <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center shrink-0`}>
                  <s.icon className={`w-5 h-5 ${s.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 text-sm">{s.service}</p>
                  <p className={`text-[11px] font-semibold mt-0.5 ${s.iconColor}`}>{s.product}</p>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* When to call us */}
        <div>
          <SectionLabel icon={Clock} label="When to call us" color="text-sky-500" />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mt-2">
            {[
              { emoji: "🚨", tier: "Urgent", example: "System down, breach alert", time: "≤ 2 hours", barColor: "bg-rose-400" },
              { emoji: "⚠️", tier: "Standard", example: "Slow device, suspicious pop-ups", time: "≤ 4 hours", barColor: "bg-amber-400" },
              { emoji: "📋", tier: "Routine", example: "Questions, advice, updates", time: "1 business day", barColor: "bg-emerald-400" },
            ].map((sl, i) => (
              <div key={i} className={`flex items-center gap-3 px-4 py-3.5 ${i < 2 ? "border-b border-gray-100" : ""}`}>
                <div className={`w-1 self-stretch rounded-full ${sl.barColor} shrink-0`} />
                <span className="text-xl shrink-0">{sl.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">{sl.tier}</p>
                  <p className="text-xs text-gray-500">{sl.example}</p>
                </div>
                <span className="text-xs font-bold text-gray-700 shrink-0 text-right">{sl.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Your responsibilities */}
        <div>
          <SectionLabel icon={UserCheck} label="What we need from you" color="text-orange-500" />
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-2 space-y-2">
            {[
              "Keep your devices powered on and connected during maintenance windows",
              "Respond to alerts we send to your email or phone",
              "Let us know when you add a new device to your home",
              "Avoid installing software from unknown sources",
            ].map((r, i) => (
              <div key={i} className="flex gap-3 items-start text-sm text-gray-700">
                <CheckCircle2 className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" />
                {r}
              </div>
            ))}
          </div>
        </div>

        {/* Your next steps */}
        <div>
          <SectionLabel icon={Star} label="Your next steps" color="text-violet-500" />
          <div className="relative mt-2">
            <div className="absolute left-6 top-5 bottom-5 w-px bg-violet-100" />
            <div className="space-y-3">
              {[
                { step: "Sign this plan digitally below", icon: FileCheck2 },
                { step: "We'll call you within 24 hours to schedule setup", icon: PhoneCall },
                { step: "We install and configure everything for you", icon: Smartphone },
                { step: "You'll be fully protected within 3–5 days", icon: Shield },
              ].map((s, i) => (
                <div key={i} className="flex gap-3 items-center">
                  <div className="w-12 h-12 rounded-full bg-white border-2 border-violet-200 flex items-center justify-center shrink-0 z-10">
                    <s.icon className="w-5 h-5 text-violet-500" />
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 flex-1">
                    <p className="text-sm text-gray-700">{s.step}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Fine print */}
        <div className="bg-gray-50 rounded-2xl border border-gray-200 px-4 py-4 text-xs text-gray-500 space-y-1 leading-relaxed">
          <p>This plan covers residential personal use only. Not valid for commercial or business use.</p>
          <p>Cancel any time with 30 days written notice. No long-term contract required.</p>
          <p>This proposal is valid for 30 days from {MOCK_DATE}.</p>
        </div>

        {/* Sign CTA */}
        <div className="rounded-3xl overflow-hidden shadow-xl">
          <div className="bg-gradient-to-r from-[#032d60] to-[#0176d3] px-6 pt-6 pb-2 text-white text-center">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center mx-auto mb-3">
              <FileCheck2 className="w-6 h-6 text-white" />
            </div>
            <p className="font-bold text-lg mb-1">Everything look good?</p>
            <p className="text-blue-200 text-sm">Sign your plan now — it takes about 30 seconds.</p>
          </div>
          <div className="bg-white px-6 pb-6 pt-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Your full name</label>
                <div className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-400 bg-gray-50">Alex Johnson</div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Your title (optional)</label>
                <div className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-400 bg-gray-50">Homeowner</div>
              </div>
            </div>
            <div className="border-2 border-dashed border-gray-200 rounded-xl h-24 flex items-center justify-center text-sm text-gray-400">
              ✍️ Draw your signature here
            </div>
            <button className="w-full bg-gradient-to-r from-[#032d60] to-[#0176d3] text-white font-bold rounded-xl py-3 text-sm flex items-center justify-center gap-2 shadow-lg">
              <CheckCircle2 className="w-4 h-4" /> I Agree &amp; Sign This Plan
            </button>
            <button className="w-full border border-gray-200 text-gray-500 font-medium rounded-xl py-2.5 text-sm flex items-center justify-center gap-2">
              <Download className="w-4 h-4" /> Download PDF
            </button>
            <p className="text-center text-xs text-gray-400">Have questions first? Call us at (800) 555-0123</p>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-6">© 2026 Siebert Services · Confidential</p>
      </div>
    </div>
  );
}

function SectionLabel({ icon: Icon, label, color }: { icon: React.ElementType; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${color}`} />
      <p className={`text-xs font-bold uppercase tracking-wider ${color}`}>{label}</p>
    </div>
  );
}
