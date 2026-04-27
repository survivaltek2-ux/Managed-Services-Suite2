import { Link } from "wouter";
import { PublicLayout } from "@/components/layout/PublicLayout";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Shield, Zap, TrendingUp, Users, ArrowRight, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import heroScreenshot from "@assets/screenshot-1777289943362.png";

export default function PublicHome() {
  return (
    <PublicLayout>
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden flex-1 flex items-center">
        <div className="absolute inset-0 bg-slate-950 z-0">
          <img 
            src={heroScreenshot} 
            alt="800.com homepage screenshot" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-950/55 to-slate-950/90" />
        </div>
        
        <div className="container mx-auto px-4 relative z-10 text-center">
          <Badge variant="outline" className="mb-6 border-primary/50 text-primary-foreground bg-primary/20 backdrop-blur-md px-4 py-1">
            Partner Community
          </Badge>
          <h1 className="text-5xl md:text-7xl font-display font-extrabold text-white tracking-tight max-w-4xl mx-auto mb-6 leading-tight">
            Accelerate Your Growth with <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-400">Siebert Services</span>
          </h1>
          <p className="text-lg md:text-xl text-slate-300 max-w-2xl mx-auto mb-10 leading-relaxed">
            Join our elite network of technology resellers. Access enterprise-grade solutions, higher margins, deal protection, and co-marketing resources.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/register">
              <Button size="lg" className="w-full sm:w-auto text-base rounded-full px-8">
                Become a Partner <ArrowRight className="ml-2 w-4 h-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button variant="outline" size="lg" className="w-full sm:w-auto text-base rounded-full px-8 bg-white/5 border-white/10 text-white hover:bg-white/10 hover:text-white">
                Partner Login
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-24 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">Why Partner With Us?</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">We provide the tools, support, and margins you need to build a profitable recurring revenue stream.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {[
              { icon: TrendingUp, title: "Aggressive Margins", desc: "Earn highly competitive margins on hardware, software, and recurring managed services." },
              { icon: Shield, title: "Deal Protection", desc: "Register your opportunities to guarantee your pricing and protect your deals from channel conflict." },
              { icon: Zap, title: "Zoom Agent", desc: "Become an authorized Zoom reseller with access to the full product portfolio, dedicated partner support, and margin-optimized pricing." }
            ].map((feature, i) => (
              <div key={i} className="bg-card p-8 rounded-2xl shadow-sm border border-border/50 hover:shadow-md transition-shadow">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center mb-6">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-foreground">{feature.title}</h3>
                <p className="text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tiers */}
      <section className="py-24 bg-slate-50 dark:bg-slate-900/50 border-y border-border">
        <div className="container mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground mb-4">Partner Tiers</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">Grow with us and unlock deeper benefits as you advance through our tier system.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <TierCard 
              name="Silver" 
              image="tier-silver.png"
              features={["Base Margins", "Deal Registration", "Marketing Portal Access", "Standard Support"]} 
            />
            <TierCard 
              name="Gold" 
              image="tier-gold.png"
              featured
              features={["Accelerated Margins", "Lead Distribution", "Dedicated Channel Manager", "Co-branded Campaigns", "Priority Support"]} 
            />
            <TierCard 
              name="Platinum" 
              image="tier-platinum.png"
              features={["Highest Margins", "Premium Lead Routing", "Executive Sponsorship", "24/7 VIP Support"]} 
            />
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function TierCard({ name, image, features, featured = false }: { name: string, image: string, features: string[], featured?: boolean }) {
  return (
    <div className={cn(
      "rounded-3xl p-8 relative flex flex-col bg-card",
      featured ? "border-2 border-primary shadow-xl scale-105 z-10" : "border border-border/50 shadow-sm"
    )}>
      {featured && <div className="absolute -top-4 inset-x-0 flex justify-center"><Badge className="bg-primary text-primary-foreground shadow-md">Most Popular</Badge></div>}
      <div className="mb-6 flex justify-center">
        <img src={`${import.meta.env.BASE_URL}images/${image}`} alt={`${name} Tier`} className="w-24 h-24 drop-shadow-xl" />
      </div>
      <h3 className="text-2xl font-display font-bold text-center mb-2">{name}</h3>
      <p className="text-center text-sm text-muted-foreground mb-8 pb-8 border-b border-border/50">Partner Level</p>
      <ul className="space-y-4 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />
            <span className="text-sm font-medium text-foreground/80">{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
