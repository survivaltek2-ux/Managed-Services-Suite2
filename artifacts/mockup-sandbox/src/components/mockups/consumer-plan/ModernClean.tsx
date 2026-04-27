import { useState } from "react";
import {
  ChevronDown, ChevronUp, Shield, Wifi, Smartphone, Lock,
  ClipboardList, Clock, CreditCard, UserCheck, HelpCircle,
  CheckCircle2, AlertTriangle, Star, FileText,
} from "lucide-react";

const MOCK_CLIENT = "Alex Johnson";
const MOCK_PLAN_NUMBER = "SSP-2024-1041";
const MOCK_DATE = "April 27, 2026";

const SECTIONS = [
  {
    id: "summary",
    icon: Star,
    title: "Your Personalized Summary",
    color: "text-amber-600",
    bg: "bg-amber-50",
    border: "border-amber-200",
    content: (
      <p className="text-sm text-gray-700 leading-relaxed">
        Based on your home setup with 4 devices, two adults, and a growing need for digital safety,
        we've put together a plan that covers your devices and your home network —
        all with simple, friendly support whenever you need it.
      </p>
    ),
  },
  {
    id: "environment",
    icon: Wifi,
    title: "Your Current Setup",
    color: "text-blue-600",
    bg: "bg-blue-50",
    border: "border-blue-200",
    content: (
      <p className="text-sm text-gray-700 leading-relaxed">
        You currently have a mix of Windows laptops and Android phones connected to a standard ISP-provided
        router. Your home network lacks a firewall or any endpoint protection, and you haven't set up
        automatic backups for your personal files.
      </p>
    ),
  },
  {
    id: "findings",
    icon: AlertTriangle,
    title: "What We Found",
    color: "text-rose-600",
    bg: "bg-rose-50",
    border: "border-rose-200",
    content: (
      <ul className="space-y-2.5">
        {[
          "No antivirus or malware protection on your Windows devices",
          "Home network is open and lacks intrusion detection",
          "No automatic cloud backup for important documents and photos",
        ].map((f, i) => (
          <li key={i} className="flex gap-2.5 items-start text-sm text-gray-700">
            <span className="mt-0.5 shrink-0 w-4 h-4 rounded-full bg-rose-100 flex items-center justify-center">
              <span className="text-rose-500 text-[10px] font-bold">!</span>
            </span>
            {f}
          </li>
        ))}
      </ul>
    ),
  },
  {
    id: "services",
    icon: Shield,
    title: "What We'll Do For You",
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    content: (
      <div className="space-y-3">
        {[
          {
            service: "Device Protection & Antivirus",
            provider: "Bitdefender Total Security",
            desc: "Keep all your computers and phones safe from viruses, ransomware, and phishing attacks.",
          },
          {
            service: "Home Network Security",
            provider: "Vivint Smart Security",
            desc: "Lock down your Wi-Fi with a dedicated security router and smart intrusion detection.",
          },
          {
            service: "Remote Support",
            provider: "Siebert Residential Support",
            desc: "One call or click and a friendly tech is ready to help — no jargon, no fuss.",
          },
        ].map((s, i) => (
          <div key={i} className="flex gap-3 p-3 rounded-xl bg-white border border-emerald-100 shadow-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-gray-800">{s.service}</p>
              <p className="text-[11px] text-emerald-600 font-medium mt-0.5">via {s.provider}</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "next",
    icon: ClipboardList,
    title: "Your Next Steps",
    color: "text-violet-600",
    bg: "bg-violet-50",
    border: "border-violet-200",
    content: (
      <ol className="space-y-3">
        {[
          "Review and digitally sign this plan below",
          "We'll contact you within 24 hours to schedule your onboarding call",
          "We'll install and configure all software remotely or at your home",
          "You'll be fully protected within 3–5 business days",
        ].map((step, i) => (
          <li key={i} className="flex gap-3 items-start text-sm text-gray-700">
            <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-600 font-bold text-xs flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    ),
  },
  {
    id: "sla",
    icon: Clock,
    title: "When You Need Us",
    color: "text-sky-600",
    bg: "bg-sky-50",
    border: "border-sky-200",
    content: (
      <div className="space-y-2">
        {[
          { tier: "🚨 Urgent (system down, breach alert)", target: "Response within 2 hours" },
          { tier: "⚠️ Standard (slow device, weird pop-ups)", target: "Response within 4 hours" },
          { tier: "📝 Routine (advice, updates, questions)", target: "Response within 1 business day" },
        ].map((sl, i) => (
          <div key={i} className="flex justify-between items-start text-sm py-2 border-b last:border-0">
            <span className="text-gray-700">{sl.tier}</span>
            <span className="text-sky-600 font-semibold text-xs shrink-0 ml-4">{sl.target}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "pricing",
    icon: CreditCard,
    title: "Your Plan Pricing",
    color: "text-teal-600",
    bg: "bg-teal-50",
    border: "border-teal-200",
    content: (
      <div className="space-y-3">
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 overflow-hidden">
          {[
            { label: "Device Security (Bitdefender)", sublabel: "Up to 10 devices", price: "$10/mo" },
            { label: "Home Network Security (Vivint)", sublabel: "Secure router + monitoring", price: "$40/mo" },
            { label: "Residential Support (Siebert)", sublabel: "Unlimited remote sessions", price: "$49/mo" },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3 bg-white">
              <div>
                <p className="text-sm font-medium text-gray-800">{item.label}</p>
                <p className="text-xs text-gray-400">{item.sublabel}</p>
              </div>
              <span className="text-sm font-semibold text-teal-700 shrink-0 ml-4">{item.price}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 bg-teal-50">
            <p className="text-sm font-bold text-teal-800">Total (billed monthly)</p>
            <span className="text-base font-bold text-teal-700">$99/mo</span>
          </div>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed">
          No long-term contract required. Cancel any time with 30 days' notice. A one-time onboarding
          fee of $99 may apply.
        </p>
      </div>
    ),
  },
  {
    id: "responsibilities",
    icon: UserCheck,
    title: "What We Need From You",
    color: "text-orange-600",
    bg: "bg-orange-50",
    border: "border-orange-200",
    content: (
      <ul className="space-y-2">
        {[
          "Keep your devices powered on and connected to Wi-Fi during scheduled maintenance windows",
          "Respond to security alerts we send to your email or phone promptly",
          "Let us know when you add a new device to your home network",
          "Avoid installing unverified software or clicking suspicious links",
        ].map((r, i) => (
          <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
            <span className="text-orange-400 mt-0.5 shrink-0">▪</span> {r}
          </li>
        ))}
      </ul>
    ),
  },
  {
    id: "terms",
    icon: FileText,
    title: "Terms & Fine Print",
    color: "text-gray-500",
    bg: "bg-gray-50",
    border: "border-gray-200",
    content: (
      <div className="space-y-2 text-sm text-gray-600 leading-relaxed">
        <p>This plan covers residential personal use only and is not valid for commercial or business use.</p>
        <p>Services are governed by Siebert Services' standard Residential Services Agreement. Cancel anytime with 30 days written notice.</p>
        <p>This proposal is valid for 30 days from the date above.</p>
      </div>
    ),
  },
  {
    id: "sign",
    icon: HelpCircle,
    title: "Questions Before You Sign?",
    color: "text-indigo-600",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    content: (
      <p className="text-sm text-gray-700 leading-relaxed">
        We're happy to answer any questions before you sign. Call us at{" "}
        <span className="font-semibold text-indigo-700">(800) 555-0123</span> or email{" "}
        <span className="font-semibold text-indigo-700">support@siebertservices.com</span>. 
        When you're ready, sign digitally below.
      </p>
    ),
  },
];

function Section({
  id, icon: Icon, title, color, bg, border, content,
}: {
  id: string;
  icon: React.ElementType;
  title: string;
  color: string;
  bg: string;
  border: string;
  content: React.ReactNode;
}) {
  const [open, setOpen] = useState(id === "summary" || id === "services");
  return (
    <div className={`rounded-2xl border ${border} overflow-hidden shadow-sm`}>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between px-5 py-4 ${open ? bg : "bg-white"} hover:bg-opacity-80 transition-all`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl ${bg} flex items-center justify-center border ${border}`}>
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
          <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="px-5 py-4 border-t bg-white">{content}</div>}
    </div>
  );
}

export function ModernClean() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 font-sans">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="relative rounded-3xl overflow-hidden mb-6 shadow-lg">
          <div className="absolute inset-0 bg-gradient-to-br from-[#032d60] via-[#0176d3] to-[#00a1e0]" />
          <div className="relative px-6 py-8 text-white">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <span className="text-sm font-semibold text-blue-100 uppercase tracking-widest">Siebert Services</span>
            </div>
            <h1 className="text-2xl font-bold leading-tight">
              Your Personal<br />
              <span className="text-blue-200">Technology Plan</span>
            </h1>
            <p className="text-blue-100 text-sm mt-2">Prepared for <span className="font-bold text-white">{MOCK_CLIENT}</span></p>
            <div className="flex gap-4 mt-4 text-xs text-blue-200">
              <span>Plan #{MOCK_PLAN_NUMBER}</span>
              <span>•</span>
              <span>{MOCK_DATE}</span>
            </div>
          </div>
          {/* Glowing orb decoration */}
          <div className="absolute -top-6 -right-6 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-4 right-8 w-20 h-20 rounded-full bg-white/10 blur-xl" />
        </div>

        {/* Quick glance */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: "Devices covered", value: "4", icon: Smartphone },
            { label: "Response time", value: "≤ 2h", icon: Clock },
            { label: "Monthly", value: "$99", icon: CreditCard },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="bg-white rounded-2xl p-3 text-center shadow-sm border border-gray-100">
              <Icon className="w-4 h-4 text-[#0176d3] mx-auto mb-1" />
              <p className="text-xl font-bold text-[#032d60]">{value}</p>
              <p className="text-[11px] text-gray-500">{label}</p>
            </div>
          ))}
        </div>

        {/* Sections */}
        <div className="space-y-3">
          {SECTIONS.map((s) => (
            <Section key={s.id} {...s} />
          ))}
        </div>

        {/* Sign CTA */}
        <div className="mt-8 rounded-3xl bg-gradient-to-r from-[#032d60] to-[#0176d3] p-6 text-white text-center shadow-lg">
          <CheckCircle2 className="w-8 h-8 text-blue-200 mx-auto mb-3" />
          <p className="font-bold text-lg mb-1">Ready to get protected?</p>
          <p className="text-blue-200 text-sm mb-5">Sign your plan digitally — it takes less than a minute.</p>
          <button className="w-full bg-white text-[#032d60] font-bold rounded-xl py-3 text-sm hover:bg-blue-50 transition-colors">
            Sign My Plan Now
          </button>
          <p className="text-xs text-blue-300 mt-3">Valid until May 27, 2026 · No commitment required</p>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6 pb-6">
          © 2026 Siebert Services · Confidential · Residential Use Only
        </p>
      </div>
    </div>
  );
}
