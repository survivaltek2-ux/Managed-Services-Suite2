import { useEffect } from "react";
import { Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

const SECTIONS: { title: string; section: string; items: string[] }[] = [
  {
    title: "Administrative Safeguards",
    section: "§164.308",
    items: [
      "Conduct a written, accurate, and thorough risk analysis (164.308(a)(1)(ii)(A))",
      "Implement risk management measures sufficient to reduce risks to a reasonable level",
      "Apply sanction policies for workforce members who fail to comply with policies",
      "Information system activity review — regular log review and audit-trail analysis",
      "Designate a HIPAA Security Officer with documented responsibilities",
      "Workforce clearance procedures and supervision for staff with PHI access",
      "Termination procedures: revoke access on the same day as departure",
      "Information access management — role-based access aligned to least-privilege",
      "Security awareness training (initial + ongoing reminders, malware/phishing protection)",
      "Password management training and policies",
      "Security incident procedures: detection, response, and reporting",
      "Contingency plan: data backup, disaster recovery, emergency mode operation",
      "Periodic technical and non-technical evaluations of safeguards",
      "Business Associate Agreements (BAAs) signed with every vendor that touches PHI",
    ],
  },
  {
    title: "Physical Safeguards",
    section: "§164.310",
    items: [
      "Facility access controls: locked doors, visitor logs, badge access where appropriate",
      "Workstation use policies — appropriate use, location, and surrounding workspace",
      "Workstation security: cable locks, privacy screens, lock-on-walk-away enforced",
      "Device & media controls: documented disposal of hardware and media containing PHI",
      "Media re-use procedures (sanitization / destruction certificates)",
      "Asset inventory of all hardware and electronic media containing ePHI",
      "Backup of ePHI before equipment is moved",
    ],
  },
  {
    title: "Technical Safeguards",
    section: "§164.312",
    items: [
      "Unique user IDs for every workforce member (no shared accounts)",
      "Emergency access procedure to retrieve ePHI during a system outage",
      "Automatic logoff after a defined period of inactivity",
      "Encryption of ePHI at rest (full-disk + database) and in transit (TLS 1.2+)",
      "Audit controls: hardware/software/procedural mechanisms recording activity in systems with ePHI",
      "Integrity controls — mechanisms to authenticate ePHI has not been altered",
      "Person or entity authentication: MFA on all remote access and admin accounts",
      "Transmission security: encryption + integrity for ePHI sent over open networks",
    ],
  },
  {
    title: "Organizational Requirements & Policies",
    section: "§164.314 & §164.316",
    items: [
      "Written policies and procedures for every required safeguard",
      "Documentation retained for 6 years from creation or last effective date",
      "Periodic review and update of policies (at least annually)",
      "BAAs with all subcontractors that handle PHI",
      "Workforce member confidentiality agreements signed",
    ],
  },
  {
    title: "Breach Notification Readiness",
    section: "§164.400–414",
    items: [
      "Defined process for assessing whether an incident is a reportable breach",
      "Notification template: notify affected individuals within 60 days",
      "HHS notification process: <500 affected → annual log, ≥500 → immediate report",
      "Media notification readiness for breaches affecting >500 in a state",
      "Breach response team and contact tree documented",
    ],
  },
];

export default function PrintableHipaa() {
  useEffect(() => {
    document.title = "HIPAA Compliance Checklist · Siebert Services";
  }, []);
  return (
    <div className="min-h-screen bg-gray-50 pt-24 pb-16">
      <div className="max-w-3xl mx-auto px-4 print:px-0">
        <div className="flex items-center justify-between mb-6 print:hidden gap-3 flex-wrap">
          <h1 className="text-lg font-semibold text-navy">Download or print your checklist</h1>
          <div className="flex gap-2">
            <Button asChild className="gap-2">
              <a href={`${API_BASE}/api/lead-magnets/hipaa-checklist/pdf`} download>
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
            <p className="text-xs uppercase tracking-widest text-primary font-bold">Siebert Services</p>
            <h1 className="text-3xl font-display font-bold text-navy mt-1">HIPAA Compliance Checklist</h1>
            <p className="text-sm text-muted-foreground mt-1">
              A practical checklist mapped to the HIPAA Security Rule (45 CFR §164.308–316). For medical, dental, and behavioral-health practices.
            </p>
          </header>

          {SECTIONS.map(s => (
            <section key={s.title} className="mb-7 break-inside-avoid">
              <h2 className="text-xl font-display font-bold text-navy">
                {s.title}
                <span className="text-xs font-normal text-muted-foreground ml-2">{s.section}</span>
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {s.items.map(item => (
                  <li key={item} className="flex gap-3">
                    <span className="inline-block w-4 h-4 border-2 border-gray-400 rounded shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <footer className="border-t pt-4 mt-8 text-xs text-muted-foreground">
            <p className="font-semibold text-navy text-sm mb-1">Need help closing the gaps?</p>
            <p>Siebert Services · 866-484-9180 · sales@siebertrservices.com · siebertrservices.com</p>
            <p className="mt-2 italic">This checklist is provided for informational purposes only and does not constitute legal advice. Consult your compliance counsel for your specific obligations.</p>
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
