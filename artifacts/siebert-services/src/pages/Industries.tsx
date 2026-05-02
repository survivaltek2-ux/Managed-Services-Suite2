import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Stethoscope,
  Scale,
  Landmark,
  Smile,
  ShieldCheck,
  Factory,
  ArrowRight,
} from "lucide-react";
import { Button, Card, CardContent } from "@/components/ui";
import { SchemaTag } from "@/components/SchemaTag";
import { BookingButton } from "@/components/Booking";
import { industries as staticIndustries, type Industry } from "@/data/industries";

const ICONS: Record<string, React.ReactElement> = {
  healthcare: <Stethoscope className="w-7 h-7" />,
  legal: <Scale className="w-7 h-7" />,
  "financial-services": <Landmark className="w-7 h-7" />,
  dental: <Smile className="w-7 h-7" />,
  "government-contractors": <ShieldCheck className="w-7 h-7" />,
  manufacturing: <Factory className="w-7 h-7" />,
};

export default function Industries() {
  const [industries, setIndustries] = useState<Industry[]>(staticIndustries);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/cms/industries")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Industry[] | null) => {
        if (cancelled) return;
        if (Array.isArray(d) && d.length > 0) setIndustries(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <SchemaTag
        id="schema-industries-index"
        type="WebPage"
        name="Industries we serve — Siebert Services"
        description="Specialized managed IT for healthcare, legal, financial services, dental, government contractors, and manufacturing businesses across North America."
      />
      <SchemaTag
        id="schema-industries-breadcrumb"
        type="BreadcrumbList"
        crumbs={[
          { name: "Home", url: "https://siebertservices.com/" },
          { name: "Industries", url: "https://siebertservices.com/industries" },
        ]}
      />

      {/* HERO */}
      <section className="pt-28 pb-16 lg:pt-32 lg:pb-20 bg-navy text-white border-b-4 border-primary">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-4">
            Industries we serve
          </p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold leading-tight mb-6 max-w-4xl">
            Managed IT, sized to the regulations and software your industry actually uses.
          </h1>
          <p className="text-lg md:text-xl text-white/80 max-w-3xl">
            Generic IT advice doesn't survive a HIPAA audit, an SEC exam, or a CMMC
            assessment. These pages cover what we do — and what we know — for the industries
            that power businesses across North America.
          </p>
        </div>
      </section>

      {/* GRID */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {industries.map((ind, i) => (
              <motion.div
                key={ind.slug}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
              >
                <Link href={`/industries/${ind.slug}`}>
                  <Card className="group h-full border-none shadow-md bg-white hover:shadow-2xl hover:-translate-y-1 transition-all cursor-pointer">
                    <CardContent className="p-7 flex flex-col h-full">
                      <div className="w-14 h-14 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-5 group-hover:scale-110 transition-transform">
                        {ICONS[ind.slug] ?? <ShieldCheck className="w-7 h-7" />}
                      </div>
                      <h2 className="text-xl font-bold text-navy mb-2">{ind.name}</h2>
                      <p className="text-sm text-muted-foreground mb-5 leading-relaxed flex-1">
                        {ind.shortLabel}. {ind.regulations
                          .slice(0, 2)
                          .map((r) => r.name.split(" ")[0])
                          .join(", ")} and the software your team actually runs.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-5">
                        {ind.regulations.slice(0, 3).map((r) => (
                          <span
                            key={r.name}
                            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-navy/5 text-navy"
                          >
                            {r.name.split(" ")[0].replace(/[^A-Za-z0-9-]/g, "")}
                          </span>
                        ))}
                      </div>
                      <span className="inline-flex items-center gap-1 text-primary text-sm font-semibold group-hover:gap-2 transition-all">
                        Explore {ind.name} IT <ArrowRight className="w-4 h-4" />
                      </span>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary/5 border-t border-primary/10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-navy mb-6">
            Don't see your industry?
          </h2>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            We work with plenty of businesses outside these six. Tell us what you do and
            what's keeping you up at night — we'll tell you straight whether we're a fit.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link href="/quote">
              <Button size="lg" className="w-full sm:w-auto">
                Get a free IT assessment
              </Button>
            </Link>
            <BookingButton
              size="lg"
              variant="outline"
              className="w-full sm:w-auto"
              label="Book a 15-min discovery call"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
