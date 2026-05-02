import { useEffect } from "react";
import { Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const QUESTIONS: { num: number; q: string; why: string; lookFor: string }[] = [
  {
    num: 1,
    q: "What's your guaranteed response time, and is it in writing?",
    why: "Many MSPs advertise '24/7 support' but bury vague response times in their SLA — or have none at all.",
    lookFor: "A written SLA with response and resolution times by severity (e.g., 15-min for outages, 1-hr for high-priority).",
  },
  {
    num: 2,
    q: "What does your cybersecurity stack actually include?",
    why: "Antivirus alone is no longer adequate. Modern threats need EDR/MDR + 24/7 monitoring.",
    lookFor: "EDR or MDR with a real SOC, DNS filtering, email security, MFA enforcement, and monthly vulnerability scans.",
  },
  {
    num: 3,
    q: "How often do you test our backups?",
    why: "Backups that haven't been restore-tested are wishful thinking. Most ransomware victims discover failures during the incident.",
    lookFor: "Quarterly restore tests, immutable off-site copies, and documented RTO/RPO targets.",
  },
  {
    num: 4,
    q: "Who actually answers the phone — and where are they based?",
    why: "Tier-1 outsourced support reads from a script. You want engineers who know your environment.",
    lookFor: "US-based help desk with low staff turnover and named technical leads assigned to your account.",
  },
  {
    num: 5,
    q: "What's included vs. what's billed extra?",
    why: "Cheap monthly rates often hide project fees, after-hours surcharges, or 'out of scope' tickets.",
    lookFor: "All-inclusive flat rate covering normal break/fix, patching, monitoring, and onboarding/offboarding.",
  },
  {
    num: 6,
    q: "How do you proactively reduce our IT issues over time?",
    why: "A reactive 'fix it when broken' MSP wastes your money. Strategic MSPs prevent issues.",
    lookFor: "Quarterly business reviews, documented IT roadmap, and reporting on ticket trends.",
  },
  {
    num: 7,
    q: "How do you onboard a new client?",
    why: "Bad onboarding = months of pain. The first 30 days predict the next 5 years.",
    lookFor: "A documented 30/60/90 plan, dedicated onboarding manager, and a network discovery + documentation phase.",
  },
  {
    num: 8,
    q: "Can I see your incident response plan?",
    why: "When ransomware hits at 2am, you need a plan — not improvisation.",
    lookFor: "Written IR plan with named roles, escalation paths, and at least annual tabletop exercises.",
  },
  {
    num: 9,
    q: "What certifications and compliance frameworks do you support?",
    why: "If you're regulated (HIPAA, PCI, CMMC), your MSP must understand your obligations.",
    lookFor: "Vendor partnerships (Microsoft, SonicWall, etc.), CompTIA-certified engineers, and demonstrated experience with your framework.",
  },
  {
    num: 10,
    q: "Can I talk to 3 reference clients in my industry, similar in size?",
    why: "Anyone can show you a logo wall. Conversations reveal the truth.",
    lookFor: "References they're willing to introduce by phone — and questions you can ask about responsiveness, billing, and trust.",
  },
];

export default function PrintableBuyersGuide() {
  useEffect(() => {
    document.title = "MSP Buyer's Guide · Siebert Services";
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-16">
      <div className="max-w-3xl mx-auto px-4 print:px-0">
        <div className="flex items-center justify-between mb-6 print:hidden gap-3 flex-wrap">
          <h1 className="text-lg font-semibold text-navy">Download or print your guide</h1>
          <div className="flex gap-2">
            <Button asChild className="gap-2">
              <a href={`${API_BASE}/api/lead-magnets/buyers-guide/pdf`} download>
                <Download className="w-4 h-4" /> Download PDF
              </a>
            </Button>
            <Button variant="outline" onClick={() => window.print()} className="gap-2">
              <Printer className="w-4 h-4" /> Print
            </Button>
          </div>
        </div>

        <article className="bg-white shadow-lg print:shadow-none p-10 print:p-8">
          <header className="border-b-4 border-primary pb-4 mb-6">
            <p className="text-xs uppercase tracking-widest text-primary font-bold">Siebert Services · Buyer's Guide</p>
            <h1 className="text-3xl font-display font-bold text-navy mt-1">10 Questions to Ask Before Hiring an MSP</h1>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              The same evaluation framework our highest-performing clients used to vet Siebert and 30+ other providers. Use it as a scoring rubric to compare 3–5 MSPs side-by-side.
            </p>
          </header>

          {QUESTIONS.map(({ num, q, why, lookFor }) => (
            <section key={num} className="mb-6 break-inside-avoid">
              <div className="flex gap-3 items-start">
                <div className="w-9 h-9 bg-primary text-white rounded-full font-bold flex items-center justify-center shrink-0">{num}</div>
                <div className="flex-1">
                  <h2 className="text-lg font-display font-bold text-navy leading-snug">{q}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5"><span className="font-semibold text-navy">Why it matters:</span> {why}</p>
                  <p className="text-sm text-muted-foreground mt-1"><span className="font-semibold text-navy">What to look for:</span> {lookFor}</p>
                </div>
              </div>
            </section>
          ))}

          <section className="mt-8 p-5 bg-navy text-white rounded-xl break-inside-avoid">
            <h2 className="text-xl font-display font-bold mb-2">Scoring rubric</h2>
            <p className="text-sm text-white/80 mb-3">For each MSP, score every question 1 (poor) → 5 (excellent). Total possible: 50.</p>
            <ul className="text-sm space-y-1 text-white/90">
              <li>• <span className="font-semibold">40–50:</span> Strong contender — request references and proposal.</li>
              <li>• <span className="font-semibold">30–39:</span> Mixed — push back on weak areas before signing.</li>
              <li>• <span className="font-semibold">&lt; 30:</span> Walk away.</li>
            </ul>
          </section>

          <footer className="border-t pt-4 mt-8 text-xs text-muted-foreground">
            <p className="font-semibold text-navy text-sm mb-1">Want us to walk you through it live?</p>
            <p>Book a 30-minute consultation: siebertrservices.com/contact · 866-484-9180 · sales@siebertrservices.com</p>
          </footer>
        </article>
      </div>
      <style>{`
        @media print {
          body, html { background: white !important; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
}
