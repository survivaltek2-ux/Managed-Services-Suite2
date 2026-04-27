import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Shield,
  Zap,
  HeartHandshake,
  MapPin,
  CheckCircle2,
} from "lucide-react";
import { Link } from "wouter";
import { Button, Card, CardContent } from "@/components/ui";
import {
  CompanyStats,
  CertificationsRow,
  TestimonialsSection,
} from "@/components/trust";
import { MultiChannelContactBar } from "@/components/MultiChannelContactBar";

interface TeamMember {
  id: number;
  name: string;
  role: string;
  bio: string | null;
  imageUrl: string | null;
  sortOrder: number;
  active: boolean;
}

const TEAM_ACCENTS = [
  "from-primary to-blue-600",
  "from-emerald-500 to-teal-600",
  "from-rose-500 to-orange-500",
  "from-violet-500 to-fuchsia-500",
  "from-amber-500 to-orange-600",
  "from-cyan-500 to-blue-500",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SERVICE_AREA = [
  { county: "Orange County", towns: ["Washingtonville", "Newburgh", "Middletown", "Goshen", "Monroe", "Warwick"] },
  { county: "Rockland County", towns: ["New City", "Nyack", "Suffern", "Spring Valley"] },
  { county: "Westchester County", towns: ["White Plains", "Yonkers", "New Rochelle", "Peekskill"] },
  { county: "Dutchess County", towns: ["Poughkeepsie", "Beacon", "Fishkill", "Wappingers Falls"] },
  { county: "Ulster County", towns: ["Kingston", "New Paltz", "Saugerties"] },
  { county: "Putnam County", towns: ["Carmel", "Mahopac", "Brewster"] },
];

const VALUES = [
  {
    icon: <Shield className="w-10 h-10 text-primary" />,
    title: "Uncompromising Security",
    desc: "Security is baked into everything we do, not bolted on. Every managed client gets MFA, EDR, and email security from day one.",
  },
  {
    icon: <Zap className="w-10 h-10 text-primary" />,
    title: "Rapid Response",
    desc: "Downtime costs money. Our 15-minute SLA isn't a marketing line — it's measured every week and tied to engineer compensation.",
  },
  {
    icon: <HeartHandshake className="w-10 h-10 text-primary" />,
    title: "True Partnership",
    desc: "We answer the phone, write in plain English, and tell you when you don't need to spend money. We've kept clients for 10+ years for a reason.",
  },
];

export default function About() {
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}api/cms/team`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TeamMember[]) => {
        if (cancelled) return;
        const sorted = Array.isArray(data)
          ? [...data].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
          : [];
        setTeam(sorted);
      })
      .catch(() => {
        if (!cancelled) setTeam([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* HERO */}
      <section className="relative pt-28 pb-16 lg:pt-36 lg:pb-20 bg-navy text-white overflow-hidden">
        <div className="absolute inset-0 z-0 opacity-30">
          <img
            src={`${import.meta.env.BASE_URL}images/hero-bg.png`}
            alt=""
            className="w-full h-full object-cover mix-blend-overlay"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-navy via-navy/80 to-transparent" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/15 border border-primary/30 text-primary font-bold text-xs tracking-widest uppercase mb-5">
              <MapPin className="w-3.5 h-3.5" /> Proudly based in Washingtonville, NY
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-display font-extrabold leading-[1.05] mb-6 tracking-tight">
              The IT team trusted by{" "}
              <span className="text-gradient">businesses across North America.</span>
            </h1>
            <p className="text-lg lg:text-xl text-white/80 leading-relaxed max-w-2xl">
              Founded in the Hudson Valley, Siebert Services has grown into a full hybrid MSP
              serving businesses coast to coast — with the same promise we've always kept:
              a senior engineer who knows your network, picks up the phone, and shows up
              when it counts.
            </p>
          </div>

        </div>
      </section>

      {/* COMPANY STATS — visible directly under hero */}
      <CompanyStats variant="navy" />

      {/* ORIGIN STORY */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <div className="text-primary text-xs font-bold tracking-widest uppercase mb-3">
                Our story
              </div>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-navy mb-6">
                From a one-man repair shop to a trusted MSP serving businesses across North America.
              </h2>
              <div className="space-y-4 text-lg text-muted-foreground leading-relaxed">
                <p>
                  Siebert Repair Services LLC started in 2014 as a one-person break-fix shop
                  out of a garage in Washingtonville, New York. The promise then was the same
                  as it is now: pick up the phone, show up on time, and explain things in
                  plain English.
                </p>
                <p>
                  As local businesses started asking for more — cloud migrations, phones,
                  cybersecurity, internet circuits — we evolved into a full hybrid managed
                  service provider. Today we run helpdesk, security, cloud, and networking for
                  manufacturers, medical practices, law firms, schools, and nonprofits across
                  North America.
                </p>
                <p>
                  We're proud to still be independently owned. Whether you're down the road
                  or across the country, when something breaks we respond fast — remote support
                  everywhere, and on-site for clients in New York.
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="relative h-[480px] rounded-3xl overflow-hidden shadow-2xl"
            >
              <img
                src={`${import.meta.env.BASE_URL}images/about-team.png`}
                alt="The Siebert Services team"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-navy/90 via-navy/30 to-transparent flex items-end p-8">
                <div>
                  <p className="text-white font-display font-bold text-2xl mb-1">
                    Local engineers. National partnerships.
                  </p>
                  <p className="text-white/80">
                    Headquartered at 4 Maple Court, Washingtonville, NY
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* MISSION & VALUES */}
      <section className="py-20 bg-white border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 mb-16">
            <div className="lg:col-span-1">
              <div className="text-primary text-xs font-bold tracking-widest uppercase mb-3">
                Mission & values
              </div>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-navy mb-4">
                What we believe.
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed">
                Our mission is simple: make enterprise-grade IT, security, and connectivity
                feel local, accessible, and accountable for every business we serve.
              </p>
            </div>
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-6">
              {VALUES.map((v) => (
                <Card key={v.title} className="bg-background border-none shadow-lg">
                  <CardContent className="p-7">
                    <div className="mb-5">{v.icon}</div>
                    <h3 className="text-lg font-bold text-navy mb-2">{v.title}</h3>
                    <p className="text-muted-foreground text-sm leading-relaxed">{v.desc}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* TEAM */}
      {team.length > 0 && (
        <section className="py-24">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <div className="text-primary text-xs font-bold tracking-widest uppercase mb-3">
                Meet the team
              </div>
              <h2 className="text-3xl md:text-4xl font-display font-bold text-navy mb-4">
                Senior engineers — not a call center.
              </h2>
              <p className="text-lg text-muted-foreground">
                The names and faces behind every ticket. Every Siebert client has direct access
                to the senior engineers who designed their environment.
              </p>
            </div>

            <div
              className={`grid grid-cols-1 md:grid-cols-2 ${
                team.length >= 4 ? "lg:grid-cols-4" : team.length === 3 ? "lg:grid-cols-3" : team.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-1 max-w-md mx-auto"
              } gap-6`}
            >
              {team.map((person, i) => {
                const accent = TEAM_ACCENTS[i % TEAM_ACCENTS.length];
                const initials = getInitials(person.name);
                return (
                  <motion.div
                    key={person.id}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                    className="rounded-2xl bg-white border border-border shadow-lg overflow-hidden hover:shadow-2xl hover:-translate-y-1 transition-all"
                  >
                    <div className={`h-32 bg-gradient-to-br ${accent} relative`}>
                      <div className="absolute -bottom-10 left-6 w-20 h-20 rounded-2xl bg-white shadow-xl flex items-center justify-center overflow-hidden">
                        {person.imageUrl ? (
                          <img
                            src={person.imageUrl}
                            alt={person.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-2xl font-display font-extrabold text-navy">
                            {initials}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="p-6 pt-12">
                      <h3 className="font-display font-bold text-navy text-lg">{person.name}</h3>
                      <p className="text-primary text-sm font-semibold mb-3">{person.role}</p>
                      {person.bio && (
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {person.bio}
                        </p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* CERTIFICATIONS */}
      <section className="py-16 bg-white border-y border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <CertificationsRow />
        </div>
      </section>

      {/* LOCAL ROOTS */}
      <section className="py-24 bg-gradient-to-br from-navy to-navy-light text-white relative overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-3xl mx-auto mb-14">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/15 border border-primary/30 text-primary font-bold text-xs tracking-widest uppercase mb-5">
              <MapPin className="w-3.5 h-3.5" /> Local roots
            </div>
            <h2 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Proudly serving businesses across North America.
            </h2>
            <p className="text-lg text-white/70">
              Headquartered in Washingtonville, NY, we provide remote support to businesses
              across North America, and on-site dispatch to clients in New York. Wherever you are, our engineers are available 24/7.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {SERVICE_AREA.map((area) => (
              <div
                key={area.county}
                className="rounded-2xl bg-white/5 border border-white/10 p-6 backdrop-blur"
              >
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  <h3 className="font-display font-bold text-lg">{area.county}</h3>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">
                  {area.towns.join(" · ")}
                </p>
              </div>
            ))}
          </div>

          <p className="text-center text-white/60 text-sm mt-10">
            Outside the area? We provide remote support to clients across all of North America. Just ask.
          </p>
        </div>
      </section>

      {/* TESTIMONIALS */}
      <TestimonialsSection
        title="Why our clients stay."
        subtitle="A few words from the businesses we've supported across North America."
        background="muted"
      />

      {/* CTA + multi-channel contact */}
      <section className="py-20 bg-primary/5 border-t border-primary/10">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-navy mb-4">
            Talk to a Siebert engineer today.
          </h2>
          <p className="text-lg text-muted-foreground mb-8">
            Three ways to reach us — pick whichever is easiest. We'll respond the same
            business day.
          </p>
          <div className="max-w-3xl mx-auto mb-8">
            <MultiChannelContactBar variant="inline" />
          </div>
          <Link href="/quote">
            <Button size="lg" className="h-14 px-8 text-lg">
              Get a Free IT Assessment
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
