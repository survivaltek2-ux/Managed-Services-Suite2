import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard, Settings, Briefcase, MessageSquare, Users, HelpCircle,
  Inbox, FileText, Ticket as TicketIcon, LogOut, Loader2, Plus, Edit2,
  Trash2, Save, Search, Download, Activity, PenTool, Eye, Send, Check,
  X, ChevronDown, BarChart3, BarChart2, Clock, DollarSign, AlertCircle, Mail, KeyRound,
  RefreshCw, CreditCard, TrendingUp, Package, Award, Filter, Calendar
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar,
} from "recharts";
import {
  Button, Input, Textarea, Label, Card, CardHeader, CardTitle, CardDescription, CardContent, Badge,
} from "@/components/ui";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import AdminLeads from "./AdminLeads";

type TabType = "dashboard" | "settings" | "services" | "testimonials" | "team" | "faq" | "blog" | "calendar" | "users" | "activity" | "tsdIntegrations" | "reporting" | "inquiries" | "invoices" | "leads" | "leadMagnets" | "caseStudies" | "certifications" | "companyStats" | "pricingTiers" | "industries" | "import";

const TABS: { id: TabType; label: string; icon: React.ReactNode; section?: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} />, section: "Overview" },
  { id: "inquiries", label: "Inquiries", icon: <Inbox size={18} />, section: "Management" },
  { id: "leads", label: "Partner Leads", icon: <Briefcase size={18} />, section: "Management" },
  { id: "leadMagnets", label: "Lead Magnets", icon: <FileText size={18} /> },
  { id: "invoices", label: "Invoices", icon: <CreditCard size={18} /> },
  { id: "blog", label: "Blog Posts", icon: <PenTool size={18} />, section: "Content" },
  { id: "calendar", label: "Editorial Calendar", icon: <Clock size={18} /> },
  { id: "services", label: "Services", icon: <Briefcase size={18} /> },
  { id: "testimonials", label: "Testimonials", icon: <MessageSquare size={18} /> },
  { id: "caseStudies", label: "Case Studies", icon: <FileText size={18} /> },
  { id: "certifications", label: "Certifications", icon: <Award size={18} /> },
  { id: "companyStats", label: "Company Stats", icon: <TrendingUp size={18} /> },
  { id: "pricingTiers", label: "Pricing Tiers", icon: <DollarSign size={18} /> },
  { id: "industries", label: "Industries", icon: <Package size={18} /> },
  { id: "team", label: "Team Members", icon: <Users size={18} /> },
  { id: "faq", label: "FAQ", icon: <HelpCircle size={18} /> },
  { id: "settings", label: "Site Settings", icon: <Settings size={18} /> },
  { id: "tsdIntegrations", label: "TSD Integrations", icon: <RefreshCw size={18} />, section: "Integrations" },
  { id: "users", label: "Users", icon: <Users size={18} />, section: "System" },
  { id: "import", label: "Bulk Import", icon: <Package size={18} /> },
  { id: "reporting", label: "Reporting", icon: <BarChart2 size={18} /> },
  { id: "activity", label: "Activity Log", icon: <Activity size={18} /> },
];

export default function Admin() {
  const { user, token, login, logout, isAuthenticated } = useAuth();
  const { toast } = useToast();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginMode, setLoginMode] = useState<"password" | "code">("password");
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Record<string, any>>({});

  const isAdmin = user?.role === "admin";
  const headers = () => ({
    "Authorization": `Bearer ${token || localStorage.getItem("siebert_token")}`,
    "Content-Type": "application/json"
  });

  useEffect(() => {
    if (isAuthenticated && isAdmin) fetchData(activeTab);
    else setLoading(false);
  }, [isAuthenticated, isAdmin, activeTab]);

  const fetchData = async (tab: TabType) => {
    setLoading(true);
    try {
      const endpoints: Record<string, string> = {
        dashboard: "/api/admin/dashboard/stats",
        settings: "/api/admin/cms/settings",
        smtp: "/api/admin/smtp",
        services: "/api/admin/cms/services",
        testimonials: "/api/admin/cms/testimonials",
        team: "/api/admin/cms/team",
        faq: "/api/admin/cms/faq",
        blog: "/api/admin/cms/blog",
        calendar: "/api/admin/cms/blog",
        users: "/api/admin/users",
        activity: "/api/admin/activity",
        tsdIntegrations: "/api/admin/tsd/configs",
        reporting: "/api/admin/reports",
        inquiries: "/api/admin/contacts",
        invoices: "/api/admin/invoices",
        caseStudies: "/api/admin/cms/case-studies",
        certifications: "/api/admin/cms/certifications",
        companyStats: "/api/admin/cms/company-stats",
        pricingTiers: "/api/admin/cms/pricing-tiers",
        industries: "/api/admin/cms/industries",
      };
      if (tab === "inquiries") {
        const [contactRes, quoteRes, ticketRes] = await Promise.all([
          fetch("/api/admin/contacts", { headers: headers() }),
          fetch("/api/admin/quotes", { headers: headers() }),
          fetch("/api/admin/tickets", { headers: headers() }),
        ]);
        const [contactData, quoteData, ticketData] = await Promise.all([
          contactRes.ok ? contactRes.json() : [],
          quoteRes.ok ? quoteRes.json() : [],
          ticketRes.ok ? ticketRes.json() : [],
        ]);
        setData(prev => ({ ...prev, contacts: contactData, quotes: quoteData, tickets: ticketData }));
        setLoading(false);
        return;
      }
      if (tab === "tsdIntegrations") {
        const [cfgRes, logRes, productRes] = await Promise.all([
          fetch(endpoints["tsdIntegrations"], { headers: headers() }),
          fetch("/api/admin/tsd/logs?limit=50", { headers: headers() }),
          fetch("/api/admin/tsd-products", { headers: headers() }),
        ]);
        const [cfgData, logData, productData] = await Promise.all([
          cfgRes.ok ? cfgRes.json() : [],
          logRes.ok ? logRes.json() : [],
          productRes.ok ? productRes.json() : [],
        ]);
        setData(prev => ({ ...prev, tsdConfigs: cfgData, tsdLogs: logData, tsdProducts: productData }));
        setLoading(false);
        return;
      }
      if (tab === "leads") {
        const partnersRes = await fetch("/api/admin/partners", { headers: headers() });
        const partnersData = partnersRes.ok ? await partnersRes.json() : [];
        setData(prev => ({ ...prev, partners: partnersData }));
        setLoading(false);
        return;
      }
      if (tab === "leadMagnets") {
        const r = await fetch("/api/admin/lead-magnets", { headers: headers() });
        const d = r.ok ? await r.json() : [];
        setData(prev => ({ ...prev, leadMagnets: d }));
        setLoading(false);
        return;
      }
      if (tab === "settings") {
        const [cmsRes, smtpRes] = await Promise.all([
          fetch(endpoints["settings"], { headers: headers() }),
          fetch(endpoints["smtp"], { headers: headers() }),
        ]);
        const [cmsData, smtpData] = await Promise.all([
          cmsRes.ok ? cmsRes.json() : null,
          smtpRes.ok ? smtpRes.json() : null,
        ]);
        setData(prev => ({ ...prev, ...(cmsData ? { settings: cmsData } : {}), ...(smtpData ? { smtp: smtpData } : {}) }));
      } else {
        const res = await fetch(endpoints[tab], { headers: headers() });
        if (res.ok) {
          const result = await res.json();
          setData(prev => ({ ...prev, [tab]: result }));
        }
      }
    } catch (error) {
      console.error(`Error fetching ${tab}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const d = await res.json();
      console.log("Login response:", { status: res.status, ok: res.ok, data: d });
      if (res.ok) {
        if (d.user.role === "admin") {
          login(d.token, d.user);
          toast({ title: "Logged in as Admin" });
        } else {
          setLoginError(`Access denied. Your role is '${d.user.role}', admin required.`);
        }
      } else {
        console.error("Login failed:", d);
        setLoginError(d.message || "Invalid credentials");
      }
    } catch (err: any) {
      console.error("Login exception:", err);
      setLoginError(err?.message || "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const exportCSV = async (type: string) => {
    try {
      const res = await fetch(`/api/admin/export/${type}`, { headers: headers() });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${type}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: `${type} exported` });
      }
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) { setLoginError("Please enter your email address."); return; }
    setLoginError("");
    setCodeLoading(true);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), type: "user" }),
      });
      const d = await res.json();
      if (res.ok) setCodeSent(true);
      else setLoginError(d.message || "Failed to send code.");
    } catch { setLoginError("Failed to send code."); }
    finally { setCodeLoading(false); }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setCodeLoading(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code, type: "user" }),
      });
      const d = await res.json();
      if (res.ok) {
        if (d.user.role === "admin") { login(d.token, d.user); toast({ title: "Logged in as Admin" }); }
        else setLoginError(`Access denied. Role '${d.user.role}' is not admin.`);
      } else setLoginError(d.message || "Invalid or expired code.");
    } catch { setLoginError("Failed to verify code."); }
    finally { setCodeLoading(false); }
  };

  if (!isAuthenticated || !isAdmin) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center pb-2">
            <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Settings className="text-primary w-6 h-6" />
            </div>
            <CardTitle>Admin Access</CardTitle>
            <p className="text-sm text-muted-foreground mt-2">Sign in with your administrator account</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex rounded-lg border overflow-hidden">
              <button type="button" onClick={() => { setLoginMode("password"); setLoginError(""); setCodeSent(false); setCode(""); }} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold transition-colors ${loginMode === "password" ? "bg-primary text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
                <KeyRound className="w-3.5 h-3.5" /> Password
              </button>
              <button type="button" onClick={() => { setLoginMode("code"); setLoginError(""); setCodeSent(false); setCode(""); }} className={`flex-1 flex items-center justify-center gap-2 py-2 text-sm font-semibold transition-colors ${loginMode === "code" ? "bg-primary text-white" : "bg-muted/50 text-muted-foreground hover:bg-muted"}`}>
                <Mail className="w-3.5 h-3.5" /> Email Code
              </button>
            </div>

            {loginError && <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">{loginError}</div>}

            {loginMode === "password" ? (
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" required value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
                </div>
                <Button type="submit" className="w-full" disabled={isLoggingIn}>
                  {isLoggingIn && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Sign In
                </Button>
              </form>
            ) : !codeSent ? (
              <form onSubmit={handleRequestCode} className="space-y-4">
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" />
                </div>
                <Button type="submit" className="w-full" disabled={codeLoading}>
                  <Mail className="w-4 h-4 mr-2" />{codeLoading ? "Sending..." : "Send Login Code"}
                </Button>
              </form>
            ) : (
              <form onSubmit={handleVerifyCode} className="space-y-4">
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center text-sm">
                  <p className="text-muted-foreground">Code sent to <strong>{email}</strong></p>
                </div>
                <div className="space-y-2">
                  <Label>6-Digit Code</Label>
                  <Input type="text" required value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" maxLength={6} className="text-center text-xl tracking-widest font-bold" />
                </div>
                <Button type="submit" className="w-full" disabled={codeLoading || code.length !== 6}>
                  {codeLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Verify & Sign In
                </Button>
                <button type="button" onClick={() => { setCodeSent(false); setCode(""); setLoginError(""); }} className="w-full text-sm text-muted-foreground hover:text-foreground">
                  Didn't receive it? Send again
                </button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  let lastSection = "";
  return (
    <div className="min-h-screen flex bg-muted/30">
      <aside className="w-60 bg-navy text-white flex-shrink-0 flex flex-col h-screen sticky top-0">
        <div className="p-5">
          <h2 className="text-lg font-bold font-display tracking-tight text-white/90 flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" /> CMS Admin
          </h2>
        </div>
        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {TABS.map((tab) => {
            const showSection = tab.section && tab.section !== lastSection;
            if (tab.section) lastSection = tab.section;
            return (
              <React.Fragment key={tab.id}>
                {showSection && (
                  <div className="text-[10px] uppercase tracking-wider text-white/40 pt-4 pb-1 px-3 font-semibold">
                    {tab.section}
                  </div>
                )}
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    activeTab === tab.id
                      ? "bg-primary text-primary-foreground"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {tab.icon}{tab.label}
                </button>
              </React.Fragment>
            );
          })}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2 mb-3 px-2">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs">
              {user?.name?.charAt(0) || "A"}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-xs font-medium text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-white/50 truncate">{user?.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-white/70 hover:text-white hover:bg-white/10 text-xs"
            onClick={() => { logout(); toast({ title: "Logged out" }); }}>
            <LogOut className="w-3.5 h-3.5 mr-2" />Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto min-h-screen p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-navy capitalize tracking-tight">
              {TABS.find(t => t.id === activeTab)?.label}
            </h1>
          </div>
          {loading ? (
            <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
          ) : (
            <div className="animate-fade-in">
              {activeTab === "dashboard" && <DashboardTab stats={data.dashboard} />}
              {activeTab === "settings" && <SettingsTab data={data.settings} smtp={data.smtp} refresh={() => fetchData("settings")} headers={headers} />}
              {activeTab === "services" && <CrudTab items={data.services || []} refresh={() => fetchData("services")} headers={headers} entity="services" fields={[
                { key: "title", label: "Title", type: "text", required: true },
                { key: "description", label: "Description", type: "textarea", required: true },
                { key: "icon", label: "Icon", type: "text" },
                { key: "category", label: "Category", type: "text" },
                { key: "features", label: "Features (one per line)", type: "features" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["title", "category", "active"]} />}
              {activeTab === "testimonials" && <CrudTab items={data.testimonials || []} refresh={() => fetchData("testimonials")} headers={headers} entity="testimonials" fields={[
                { key: "name", label: "Name", type: "text", required: true },
                { key: "company", label: "Company", type: "text", required: true },
                { key: "role", label: "Role", type: "text" },
                { key: "content", label: "Content", type: "textarea", required: true },
                { key: "rating", label: "Rating (1-5)", type: "number" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["name", "company", "rating", "active"]} />}
              {activeTab === "team" && <CrudTab items={data.team || []} refresh={() => fetchData("team")} headers={headers} entity="team" fields={[
                { key: "name", label: "Name", type: "text", required: true },
                { key: "role", label: "Role", type: "text", required: true },
                { key: "bio", label: "Bio", type: "textarea" },
                { key: "imageUrl", label: "Image URL", type: "text" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["name", "role", "active"]} />}
              {activeTab === "faq" && <CrudTab items={data.faq || []} refresh={() => fetchData("faq")} headers={headers} entity="faq" fields={[
                { key: "question", label: "Question", type: "text", required: true },
                { key: "answer", label: "Answer", type: "textarea", required: true },
                { key: "category", label: "Category", type: "text" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["question", "category", "active"]} />}
              {activeTab === "blog" && <BlogTab posts={data.blog || []} refresh={() => fetchData("blog")} headers={headers} />}
              {activeTab === "calendar" && <EditorialCalendarTab posts={data.calendar || []} refresh={() => fetchData("calendar")} headers={headers} />}
              {activeTab === "caseStudies" && <CrudTab items={data.caseStudies || []} refresh={() => fetchData("caseStudies")} headers={headers} entity="case-studies" fields={[
                { key: "title", label: "Title", type: "text", required: true },
                { key: "slug", label: "Slug (auto if blank)", type: "text" },
                { key: "client", label: "Client", type: "text" },
                { key: "industry", label: "Industry", type: "text" },
                { key: "summary", label: "Summary (1-2 sentences)", type: "textarea", required: true },
                { key: "problem", label: "Problem", type: "textarea" },
                { key: "solution", label: "Solution", type: "textarea" },
                { key: "result", label: "Result", type: "textarea" },
                { key: "metrics", label: 'Metrics (JSON, e.g. [{"label":"Cost","value":"-42%"}])', type: "json" },
                { key: "services", label: "Services (one per line)", type: "features" },
                { key: "quote", label: "Pull quote", type: "textarea" },
                { key: "quoteAuthor", label: "Quote author", type: "text" },
                { key: "quoteRole", label: "Quote role/company", type: "text" },
                { key: "coverImage", label: "Cover image URL", type: "text" },
                { key: "logoUrl", label: "Client logo URL", type: "text" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "featured", label: "Featured", type: "checkbox" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["title", "client", "industry", "active"]} />}
              {activeTab === "certifications" && <CrudTab items={data.certifications || []} refresh={() => fetchData("certifications")} headers={headers} entity="certifications" fields={[
                { key: "name", label: "Name", type: "text", required: true },
                { key: "category", label: "Category (partner/certification)", type: "text" },
                { key: "logoUrl", label: "Logo URL (optional)", type: "text" },
                { key: "url", label: "Link URL (optional)", type: "text" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["name", "category", "active"]} />}
              {activeTab === "pricingTiers" && <CrudTab items={data.pricingTiers || []} refresh={() => fetchData("pricingTiers")} headers={headers} entity="pricing-tiers" fields={[
                { key: "name", label: "Name (e.g. Essentials, Business, Enterprise)", type: "text", required: true },
                { key: "slug", label: "Slug (auto if blank)", type: "text" },
                { key: "tagline", label: "Tagline (1 line)", type: "text" },
                { key: "pricePrefix", label: "Price prefix (e.g. Starting at)", type: "text" },
                { key: "startingPrice", label: "Monthly price (number, no $)", type: "text", required: true },
                { key: "annualPrice", label: "Annual-equivalent monthly price (number, no $) — shown when annual toggle is on", type: "text" },
                { key: "priceUnit", label: "Price unit (e.g. per user / month)", type: "text" },
                { key: "features", label: "Included features (one per line)", type: "features" },
                { key: "excludedFeatures", label: "Excluded features (one per line)", type: "features" },
                { key: "ctaLabel", label: "CTA button label", type: "text" },
                { key: "ctaLink", label: "CTA link (e.g. /quote)", type: "text" },
                { key: "mostPopular", label: "Mark as Most Popular", type: "checkbox" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
                { key: "stripeProductId", label: "Stripe Product ID (e.g. prod_…) — leave blank to auto-create", type: "text" },
                { key: "stripeMonthlyPriceId", label: "Stripe Monthly Price ID (e.g. price_…) — leave blank to auto-create", type: "text" },
                { key: "stripeAnnualPriceId", label: "Stripe Annual Price ID (e.g. price_…) — leave blank to auto-create", type: "text" },
              ]} columns={["name", "startingPrice", "mostPopular", "active", "stripe"]}
              columnLabels={{ stripe: "Stripe" }}
              customCells={{
                stripe: (item) => {
                  const hasProduct = !!item.stripeProductId;
                  const hasMonthly = !!item.stripeMonthlyPriceId;
                  const hasAnnual = !!item.stripeAnnualPriceId;
                  const allSet = hasProduct && hasMonthly && hasAnnual;
                  const pricesIncomplete = hasProduct && (!hasMonthly || !hasAnnual);
                  return (
                    <div className="flex flex-col gap-1">
                      {hasProduct ? (
                        <a
                          href={`https://dashboard.stripe.com/products/${encodeURIComponent(item.stripeProductId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={[
                            `Product: ${item.stripeProductId}`,
                            `Monthly price: ${hasMonthly ? item.stripeMonthlyPriceId : "not linked"}`,
                            `Annual price: ${hasAnnual ? item.stripeAnnualPriceId : "not linked"}`,
                          ].join("\n")}
                          className="inline-flex items-center gap-1"
                        >
                          <Badge variant="default" className={`cursor-pointer text-white gap-1 ${pricesIncomplete ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-600 hover:bg-emerald-700"}`}>
                            {pricesIncomplete
                              ? <AlertCircle className="w-3 h-3" />
                              : <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3"><path d="M8 0C3.58 0 0 3.58 0 8s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm3.43 11.57c-.18.1-.42.05-.52-.13L8 6.93l-2.91 4.51c-.1.18-.34.23-.52.13-.18-.1-.23-.34-.13-.52L7.5 6l-2.5-.5c-.2-.04-.33-.23-.29-.43.04-.2.23-.33.43-.29L8 5.3l2.86-.52c.2-.04.39.09.43.29.04.2-.09.39-.29.43L8.5 6l3.06 5.05c.1.18.05.42-.13.52z"/></svg>
                            }
                            {allSet ? "Linked" : "Prices missing"}
                          </Badge>
                        </a>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">Unlinked</Badge>
                      )}
                      {hasProduct && (
                        <div className="flex gap-1.5 text-[10px] font-medium">
                          <span
                            title={hasMonthly ? `Monthly: ${item.stripeMonthlyPriceId}` : "Monthly price not linked"}
                            className={`inline-flex items-center gap-0.5 ${hasMonthly ? "text-emerald-700" : "text-amber-600"}`}
                          >
                            {hasMonthly ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                            Mo
                          </span>
                          <span
                            title={hasAnnual ? `Annual: ${item.stripeAnnualPriceId}` : "Annual price not linked"}
                            className={`inline-flex items-center gap-0.5 ${hasAnnual ? "text-emerald-700" : "text-amber-600"}`}
                          >
                            {hasAnnual ? <Check className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                            Yr
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }
              }}
              />}
              {activeTab === "industries" && <CrudTab items={data.industries || []} refresh={() => fetchData("industries")} headers={headers} entity="industries" fields={[
                { key: "name", label: "Name (e.g. Healthcare)", type: "text", required: true },
                { key: "slug", label: "Slug (auto if blank, e.g. healthcare)", type: "text" },
                { key: "shortLabel", label: "Short label (e.g. Healthcare & medical practices)", type: "text" },
                { key: "navTitle", label: "Nav title (e.g. Healthcare IT)", type: "text" },
                { key: "metaDescription", label: "Meta description (SEO)", type: "textarea" },
                { key: "heroEyebrow", label: "Hero eyebrow (e.g. Industry · Healthcare)", type: "text" },
                { key: "heroTitle", label: "Hero title", type: "textarea" },
                { key: "heroSubtitle", label: "Hero subtitle", type: "textarea" },
                { key: "painPoints", label: 'Pain points (JSON, e.g. [{"title":"...","description":"..."}])', type: "json" },
                { key: "regulations", label: 'Regulations (JSON, e.g. [{"name":"...","description":"..."}])', type: "json" },
                { key: "softwareStacks", label: 'Software stacks (JSON, e.g. [{"category":"...","items":["A","B"]}])', type: "json" },
                { key: "whatWeDo", label: "What we do (one per line)", type: "features" },
                { key: "testimonialQuote", label: "Testimonial quote", type: "textarea" },
                { key: "testimonialName", label: "Testimonial name", type: "text" },
                { key: "testimonialRole", label: "Testimonial role", type: "text" },
                { key: "testimonialCompany", label: "Testimonial company", type: "text" },
                { key: "caseStudyHint", label: "Case study hint (one line)", type: "text" },
                { key: "relatedServices", label: 'Related services (JSON, e.g. [{"title":"...","href":"/services","description":"..."}])', type: "json" },
                { key: "ctaLabel", label: "CTA button label", type: "text" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["name", "slug", "navTitle", "active"]} />}
              {activeTab === "companyStats" && <CrudTab items={data.companyStats || []} refresh={() => fetchData("companyStats")} headers={headers} entity="company-stats" fields={[
                { key: "label", label: "Label (e.g. Average response time)", type: "text", required: true },
                { key: "value", label: "Value (e.g. 98 or < 10)", type: "text", required: true },
                { key: "suffix", label: "Suffix (e.g. % or min)", type: "text" },
                { key: "icon", label: "Icon (lucide name, e.g. Clock, Heart, Award)", type: "text" },
                { key: "sortOrder", label: "Sort Order", type: "number" },
                { key: "active", label: "Active", type: "checkbox" },
              ]} columns={["label", "value", "active"]} />}
              {activeTab === "inquiries" && <InquiriesTab contacts={data.contacts || []} quotes={data.quotes || []} tickets={data.tickets || []} headers={headers} refresh={() => fetchData("inquiries")} toast={toast} />}
              {activeTab === "invoices" && <InvoicesTab invoices={data.invoices || []} headers={headers} refresh={() => fetchData("invoices")} />}
              {activeTab === "leads" && <AdminLeads partners={data.partners || []} headers={headers} refresh={() => fetchData("leads")} toast={toast} />}
              {activeTab === "leadMagnets" && <LeadMagnetsTab submissions={data.leadMagnets || []} headers={headers} refresh={() => fetchData("leadMagnets")} toast={toast} />}
              {activeTab === "tsdIntegrations" && <TsdIntegrationsTab configs={data.tsdConfigs || []} logs={data.tsdLogs || []} products={data.tsdProducts || []} headers={headers} refresh={() => fetchData("tsdIntegrations")} toast={toast} />}
              {activeTab === "users" && <UsersTab users={data.users || []} refresh={() => fetchData("users")} headers={headers} currentUserId={user?.id} />}
              {activeTab === "import" && <ImportTab headers={headers} />}
              {activeTab === "activity" && <ActivityTab activities={data.activity || []} />}
              {activeTab === "reporting" && <ReportingTab data={data.reporting} />}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function StatCard({ title, value, icon, sub }: { title: string; value: string | number; icon: React.ReactNode; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0">{icon}</div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold text-navy">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
      <Input className="pl-9 h-9" placeholder={placeholder || "Search..."} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function DashboardTab({ stats }: { stats: any }) {
  if (!stats) return <p className="text-muted-foreground">Loading stats...</p>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard title="Contacts" value={stats.contacts} icon={<Inbox className="text-blue-500 w-5 h-5" />} />
        <StatCard title="Quotes" value={stats.quotes} icon={<FileText className="text-emerald-500 w-5 h-5" />} />
        <StatCard title="Tickets" value={stats.tickets} icon={<TicketIcon className="text-amber-500 w-5 h-5" />} />
        <StatCard title="Open Tickets" value={stats.openTickets} icon={<AlertCircle className="text-red-500 w-5 h-5" />} />
        <StatCard title="Blog Posts" value={stats.blogPosts} icon={<PenTool className="text-purple-500 w-5 h-5" />} />
        <StatCard title="Users" value={stats.users} icon={<Users className="text-teal-500 w-5 h-5" />} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Contacts</CardTitle></CardHeader>
          <CardContent>
            {stats.recentContacts?.length > 0 ? (
              <div className="space-y-3">
                {stats.recentContacts.map((c: any) => (
                  <div key={c.id} className="flex justify-between items-center text-sm">
                    <div>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No contacts yet</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Quote Requests</CardTitle></CardHeader>
          <CardContent>
            {stats.recentQuotes?.length > 0 ? (
              <div className="space-y-3">
                {stats.recentQuotes.map((q: any) => (
                  <div key={q.id} className="flex justify-between items-center text-sm">
                    <div>
                      <p className="font-medium">{q.company}</p>
                      <p className="text-xs text-muted-foreground">{q.name} - {q.budget || "No budget"}</p>
                    </div>
                    <Badge variant={q.status === "pending" ? "default" : "secondary"}>{q.status}</Badge>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-muted-foreground">No quotes yet</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SettingsTab({ data, smtp, refresh, headers }: { data: any; smtp: any; refresh: () => void; headers: () => any }) {
  const { toast } = useToast();
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [smtpForm, setSmtpForm] = useState({ smtp_host: "", smtp_port: "587", smtp_user: "", smtp_pass: "", smtp_from_email: "", smtp_from_name: "", notification_email: "" });
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpTesting, setSmtpTesting] = useState(false);

  useEffect(() => {
    if (Array.isArray(data)) {
      const m: Record<string, string> = {};
      data.forEach((s: any) => { m[s.key] = s.value; });
      setFormData(m);
    } else if (data && typeof data === "object") {
      setFormData(data);
    }
  }, [data]);

  useEffect(() => {
    if (smtp && typeof smtp === "object") {
      setSmtpForm({
        smtp_host: smtp.host || "",
        smtp_port: String(smtp.port || "587"),
        smtp_user: smtp.user || "",
        smtp_pass: smtp.passSet ? "••••••••" : "",
        smtp_from_email: smtp.fromEmail || "",
        smtp_from_name: smtp.fromName || "",
        notification_email: smtp.notificationEmail || "",
      });
    }
  }, [smtp]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/cms/settings", {
        method: "PUT", headers: headers(), body: JSON.stringify(formData),
      });
      if (res.ok) { toast({ title: "Site settings saved" }); refresh(); }
      else toast({ title: "Failed to save", variant: "destructive" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleSmtpSave = async () => {
    setSmtpSaving(true);
    try {
      const res = await fetch("/api/admin/smtp", {
        method: "PUT", headers: headers(), body: JSON.stringify(smtpForm),
      });
      if (res.ok) { toast({ title: "Email settings saved" }); refresh(); }
      else toast({ title: "Failed to save email settings", variant: "destructive" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
    finally { setSmtpSaving(false); }
  };

  const handleSmtpTest = async () => {
    setSmtpTesting(true);
    try {
      const res = await fetch("/api/admin/smtp/test", { method: "POST", headers: headers() });
      const d = await res.json();
      if (d.ok) {
        toast({ title: "Connection successful", description: "SMTP is configured and working." });
      } else {
        toast({ title: "Connection failed", description: d.error || "Check your email settings.", variant: "destructive" });
      }
    } catch { toast({ title: "Test failed", variant: "destructive" }); }
    finally { setSmtpTesting(false); }
  };

  const textareas = ["hero_description", "about_story", "zoom_partner_description"];
  const hiddenFromSiteContent = new Set(["receipt_email_enabled", "receipt_email_intro"]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" /> Email Configuration</CardTitle>
            {smtp?.activeProvider === "microsoft365" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium"><Check className="w-3 h-3" />Microsoft 365 SMTP Active</span>}
            {smtp?.activeProvider === "none" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs font-medium"><AlertCircle className="w-3 h-3" />Not Configured</span>}
          </div>
          <p className="text-xs text-muted-foreground">Configure outbound email for notifications and login codes.</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="text-sm font-semibold mb-3">SMTP Configuration</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">SMTP Host</Label>
                <Input value={smtpForm.smtp_host} onChange={e => setSmtpForm(p => ({ ...p, smtp_host: e.target.value }))} placeholder="smtp.office365.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">SMTP Port</Label>
                <Input value={smtpForm.smtp_port} onChange={e => setSmtpForm(p => ({ ...p, smtp_port: e.target.value }))} placeholder="587" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Username</Label>
                <Input value={smtpForm.smtp_user} onChange={e => setSmtpForm(p => ({ ...p, smtp_user: e.target.value }))} placeholder="postmaster@mg.yourdomain.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Password</Label>
                <Input type="password" value={smtpForm.smtp_pass} onChange={e => setSmtpForm(p => ({ ...p, smtp_pass: e.target.value }))} placeholder={smtp?.passSet ? "Leave blank to keep current" : "SMTP password"} />
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-semibold mb-3">Sender &amp; Notifications</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-xs">From Email</Label>
                <Input value={smtpForm.smtp_from_email} onChange={e => setSmtpForm(p => ({ ...p, smtp_from_email: e.target.value }))} placeholder="notifications@siebertrservices.com" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">From Name</Label>
                <Input value={smtpForm.smtp_from_name} onChange={e => setSmtpForm(p => ({ ...p, smtp_from_name: e.target.value }))} placeholder="Siebert Services" />
              </div>
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs">Admin Notification Email</Label>
                <Input value={smtpForm.notification_email} onChange={e => setSmtpForm(p => ({ ...p, notification_email: e.target.value }))} placeholder="sales@siebertrservices.com" />
                <p className="text-xs text-muted-foreground">Contact forms, quotes, and deal registrations are sent here.</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2 border-t">
            <Button onClick={handleSmtpSave} disabled={smtpSaving}>
              {smtpSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Email Settings
            </Button>
            <Button variant="outline" onClick={handleSmtpTest} disabled={smtpTesting}>
              {smtpTesting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Mail className="w-4 h-4 mr-2" />}Test Connection
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Mail className="w-4 h-4" /> Payment Receipt Emails</CardTitle>
          <p className="text-xs text-muted-foreground">When a Stripe invoice is paid, an automatic receipt is sent to the client. Configure that email here.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="receipt_email_enabled"
              checked={formData["receipt_email_enabled"] !== "false"}
              onChange={e => setFormData(p => ({ ...p, receipt_email_enabled: e.target.checked ? "true" : "false" }))}
              className="h-4 w-4 rounded border-gray-300 accent-primary"
            />
            <Label htmlFor="receipt_email_enabled" className="text-sm cursor-pointer">
              Send receipt email automatically when a Stripe invoice is paid
            </Label>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Receipt Email Intro Message <span className="text-muted-foreground font-normal">(optional — leave blank to use the default)</span></Label>
            <Textarea
              value={formData["receipt_email_intro"] || ""}
              onChange={e => setFormData(p => ({ ...p, receipt_email_intro: e.target.value }))}
              placeholder="Thank you for your payment. Your invoice has been paid and your services are active. A summary is below for your records."
              className="min-h-[72px]"
            />
          </div>
          <div className="pt-1">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Receipt Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Settings className="w-4 h-4" /> Site Content</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(formData).filter(([key]) => !hiddenFromSiteContent.has(key)).map(([key, value]) => (
              <div key={key} className={textareas.includes(key) ? "md:col-span-2 space-y-1" : "space-y-1"}>
                <Label className="text-xs capitalize">{key.replace(/_/g, " ")}</Label>
                {textareas.includes(key)
                  ? <Textarea value={value} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} className="min-h-[80px]" />
                  : <Input value={value} onChange={e => setFormData(p => ({ ...p, [key]: e.target.value }))} />}
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-4 border-t">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}Save Site Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      <SsoDomainRulesCard headers={headers} />
    </div>
  );
}

function SsoDomainRulesCard({ headers }: { headers: () => any }) {
  const { toast } = useToast();
  const [rules, setRules] = useState<Array<{ domain: string; role: "client" | "admin" }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/sso-domain-rules", { headers: headers() })
      .then(r => r.json())
      .then(d => { setRules(d.rules || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const addRule = () => setRules(prev => [...prev, { domain: "", role: "client" }]);
  const removeRule = (i: number) => setRules(prev => prev.filter((_, idx) => idx !== i));
  const updateRule = (i: number, field: "domain" | "role", value: string) =>
    setRules(prev => prev.map((r, idx) => {
      if (idx !== i) return r;
      if (field === "role") return { ...r, role: value as "client" | "admin" };
      return { ...r, domain: value };
    }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/sso-domain-rules", {
        method: "PUT", headers: headers(), body: JSON.stringify({ rules }),
      });
      if (res.ok) toast({ title: "SSO domain rules saved" });
      else toast({ title: "Failed to save SSO domain rules", variant: "destructive" });
    } catch { toast({ title: "Error saving SSO domain rules", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Settings className="w-4 h-4" /> SSO Domain Role Mapping</CardTitle>
        <p className="text-xs text-muted-foreground">Automatically assign roles to users who sign in via Microsoft SSO based on their email domain. For example, map <code>acme.com</code> to <code>admin</code> to grant all acme.com SSO users admin access.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading rules...</div>
        ) : (
          <>
            {rules.length === 0 && (
              <p className="text-sm text-muted-foreground italic">No domain rules configured. All SSO users will be assigned the default <strong>user</strong> role.</p>
            )}
            <div className="space-y-2">
              {rules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="example.com"
                    value={rule.domain}
                    onChange={e => updateRule(i, "domain", e.target.value)}
                    className="flex-1 text-sm h-8"
                  />
                  <select
                    value={rule.role}
                    onChange={e => updateRule(i, "role", e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="client">client</option>
                    <option value="admin">admin</option>
                  </select>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeRule(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button variant="outline" size="sm" onClick={addRule}><Plus className="w-3.5 h-3.5 mr-1.5" />Add Rule</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}Save Rules
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ImportTab({ headers }: { headers: () => any }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"users" | "partners">("users");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [resendingUserId, setResendingUserId] = useState<number | null>(null);
  type ImportRowResult = { row: number; status: "created" | "skipped" | "error"; email?: string; message?: string; userId?: number };
  const [results, setResults] = useState<null | { summary: { total: number; created: number; skipped: number; errors: number }; results: ImportRowResult[] }>(null);

  const handleResendImportWelcome = async (userId: number) => {
    setResendingUserId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}/resend-welcome`, { method: "POST", headers: headers() });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Welcome email resent", description: "A fresh temporary password has been sent to the user." });
      } else {
        toast({ title: data.message || "Failed to resend welcome email", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error resending welcome email", variant: "destructive" });
    } finally {
      setResendingUserId(null);
    }
  };

  const exampleUsers = "name,email,company,phone,role\nJane Smith,jane@acme.com,Acme Corp,555-0100,client\nBob Admin,bob@acme.com,Acme Corp,,admin";
  const examplePartners = "contactName,companyName,email,businessType,specializations,phone,website,tier\nJohn Doe,Alpha IT,john@alphait.com,msp,Microsoft 365|Azure,555-0200,https://alphait.com,silver";

  const handleImport = async () => {
    if (!csvText.trim()) { toast({ title: "Please paste CSV data first", variant: "destructive" }); return; }
    setImporting(true);
    setResults(null);
    try {
      const res = await fetch(`/api/admin/import/${mode}`, {
        method: "POST", headers: headers(), body: JSON.stringify({ csv: csvText }),
      });
      const data = await res.json();
      if (res.ok) {
        setResults(data);
        toast({ title: `Import complete: ${data.summary.created} created, ${data.summary.skipped} skipped, ${data.summary.errors} errors` });
      } else {
        toast({ title: data.message || "Import failed", variant: "destructive" });
      }
    } catch { toast({ title: "Import request failed", variant: "destructive" }); }
    finally { setImporting(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" /> Bulk CSV Import</CardTitle>
          <p className="text-xs text-muted-foreground">Import multiple users or partner accounts at once by pasting CSV data. Welcome emails with temporary passwords are sent automatically.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Button variant={mode === "users" ? "default" : "outline"} size="sm" onClick={() => { setMode("users"); setCsvText(""); setResults(null); }}>
              <Users className="w-3.5 h-3.5 mr-1.5" />Import Users
            </Button>
            <Button variant={mode === "partners" ? "default" : "outline"} size="sm" onClick={() => { setMode("partners"); setCsvText(""); setResults(null); }}>
              <Briefcase className="w-3.5 h-3.5 mr-1.5" />Import Partners
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs font-medium">Required columns for {mode === "users" ? "users" : "partners"}:</Label>
            <p className="text-xs text-muted-foreground font-mono bg-muted rounded px-2 py-1">
              {mode === "users" ? "name, email, company  (optional: phone, role)" : "contactName, companyName, email, businessType, specializations  (optional: phone, website, tier)"}
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-xs">CSV Data</Label>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground" onClick={() => setCsvText(mode === "users" ? exampleUsers : examplePartners)}>
                Load example
              </Button>
            </div>
            <Textarea
              value={csvText}
              onChange={e => setCsvText(e.target.value)}
              placeholder={`Paste CSV here...\n${mode === "users" ? exampleUsers : examplePartners}`}
              className="min-h-[160px] font-mono text-xs"
            />
          </div>

          <Button onClick={handleImport} disabled={importing || !csvText.trim()}>
            {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Package className="w-4 h-4 mr-2" />}
            Import {mode === "users" ? "Users" : "Partners"}
          </Button>
        </CardContent>
      </Card>

      {results && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Import Results</CardTitle>
            <div className="flex gap-3 text-xs">
              <span className="text-green-600 font-semibold">{results.summary.created} created</span>
              <span className="text-yellow-600 font-semibold">{results.summary.skipped} skipped</span>
              <span className="text-red-600 font-semibold">{results.summary.errors} errors</span>
              <span className="text-muted-foreground">{results.summary.total} total rows</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left">Row</th>
                    <th className="px-3 py-2 text-left">Email</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Message</th>
                    {mode === "users" && <th className="px-3 py-2 text-left">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((r, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-1.5 text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-1.5 font-mono">{r.email || "—"}</td>
                      <td className="px-3 py-1.5">
                        <Badge variant={r.status === "created" ? "default" : r.status === "skipped" ? "secondary" : "destructive"} className="text-xs">
                          {r.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.message}</td>
                      {mode === "users" && (
                        <td className="px-3 py-1.5">
                          {r.status === "created" && r.userId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs gap-1 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                              onClick={() => handleResendImportWelcome(r.userId!)}
                              disabled={resendingUserId === r.userId}
                              title="Resend welcome email with new temporary password"
                            >
                              {resendingUserId === r.userId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                              Resend
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface FieldDef { key: string; label: string; type: "text" | "textarea" | "number" | "checkbox" | "features" | "select" | "json"; required?: boolean; options?: string[] }

function CrudTab({ items, refresh, headers, entity, fields, columns, customCells, columnLabels }: {
  items: any[]; refresh: () => void; headers: () => any; entity: string;
  fields: FieldDef[]; columns: string[];
  customCells?: Record<string, (item: any) => React.ReactNode>;
  columnLabels?: Record<string, string>;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<Record<string, any>>({});

  const filtered = useMemo(() => {
    if (!search) return items;
    const s = search.toLowerCase();
    return items.filter(i => columns.some(c => String(i[c] ?? "").toLowerCase().includes(s)));
  }, [items, search, columns]);

  const openAdd = () => {
    setEditing(null);
    const init: Record<string, any> = {};
    fields.forEach(f => {
      if (f.type === "checkbox") init[f.key] = true;
      else if (f.type === "number") init[f.key] = 0;
      else if (f.type === "json") init[f.key] = "[]";
      else init[f.key] = "";
    });
    setForm(init);
    setOpen(true);
  };

  const openEdit = (item: any) => {
    setEditing(item);
    const init: Record<string, any> = {};
    fields.forEach(f => {
      if (f.type === "features") init[f.key] = Array.isArray(item[f.key]) ? item[f.key].join("\n") : (item[f.key] || "");
      else if (f.type === "json") init[f.key] = item[f.key] ? JSON.stringify(item[f.key], null, 2) : "[]";
      else init[f.key] = item[f.key] ?? "";
    });
    setForm(init);
    setOpen(true);
  };

  const handleSave = async () => {
    const method = editing ? "PUT" : "POST";
    const url = editing ? `/api/admin/cms/${entity}/${editing.id}` : `/api/admin/cms/${entity}`;
    const payload = { ...form };
    fields.forEach(f => {
      if (f.type === "features") payload[f.key] = form[f.key].split("\n").map((s: string) => s.trim()).filter(Boolean);
      if (f.type === "number") payload[f.key] = Number(form[f.key]);
      if (f.type === "json") {
        try { payload[f.key] = form[f.key] ? JSON.parse(form[f.key]) : []; }
        catch { toast({ title: `Invalid JSON in "${f.label}"`, variant: "destructive" }); throw new Error("invalid json"); }
      }
    });
    try {
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(payload) });
      if (res.ok) { toast({ title: "Saved" }); setOpen(false); refresh(); }
      else toast({ title: "Failed", variant: "destructive" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this item?")) return;
    try {
      const res = await fetch(`/api/admin/cms/${entity}/${id}`, { method: "DELETE", headers: headers() });
      if (res.ok) { toast({ title: "Deleted" }); refresh(); }
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <SearchBar value={search} onChange={setSearch} />
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1.5" />Add</Button>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-xs uppercase">
              <tr>
                {columns.map(c => <th key={c} className="px-5 py-3 text-left">{columnLabels?.[c] ?? c}</th>)}
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="border-b last:border-0 hover:bg-muted/50">
                  {columns.map(c => (
                    <td key={c} className="px-5 py-3">
                      {customCells?.[c]
                        ? customCells[c](item)
                        : typeof item[c] === "boolean"
                          ? <Badge variant={item[c] ? "default" : "secondary"}>{item[c] ? "Yes" : "No"}</Badge>
                          : String(item[c] ?? "").slice(0, 60)}
                    </td>
                  ))}
                  <td className="px-5 py-3 text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Edit2 className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">No items found.</div>}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-4">
            {fields.map(f => (
              <div key={f.key} className="space-y-1">
                {f.type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={!!form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.checked }))} className="w-4 h-4" />
                    {f.label}
                  </label>
                ) : (
                  <>
                    <Label className="text-xs">{f.label}</Label>
                    {f.type === "textarea" || f.type === "features" || f.type === "json"
                      ? <Textarea value={form[f.key] || ""} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} className={f.type === "json" ? "min-h-[100px] font-mono text-xs" : "min-h-[80px]"} />
                      : <Input type={f.type === "number" ? "number" : "text"} value={form[f.key] ?? ""} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))} />}
                  </>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BlogTab({ posts, refresh, headers }: { posts: any[]; refresh: () => void; headers: () => any }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ title: "", slug: "", excerpt: "", content: "", coverImage: "", author: "Siebert Services", category: "general", tags: "", status: "draft", featured: false, scheduledAt: "", contentType: "news" });

  const filtered = useMemo(() => {
    if (!search) return posts;
    const s = search.toLowerCase();
    return posts.filter(p => p.title.toLowerCase().includes(s) || p.category.toLowerCase().includes(s));
  }, [posts, search]);

  const openAdd = () => {
    setEditing(null);
    setForm({ title: "", slug: "", excerpt: "", content: "", coverImage: "", author: "Siebert Services", category: "general", tags: "", status: "draft", featured: false, scheduledAt: "", contentType: "news" });
    setOpen(true);
  };

  const openEdit = (post: any) => {
    setEditing(post);
    setForm({
      ...post,
      tags: Array.isArray(post.tags) ? post.tags.join(", ") : "",
      scheduledAt: post.scheduledAt ? new Date(post.scheduledAt).toISOString().slice(0, 16) : "",
      contentType: post.contentType || "news",
    });
    setOpen(true);
  };

  const handleSave = async () => {
    const method = editing ? "PUT" : "POST";
    const url = editing ? `/api/admin/cms/blog/${editing.id}` : "/api/admin/cms/blog";
    const payload = {
      ...form,
      tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
      scheduledAt: form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
    };
    try {
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(payload) });
      if (res.ok) { toast({ title: "Saved" }); setOpen(false); refresh(); }
      else toast({ title: "Failed", variant: "destructive" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this post?")) return;
    try {
      const res = await fetch(`/api/admin/cms/blog/${id}`, { method: "DELETE", headers: headers() });
      if (res.ok) { toast({ title: "Deleted" }); refresh(); }
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between gap-4">
        <SearchBar value={search} onChange={setSearch} />
        <Button onClick={openAdd}><Plus className="w-4 h-4 mr-1.5" />New Post</Button>
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">Title</th>
                <th className="px-5 py-3 text-left">Category</th>
                <th className="px-5 py-3 text-left">Status</th>
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(post => (
                <tr key={post.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-3 font-medium">{post.title}{post.featured && <Badge className="ml-2" variant="default">Featured</Badge>}</td>
                  <td className="px-5 py-3">{post.category}</td>
                  <td className="px-5 py-3">
                    <Badge variant={post.status === "published" ? "default" : post.status === "draft" ? "secondary" : "outline"}>{post.status}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground text-xs">{new Date(post.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(post)}><Edit2 className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(post.id)}><Trash2 className="w-4 h-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">No blog posts yet.</div>}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Post" : "New Post"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">Title</Label><Input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Slug</Label><Input value={form.slug} onChange={e => setForm(p => ({ ...p, slug: e.target.value }))} placeholder="auto-generated" /></div>
              <div className="space-y-1"><Label className="text-xs">Category</Label><Input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Author</Label><Input value={form.author} onChange={e => setForm(p => ({ ...p, author: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Cover Image URL</Label><Input value={form.coverImage} onChange={e => setForm(p => ({ ...p, coverImage: e.target.value }))} /></div>
              <div className="space-y-1"><Label className="text-xs">Tags (comma separated)</Label><Input value={form.tags} onChange={e => setForm(p => ({ ...p, tags: e.target.value }))} /></div>
            </div>
            <div className="space-y-1"><Label className="text-xs">Excerpt</Label><Textarea value={form.excerpt} onChange={e => setForm(p => ({ ...p, excerpt: e.target.value }))} className="min-h-[60px]" /></div>
            <div className="space-y-1"><Label className="text-xs">Content (Markdown/HTML)</Label><Textarea value={form.content} onChange={e => setForm(p => ({ ...p, content: e.target.value }))} className="min-h-[200px] font-mono text-xs" /></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <select className="h-9 px-3 rounded-md border text-sm bg-background w-full" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Content Type</Label>
                <select className="h-9 px-3 rounded-md border text-sm bg-background w-full" value={form.contentType} onChange={e => setForm(p => ({ ...p, contentType: e.target.value }))}>
                  <option value="news">News</option>
                  <option value="industry">Industry</option>
                  <option value="service">Service</option>
                  <option value="how-to">How-to</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Scheduled For</Label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(p => ({ ...p, scheduledAt: e.target.value }))} />
              </div>
              <label className="flex items-center gap-2 text-sm pb-2">
                <input type="checkbox" checked={form.featured} onChange={e => setForm(p => ({ ...p, featured: e.target.checked }))} className="w-4 h-4" />Featured
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save Post</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorialCalendarTab({ posts, refresh, headers }: { posts: any[]; refresh: () => void; headers: () => any }) {
  const { toast } = useToast();
  const [monthOffset, setMonthOffset] = useState(0);

  const today = new Date();
  const viewDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleString("default", { month: "long", year: "numeric" });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const postsByDay = useMemo(() => {
    const map: Record<number, any[]> = {};
    posts.forEach(p => {
      const refDate = p.scheduledAt || p.publishedAt || p.createdAt;
      if (!refDate) return;
      const dt = new Date(refDate);
      if (dt.getFullYear() === year && dt.getMonth() === month) {
        const day = dt.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(p);
      }
    });
    return map;
  }, [posts, year, month]);

  const typeColor: Record<string, string> = {
    news: "bg-blue-100 text-blue-700 border-blue-300",
    industry: "bg-purple-100 text-purple-700 border-purple-300",
    service: "bg-emerald-100 text-emerald-700 border-emerald-300",
    "how-to": "bg-amber-100 text-amber-700 border-amber-300",
  };
  const statusColor: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    published: "bg-primary/15 text-primary",
    archived: "bg-muted text-muted-foreground line-through",
  };

  const updateScheduled = async (id: number, dateStr: string) => {
    const post = posts.find(p => p.id === id);
    if (!post) return;
    try {
      const res = await fetch(`/api/admin/cms/blog/${id}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({
          ...post,
          tags: Array.isArray(post.tags) ? post.tags : [],
          scheduledAt: dateStr ? new Date(dateStr).toISOString() : null,
        }),
      });
      if (res.ok) { toast({ title: "Schedule updated" }); refresh(); }
      else toast({ title: "Failed to update", variant: "destructive" });
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const upcoming = posts
    .filter(p => p.scheduledAt && new Date(p.scheduledAt) >= today)
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">{monthName}</h2>
          <p className="text-sm text-muted-foreground">Drag-free editorial calendar — schedule, plan, and review your content.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(o => o - 1)}>← Prev</Button>
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(0)}>Today</Button>
          <Button variant="outline" size="sm" onClick={() => setMonthOffset(o => o + 1)}>Next →</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        {Object.entries(typeColor).map(([t, cls]) => (
          <span key={t} className={`px-2 py-1 rounded border font-medium capitalize ${cls}`}>{t}</span>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/50 text-xs uppercase tracking-wide font-semibold text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="px-3 py-2 text-center border-r last:border-r-0">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            const isToday = day && monthOffset === 0 && day === today.getDate();
            const dayPosts = day ? postsByDay[day] || [] : [];
            return (
              <div
                key={idx}
                className={`min-h-[110px] border-r border-b last:border-r-0 p-1.5 text-xs flex flex-col gap-1 ${day ? "bg-background" : "bg-muted/20"}`}
              >
                {day && (
                  <div className={`flex items-center justify-between ${isToday ? "text-primary font-bold" : "text-muted-foreground"}`}>
                    <span>{day}</span>
                    {isToday && <span className="text-[10px] uppercase">Today</span>}
                  </div>
                )}
                {dayPosts.map(p => (
                  <div
                    key={p.id}
                    title={p.title}
                    className={`px-1.5 py-1 rounded border text-[11px] leading-tight truncate ${typeColor[p.contentType] || typeColor.news}`}
                  >
                    <div className="truncate font-semibold">{p.title}</div>
                    <div className={`text-[10px] inline-block px-1 rounded ${statusColor[p.status] || ""}`}>{p.status}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Card>

      <div>
        <h3 className="text-sm font-semibold mb-3">Upcoming Scheduled Posts</h3>
        <Card>
          <div className="divide-y">
            {upcoming.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No upcoming scheduled posts. Set a "Scheduled For" date when editing a blog post.</div>
            )}
            {upcoming.map(p => (
              <div key={p.id} className="p-4 flex items-center gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="font-medium">{p.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.scheduledAt).toLocaleString()} · <span className="capitalize">{p.contentType || "news"}</span> · <Badge variant="outline">{p.status}</Badge>
                  </div>
                </div>
                <Input
                  type="datetime-local"
                  defaultValue={new Date(p.scheduledAt).toISOString().slice(0, 16)}
                  onBlur={e => updateScheduled(p.id, e.target.value)}
                  className="w-56 h-8 text-xs"
                />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function UsersTab({ users, refresh, headers, currentUserId }: { users: any[]; refresh: () => void; headers: () => any; currentUserId?: number }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", company: "", phone: "", role: "client" });
  const [isCreating, setIsCreating] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);
  
  const filtered = useMemo(() => {
    if (!search) return users;
    const s = search.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
  }, [users, search]);

  const updateRole = async (id: number, role: string) => {
    try {
      await fetch(`/api/admin/users/${id}/role`, { method: "PUT", headers: headers(), body: JSON.stringify({ role }) });
      toast({ title: `Role updated to ${role}` }); refresh();
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const handleDelete = async (id: number) => {
    if (id === currentUserId) { toast({ title: "Cannot delete your own account", variant: "destructive" }); return; }
    if (!confirm("Delete this user?")) return;
    try {
      await fetch(`/api/admin/users/${id}`, { method: "DELETE", headers: headers() });
      toast({ title: "Deleted" }); refresh();
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const handleResendWelcome = async (id: number) => {
    setResendingId(id);
    try {
      const res = await fetch(`/api/admin/users/${id}/resend-welcome`, { method: "POST", headers: headers() });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Welcome email resent", description: "A new temporary password has been sent to the user." });
      } else {
        toast({ title: data.message || "Failed to resend welcome email", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error resending welcome email", variant: "destructive" });
    } finally {
      setResendingId(null);
    }
  };

  const createUser = async () => {
    if (!form.name || !form.email || !form.password || !form.company) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    setIsCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(form),
      });
      if (res.ok) {
        toast({ title: "User created successfully" });
        setCreateOpen(false);
        setForm({ name: "", email: "", password: "", company: "", phone: "", role: "client" });
        refresh();
      } else {
        const data = await res.json();
        toast({ title: data.message || "Failed to create user", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error creating user", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="flex-1">
          <SearchBar value={search} onChange={setSearch} />
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> New User</Button>
      </div>

      {createOpen && (
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input placeholder="Full name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" placeholder="user@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input type="password" placeholder="••••••••" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input placeholder="Company name" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Phone (optional)</Label>
                <Input placeholder="Phone number" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <select className="h-9 px-3 rounded-md border text-sm bg-background w-full" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
                  <option value="client">Client</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={createUser} disabled={isCreating}>{isCreating ? "Creating..." : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted text-muted-foreground text-xs uppercase">
              <tr>
                <th className="px-5 py-3 text-left">Name</th>
                <th className="px-5 py-3 text-left">Email</th>
                <th className="px-5 py-3 text-left">Company</th>
                <th className="px-5 py-3 text-left">Role</th>
                <th className="px-5 py-3 text-left">Joined</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {u.name}
                      {u.mustChangePassword && (
                        <Badge variant="secondary" className="text-xs gap-1 text-amber-700 bg-amber-100 border-amber-200">
                          <KeyRound className="w-3 h-3" />Temp password
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">{u.email}</td>
                  <td className="px-5 py-3">{u.company}</td>
                  <td className="px-5 py-3">
                    <select className="h-7 px-2 rounded border text-xs bg-background" value={u.role}
                      onChange={e => updateRole(u.id, e.target.value)} disabled={u.id === currentUserId}>
                      <option value="client">Client</option><option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-5 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {u.mustChangePassword && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs gap-1.5 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                          onClick={() => handleResendWelcome(u.id)}
                          disabled={resendingId === u.id}
                          title="Resend welcome email with new temporary password"
                        >
                          {resendingId === u.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                          Resend Welcome
                        </Button>
                      )}
                      {u.id !== currentUserId && <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(u.id)}><Trash2 className="w-4 h-4" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="p-8 text-center text-muted-foreground">No users found.</div>}
        </div>
      </Card>
    </div>
  );
}

function ActivityTab({ activities }: { activities: any[] }) {
  const actionColors: Record<string, string> = { create: "text-emerald-600", update: "text-blue-600", delete: "text-red-600" };
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y">
          {activities.map((a: any) => (
            <div key={a.id} className="px-5 py-3 flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${a.action === "create" ? "bg-emerald-500" : a.action === "delete" ? "bg-red-500" : "bg-blue-500"}`} />
              <div className="flex-1">
                <p className="text-sm">
                  <span className={`font-medium ${actionColors[a.action] || ""}`}>{a.action}</span>
                  {" "}<span className="text-muted-foreground">{a.entity}</span>
                  {a.entityId && <span className="text-muted-foreground"> #{a.entityId}</span>}
                </p>
                {a.details && <p className="text-xs text-muted-foreground">{a.details}</p>}
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {activities.length === 0 && <div className="p-8 text-center text-muted-foreground">No activity logged yet.</div>}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── TSD Product Catalog Section ─────────────────────────────────────────────

const TSD_PROVIDERS_LIST = ["telarus", "intelisys"];
const TSD_PROVIDER_DISPLAY: Record<string, string> = {
  telarus: "Telarus",
  intelisys: "Intelisys",
};

const EMPTY_PRODUCT_FORM = {
  category: "", name: "", description: "",
  availableAt: [] as string[], active: true, sortOrder: 0,
};

function ProductCatalogSection({
  products, headers, refresh, toast,
}: {
  products: any[];
  headers: () => any;
  refresh: () => void;
  toast: any;
}) {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [form, setForm] = useState({ ...EMPTY_PRODUCT_FORM });
  const [saving, setSaving] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const filteredProducts = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase()) ||
    (p.description || "").toLowerCase().includes(search.toLowerCase())
  );

  const grouped: Record<string, any[]> = {};
  for (const p of filteredProducts) {
    if (!grouped[p.category]) grouped[p.category] = [];
    grouped[p.category].push(p);
  }
  const categories = Object.keys(grouped).sort();

  const toggleCat = (cat: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  const openCreate = () => {
    setForm({ ...EMPTY_PRODUCT_FORM });
    setEditingProduct(null);
    setShowForm(true);
  };

  const openEdit = (product: any) => {
    setForm({
      category: product.category,
      name: product.name,
      description: product.description || "",
      availableAt: Array.isArray(product.availableAt) ? product.availableAt : [],
      active: product.active,
      sortOrder: product.sortOrder || 0,
    });
    setEditingProduct(product);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.category.trim() || !form.name.trim()) {
      toast({ title: "Category and name are required", variant: "destructive" }); return;
    }
    setSaving(true);
    try {
      const url = editingProduct ? `/api/admin/tsd-products/${editingProduct.id}` : "/api/admin/tsd-products";
      const method = editingProduct ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: headers(), body: JSON.stringify(form) });
      if (res.ok) {
        toast({ title: editingProduct ? "Product updated" : "Product created" });
        setShowForm(false);
        refresh();
      } else {
        const err = await res.json();
        toast({ title: err.message || "Failed to save", variant: "destructive" });
      }
    } catch { toast({ title: "Error saving product", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleToggleActive = async (product: any) => {
    try {
      const res = await fetch(`/api/admin/tsd-products/${product.id}`, {
        method: "PUT", headers: headers(), body: JSON.stringify({ active: !product.active }),
      });
      if (res.ok) { refresh(); toast({ title: product.active ? "Product disabled" : "Product enabled" }); }
      else toast({ title: "Failed to update", variant: "destructive" });
    } catch { toast({ title: "Error updating product", variant: "destructive" }); }
  };

  const handleDelete = async (product: any) => {
    if (!window.confirm(`Delete "${product.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/tsd-products/${product.id}`, { method: "DELETE", headers: headers() });
      if (res.ok) { refresh(); toast({ title: "Product deleted" }); }
      else toast({ title: "Failed to delete", variant: "destructive" });
    } catch { toast({ title: "Error deleting product", variant: "destructive" }); }
  };

  const toggleProvider = (provider: string) => {
    setForm(prev => ({
      ...prev,
      availableAt: prev.availableAt.includes(provider)
        ? prev.availableAt.filter(p => p !== provider)
        : [...prev.availableAt, provider],
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Product Catalog</h3>
          <p className="text-sm text-muted-foreground">Manage the product and service catalog shown on the deal registration form.</p>
        </div>
        <Button size="sm" onClick={openCreate}><Plus size={14} className="mr-1" />Add Product</Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">{editingProduct ? "Edit Product" : "New Product"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Category *</Label>
                <Input
                  value={form.category}
                  onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                  placeholder="e.g. UCaaS, CCaaS, SD-WAN"
                  list="existing-categories"
                />
                <datalist id="existing-categories">
                  {categories.map(cat => <option key={cat} value={cat} />)}
                </datalist>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Product Name *</Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Product or service name"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Input
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder="Brief description (optional)"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Available at TSDs</Label>
              <div className="flex gap-3">
                {TSD_PROVIDERS_LIST.map(provider => (
                  <label key={provider} className="flex items-center gap-1.5 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={form.availableAt.includes(provider)}
                      onChange={() => toggleProvider(provider)}
                      className="w-4 h-4 rounded"
                    />
                    {TSD_PROVIDER_DISPLAY[provider]}
                  </label>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Sort Order</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={e => setForm(p => ({ ...p, sortOrder: parseInt(e.target.value) || 0 }))}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="product-active"
                  checked={form.active}
                  onChange={e => setForm(p => ({ ...p, active: e.target.checked }))}
                  className="w-4 h-4 rounded"
                />
                <Label htmlFor="product-active" className="text-sm cursor-pointer">Active (visible to partners)</Label>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
                {editingProduct ? "Save Changes" : "Create Product"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search catalog..."
          className="pl-8"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {categories.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              {search ? "No products match your search." : "No products in catalog."}
            </div>
          ) : (
            <div className="divide-y">
              {categories.map(cat => {
                const items = grouped[cat];
                const isExpanded = !!search || expandedCats.has(cat);
                const activeCount = items.filter(p => p.active).length;
                return (
                  <div key={cat}>
                    <button
                      type="button"
                      onClick={() => !search && toggleCat(cat)}
                      className={`w-full flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors ${search ? "cursor-default" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        {!search && (
                          <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
                        )}
                        <span className="font-medium text-sm">{cat}</span>
                        <Badge className="text-xs bg-muted text-muted-foreground border-0">
                          {activeCount}/{items.length} active
                        </Badge>
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="border-t divide-y bg-muted/10">
                        {items.map((product: any) => (
                          <div key={product.id} className={`flex items-center justify-between px-6 py-2.5 ${!product.active ? "opacity-50" : ""}`}>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{product.name}</span>
                                {!product.active && (
                                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">inactive</span>
                                )}
                              </div>
                              {product.description && (
                                <p className="text-xs text-muted-foreground mt-0.5">{product.description}</p>
                              )}
                              <div className="flex gap-1 mt-1">
                                {(Array.isArray(product.availableAt) ? product.availableAt : []).map((tsd: string) => (
                                  <span key={tsd} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded-full border border-blue-100">
                                    {TSD_PROVIDER_DISPLAY[tsd] || tsd}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0 ml-3">
                              <button
                                onClick={() => handleToggleActive(product)}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${product.active ? "bg-green-500" : "bg-gray-200"}`}
                                title={product.active ? "Disable" : "Enable"}
                              >
                                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${product.active ? "translate-x-[18px]" : "translate-x-0.5"}`} />
                              </button>
                              <Button size="sm" variant="ghost" onClick={() => openEdit(product)} className="h-7 w-7 p-0">
                                <Edit2 size={12} />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => handleDelete(product)} className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50">
                                <Trash2 size={12} />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TSD Integrations Tab ────────────────────────────────────────────────────

const TSD_PROVIDER_LABELS: Record<string, string> = {
  telarus: "Telarus",
  intelisys: "Intelisys",
};

const TSD_STATUS_COLORS: Record<string, string> = {
  success: "bg-green-100 text-green-700",
  failure: "bg-red-100 text-red-700",
  partial: "bg-yellow-100 text-yellow-700",
};

function TsdIntegrationsTab({
  configs, logs, products, headers, refresh, toast,
}: {
  configs: any[];
  logs: any[];
  products: any[];
  headers: () => any;
  refresh: () => void;
  toast: any;
}) {
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [securityTokenInput, setSecurityTokenInput] = useState("");
  const [webhookInput, setWebhookInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<number | null>(null);

  const allProviders = ["telarus", "intelisys"];

  const getConfig = (p: string) => configs.find((c: any) => c.provider === p) || { provider: p, enabled: false };

  const handleToggle = async (provider: string, enabled: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/tsd/configs/${provider}`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) { refresh(); toast({ title: `${TSD_PROVIDER_LABELS[provider]} ${enabled ? "enabled" : "disabled"}` }); }
      else toast({ title: "Failed to update", variant: "destructive" });
    } catch { toast({ title: "Error updating config", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleSaveCreds = async (provider: string) => {
    setSaving(true);
    try {
      const body: any = {};
      if (usernameInput && !usernameInput.includes("****")) body.username = usernameInput;
      if (passwordInput && !passwordInput.includes("****")) body.password = passwordInput;
      if (provider === "telarus" && securityTokenInput && !securityTokenInput.includes("****")) body.securityToken = securityTokenInput;
      if (webhookInput && !webhookInput.includes("****")) body.webhookSecret = webhookInput;
      const res = await fetch(`/api/admin/tsd/configs/${provider}`, {
        method: "PUT", headers: headers(),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        refresh();
        setEditingProvider(null);
        setUsernameInput("");
        setPasswordInput("");
        setSecurityTokenInput("");
        setWebhookInput("");
        toast({ title: "Credentials saved" });
      } else {
        toast({ title: "Failed to save credentials", variant: "destructive" });
      }
    } catch { toast({ title: "Error saving credentials", variant: "destructive" }); }
    finally { setSaving(false); }
  };

  const handleTest = async (provider: string) => {
    setTesting(provider);
    try {
      const res = await fetch(`/api/admin/tsd/configs/${provider}/test`, { method: "POST", headers: headers() });
      const data = await res.json();
      if (data.ok) toast({ title: `${TSD_PROVIDER_LABELS[provider]}: Connection successful` });
      else toast({ title: `Connection failed: ${data.error || "Unknown error"}`, variant: "destructive" });
    } catch { toast({ title: "Test connection error", variant: "destructive" }); }
    finally { setTesting(null); }
  };

  const handleSync = async (provider: string, type: "leads" | "commissions") => {
    setSyncing(`${provider}:${type}`);
    try {
      const res = await fetch(`/api/admin/tsd/sync/${provider}/${type}`, { method: "POST", headers: headers() });
      if (res.ok) {
        toast({ title: `${TSD_PROVIDER_LABELS[provider]} ${type} sync triggered` });
        setTimeout(() => { refresh(); setSyncing(null); }, 2000);
      } else {
        toast({ title: "Failed to trigger sync", variant: "destructive" });
        setSyncing(null);
      }
    } catch { toast({ title: "Error triggering sync", variant: "destructive" }); setSyncing(null); }
  };

  const handleTelarusSync = async (entity: string) => {
    setSyncing(`telarus:${entity}`);
    try {
      const res = await fetch(`/api/admin/telarus/sync/${entity}`, { method: "POST", headers: headers() });
      if (res.ok) {
        toast({ title: `Telarus ${entity} sync triggered` });
        setTimeout(() => { refresh(); setSyncing(null); }, 2000);
      } else {
        toast({ title: "Failed to trigger sync", variant: "destructive" });
        setSyncing(null);
      }
    } catch { toast({ title: "Error triggering sync", variant: "destructive" }); setSyncing(null); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">TSD Integrations</h2>
        <p className="text-sm text-muted-foreground">Manage two-way integrations with Technology Solution Distributors. Deals are automatically pushed to enabled TSDs when registered.</p>
      </div>

      <div className="grid gap-4">
        {allProviders.map((provider) => {
          const cfg = getConfig(provider);
          const isEditingThis = editingProvider === provider;
          return (
            <Card key={provider}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${cfg.enabled ? "bg-green-500" : "bg-gray-300"}`} />
                    <div>
                      <p className="font-semibold">{TSD_PROVIDER_LABELS[provider]}</p>
                      <p className="text-xs text-muted-foreground capitalize">{provider}</p>
                    </div>
                    {cfg.hasCredential ? (
                      <Badge className="text-xs bg-green-50 text-green-700 border border-green-200">
                        Credentials set
                      </Badge>
                    ) : (
                      <Badge className="text-xs bg-amber-50 text-amber-700 border border-amber-200">
                        No credentials
                      </Badge>
                    )}
                    {provider === "telarus" && cfg.hasSecurityToken && (
                      <Badge className="text-xs bg-blue-50 text-blue-700 border border-blue-200">Security token set</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(provider, !cfg.enabled)}
                      disabled={saving}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${cfg.enabled ? "bg-green-500" : "bg-gray-200"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${cfg.enabled ? "translate-x-6" : "translate-x-1"}`} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  <Button size="sm" variant="outline" onClick={() => handleTest(provider)} disabled={testing === provider}>
                    {testing === provider ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Activity size={14} className="mr-1" />}
                    Test Connection
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleSync(provider, "leads")} disabled={!!syncing}>
                    {syncing === `${provider}:leads` ? <Loader2 size={14} className="mr-1 animate-spin" /> : <RefreshCw size={14} className="mr-1" />}
                    Sync Leads
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleSync(provider, "commissions")} disabled={!!syncing}>
                    {syncing === `${provider}:commissions` ? <Loader2 size={14} className="mr-1 animate-spin" /> : <DollarSign size={14} className="mr-1" />}
                    Sync Commissions
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => {
                    setEditingProvider(isEditingThis ? null : provider);
                    setUsernameInput("");
                    setPasswordInput("");
                    setSecurityTokenInput("");
                    setWebhookInput("");
                  }}>
                    <KeyRound size={14} className="mr-1" />
                    {isEditingThis ? "Cancel" : "Edit Credentials"}
                  </Button>
                </div>

                {!cfg.hasCredential && (
                  <div className="mb-3 p-3 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                    {provider === "telarus"
                      ? <>No credentials configured. Enter your Telarus/Salesforce username, password, and security token below.</>
                      : <>No credentials configured. Enter your {TSD_PROVIDER_LABELS[provider]} username and password below, or set <code className="font-mono bg-amber-100 px-1 rounded">{provider.toUpperCase()}_USERNAME</code> / <code className="font-mono bg-amber-100 px-1 rounded">{provider.toUpperCase()}_PASSWORD</code> environment variables (env vars take precedence).</>
                    }
                  </div>
                )}

                {isEditingThis && (
                  <div className="bg-muted/40 rounded-lg p-4 space-y-3 border">
                    <p className="text-xs text-muted-foreground font-medium">
                      Credentials are encrypted and masked after saving and never shown again.
                      {cfg.credentialSource === "env" && " Currently using env var — DB value would be overridden by env var."}
                    </p>

                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">{TSD_PROVIDER_LABELS[provider]} Username (email)</Label>
                        <Input
                          type="email"
                          placeholder={cfg.hasDbCredential ? "Leave blank to keep existing" : "yourname@company.com"}
                          value={usernameInput}
                          onChange={e => setUsernameInput(e.target.value)}
                          className="text-sm"
                          autoComplete="new-password"
                        />
                        <p className="text-xs text-muted-foreground">
                          Env var <code className="font-mono text-xs">{provider.toUpperCase()}_USERNAME</code> takes precedence.
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{TSD_PROVIDER_LABELS[provider]} Password</Label>
                        <Input
                          type="password"
                          placeholder={cfg.hasDbCredential ? "Leave blank to keep existing" : "Enter password"}
                          value={passwordInput}
                          onChange={e => setPasswordInput(e.target.value)}
                          className="font-mono text-sm"
                          autoComplete="new-password"
                        />
                        <p className="text-xs text-muted-foreground">
                          Env var <code className="font-mono text-xs">{provider.toUpperCase()}_PASSWORD</code> takes precedence.
                        </p>
                      </div>
                      {provider === "telarus" && (
                        <div className="space-y-1">
                          <Label className="text-xs">
                            Salesforce Security Token
                            <span className="ml-1 text-muted-foreground font-normal">(optional)</span>
                            {cfg.hasSecurityToken && <span className="ml-2 text-green-600 font-normal">(already set)</span>}
                          </Label>
                          <Input
                            type="password"
                            placeholder={cfg.hasSecurityToken ? "Leave blank to keep existing" : "Leave blank if not required"}
                            value={securityTokenInput}
                            onChange={e => setSecurityTokenInput(e.target.value)}
                            className="font-mono text-sm"
                            autoComplete="new-password"
                          />
                          <p className="text-xs text-muted-foreground">
                            Only needed if your Salesforce org requires it for API access. Env var <code className="font-mono text-xs">TELARUS_SECURITY_TOKEN</code> takes precedence.
                          </p>
                        </div>
                      )}
                    </>

                    <div className="space-y-1">
                      <Label className="text-xs">Webhook Secret (for signature verification)</Label>
                      <Input
                        type="password"
                        placeholder={cfg.hasWebhookSecret ? "Enter new value to replace (leave blank to keep existing)" : "Enter webhook secret"}
                        value={webhookInput}
                        onChange={e => setWebhookInput(e.target.value)}
                        className="font-mono text-sm"
                        autoComplete="new-password"
                      />
                      <p className="text-xs text-muted-foreground">
                        Env var <code className="font-mono text-xs">{provider.toUpperCase()}_WEBHOOK_SECRET</code> takes precedence.
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">Webhook URL: <code className="bg-muted px-1 rounded text-xs">/api/webhooks/tsd/{provider}</code></p>
                    <Button
                      size="sm"
                      onClick={() => handleSaveCreds(provider)}
                      disabled={saving || (
                        provider === "telarus"
                          ? (!usernameInput && !passwordInput && !securityTokenInput && !webhookInput)
                          : (!usernameInput && !passwordInput && !webhookInput)
                      )}
                    >
                      {saving ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Save size={14} className="mr-1" />}
                      Save Credentials
                    </Button>
                  </div>
                )}

                {(cfg.lastLeadSyncAt || cfg.lastCommissionSyncAt) && (
                  <div className="text-xs text-muted-foreground mt-3 flex flex-wrap gap-4">
                    {cfg.lastLeadSyncAt && <span>Last lead sync: {new Date(cfg.lastLeadSyncAt).toLocaleString()}</span>}
                    {cfg.lastCommissionSyncAt && <span>Last commission sync: {new Date(cfg.lastCommissionSyncAt).toLocaleString()}</span>}
                  </div>
                )}

                {provider === "telarus" && cfg.enabled && (
                  <div className="mt-4 border-t pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium">Salesforce Data Sync</p>
                      <Button size="sm" variant="outline" disabled={syncing === "telarus:all"} onClick={() => handleTelarusSync("all")}>
                        {syncing === "telarus:all" ? <Loader2 size={13} className="mr-1 animate-spin" /> : <RefreshCw size={13} className="mr-1" />}
                        Sync All
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[
                        { key: "opportunities", label: "Opportunities", ts: cfg.lastOpportunitySyncAt },
                        { key: "accounts",      label: "Accounts",      ts: cfg.lastAccountSyncAt },
                        { key: "contacts",      label: "Contacts",      ts: cfg.lastContactSyncAt },
                        { key: "orders",        label: "Orders",        ts: cfg.lastOrderSyncAt },
                        { key: "quotes",        label: "Quotes",        ts: cfg.lastQuoteSyncAt },
                        { key: "activities",    label: "Activities",    ts: cfg.lastActivitySyncAt },
                        { key: "tasks",         label: "Tasks",         ts: cfg.lastTaskSyncAt },
                        { key: "vendors",       label: "Vendors",       ts: cfg.lastVendorSyncAt },
                      ].map(({ key, label, ts }) => (
                        <div key={key} className="flex items-center justify-between bg-muted/30 rounded px-2 py-1.5">
                          <div>
                            <span className="font-medium">{label}</span>
                            <span className="block text-muted-foreground">{ts ? new Date(ts).toLocaleString() : "Never synced"}</span>
                          </div>
                          <button
                            disabled={syncing === `telarus:${key}`}
                            onClick={() => handleTelarusSync(key)}
                            className="text-blue-600 hover:text-blue-800 disabled:opacity-50 ml-2"
                            title={`Sync ${label}`}
                          >
                            {syncing === `telarus:${key}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <ProductCatalogSection products={products} headers={headers} refresh={refresh} toast={toast} />

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Sync History</h3>
          <Button size="sm" variant="outline" onClick={refresh}><RefreshCw size={14} className="mr-1" />Refresh</Button>
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-2 text-left font-medium">Provider</th>
                    <th className="px-4 py-2 text-left font-medium">Direction</th>
                    <th className="px-4 py-2 text-left font-medium">Entity</th>
                    <th className="px-4 py-2 text-left font-medium">Status</th>
                    <th className="px-4 py-2 text-left font-medium">Records</th>
                    <th className="px-4 py-2 text-left font-medium">Timestamp</th>
                    <th className="px-4 py-2 text-left font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {logs.map((log: any) => (
                    <React.Fragment key={log.id}>
                      <tr className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2 font-medium capitalize">{TSD_PROVIDER_LABELS[log.provider] || log.provider}</td>
                        <td className="px-4 py-2 capitalize">{log.direction}</td>
                        <td className="px-4 py-2 capitalize">{log.entityType}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TSD_STATUS_COLORS[log.status] || "bg-gray-100 text-gray-700"}`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-4 py-2">{log.recordsAffected}</td>
                        <td className="px-4 py-2 whitespace-nowrap text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-2">
                          {(log.errorMessage || log.payloadSummary) && (
                            <button onClick={() => setExpandedLog(expandedLog === log.id ? null : log.id)} className="text-xs text-blue-600 hover:underline">
                              {expandedLog === log.id ? "Hide" : "Show"}
                            </button>
                          )}
                        </td>
                      </tr>
                      {expandedLog === log.id && (
                        <tr>
                          <td colSpan={7} className="px-4 py-2 bg-muted/30">
                            {log.errorMessage && (
                              <div className="text-xs text-red-600 mb-1"><strong>Error:</strong> {log.errorMessage}</div>
                            )}
                            {log.payloadSummary && (
                              <div className="text-xs text-muted-foreground"><strong>Payload:</strong> {log.payloadSummary}</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No sync events recorded yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


const INVOICE_STATUSES = ["draft", "sent", "paid", "overdue"] as const;
const invStatusMeta: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-gray-100 text-gray-700" },
  sent: { label: "Sent", cls: "bg-blue-100 text-blue-700" },
  paid: { label: "Paid", cls: "bg-green-100 text-green-700" },
  overdue: { label: "Overdue", cls: "bg-red-100 text-red-700" },
};

// ─── ReportingTab ─────────────────────────────────────────────────────────────
function ReportingTab({ data }: { data: any }) {
  if (!data) return <div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;

  const invByStatus: Record<string, { count: number; total: number }> = {};
  for (const row of data.invoiceSummary || []) {
    invByStatus[row.status] = { count: parseInt(row.count), total: parseFloat(row.total) };
  }
  const totalInvRevenue = Object.entries(invByStatus).filter(([s]) => s === "paid").reduce((s,[,v]) => s + v.total, 0);

  const ov = data.overview ?? {};
  const kpis = [
    { label: "Total Clients", value: ov.totalUsers ?? 0, icon: <Users className="w-5 h-5 text-blue-500" />, sub: "registered accounts" },
    { label: "Total Tickets", value: ov.totalTickets ?? 0, icon: <TicketIcon className="w-5 h-5 text-orange-500" />, sub: `${ov.openTickets ?? 0} open` },
    { label: "Quote Requests", value: ov.totalQuotes ?? 0, icon: <FileText className="w-5 h-5 text-violet-500" />, sub: "all time" },
    { label: "Proposals Sent", value: ov.totalProposals ?? 0, icon: <Send className="w-5 h-5 text-teal-500" />, sub: `${ov.acceptedProposals ?? 0} accepted` },
    { label: "Invoice Revenue", value: `$${totalInvRevenue.toLocaleString("en-US",{minimumFractionDigits:2})}`, icon: <DollarSign className="w-5 h-5 text-green-500" />, sub: "paid invoices" },
  ];

  const tierColors: Record<string, string> = { bronze: "bg-orange-100 text-orange-700", silver: "bg-gray-100 text-gray-600", gold: "bg-yellow-100 text-yellow-700", platinum: "bg-violet-100 text-violet-700" };

  return (
    <div className="space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">{k.icon}<span className="text-xs text-muted-foreground font-medium">{k.label}</span></div>
              <div className="text-2xl font-bold text-navy">{k.value}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoice Status Breakdown */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" /> Invoice Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {INVOICE_STATUSES.map(s => {
                const d = invByStatus[s] || { count: 0, total: 0 };
                const meta = invStatusMeta[s];
                return (
                  <div key={s} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${meta.cls}`}>{meta.label}</span>
                      <span className="text-sm text-muted-foreground">× {d.count}</span>
                    </div>
                    <span className="font-semibold text-sm text-navy">${d.total.toLocaleString("en-US",{minimumFractionDigits:2})}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Top Partners */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Top Partners by Revenue</CardTitle></CardHeader>
          <CardContent>
            {(!data.topPartners || data.topPartners.length === 0) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No partner data yet</p>
            ) : (
              <div className="space-y-3">
                {data.topPartners.map((p: any, i: number) => (
                  <div key={p.id} className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">#{i+1}</span>
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-navy truncate">{p.company}</div>
                        <div className="text-xs text-muted-foreground">{p.totalDeals ?? 0} deals</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold text-sm text-navy">${parseFloat(p.totalRevenue || 0).toLocaleString("en-US",{minimumFractionDigits:0})}</div>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize ${tierColors[p.tier] || "bg-gray-100 text-gray-600"}`}>{p.tier}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Proposals */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Package className="w-4 h-4" /> Recent Proposals</CardTitle></CardHeader>
        <CardContent>
          {(!data.recentProposals || data.recentProposals.length === 0) ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No proposals yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b"><tr>
                  {["Proposal","Title","Status","Total","Created"].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>)}
                </tr></thead>
                <tbody className="divide-y">
                  {data.recentProposals.map((p: any) => {
                    const statusCls: Record<string,string> = { draft:"bg-gray-100 text-gray-600", sent:"bg-blue-100 text-blue-700", viewed:"bg-yellow-100 text-yellow-700", accepted:"bg-green-100 text-green-700", rejected:"bg-red-100 text-red-700", expired:"bg-gray-200 text-gray-500" };
                    return (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{p.proposalNumber}</td>
                        <td className="px-3 py-2 font-medium">{p.title}</td>
                        <td className="px-3 py-2"><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusCls[p.status] || "bg-gray-100"}`}>{p.status}</span></td>
                        <td className="px-3 py-2 font-semibold">{p.total ? `$${parseFloat(p.total).toLocaleString("en-US",{minimumFractionDigits:2})}` : "—"}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InquiriesTab({ contacts, quotes, tickets, headers, refresh, toast }: { contacts: any[]; quotes: any[]; tickets: any[]; headers: () => any; refresh: () => void; toast: any }) {
  const [activeSubTab, setActiveSubTab] = React.useState<"contacts" | "quotes" | "tickets">("contacts");
  const [selectedTicket, setSelectedTicket] = React.useState<any>(null);
  const [ticketDetail, setTicketDetail] = React.useState<any>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [sendingReply, setSendingReply] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const fetchTicketDetail = async (id: number) => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/admin/tickets/${id}`, { headers: headers() });
      if (res.ok) setTicketDetail(await res.json());
    } catch { /* ignore */ } finally { setLoadingDetail(false); }
  };

  const selectTicket = (t: any) => {
    setSelectedTicket(t);
    setReplyText("");
    fetchTicketDetail(t.id);
  };

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [ticketDetail?.messages?.length]);

  const updateTicketStatus = async (id: number, status: string) => {
    try {
      await fetch(`/api/admin/tickets/${id}/status`, { method: "PUT", headers: headers(), body: JSON.stringify({ status }) });
      toast({ title: "Status updated", description: "Client will be notified by email." });
      refresh();
      fetchTicketDetail(id);
    } catch { toast({ title: "Error", variant: "destructive" }); }
  };

  const sendTicketReply = async () => {
    if (!replyText.trim() || !selectedTicket) return;
    setSendingReply(true);
    try {
      const res = await fetch(`/api/admin/tickets/${selectedTicket.id}/messages`, {
        method: "POST", headers: headers(), body: JSON.stringify({ message: replyText.trim() }),
      });
      if (!res.ok) throw new Error();
      setReplyText("");
      toast({ title: "Reply sent", description: "Client will be notified by email." });
      fetchTicketDetail(selectedTicket.id);
      refresh();
    } catch { toast({ title: "Failed to send", variant: "destructive" }); }
    finally { setSendingReply(false); }
  };

  const deleteItem = async (type: string, id: number) => {
    if (!window.confirm("Are you sure?")) return;
    try {
      const res = await fetch(`/api/admin/${type}/${id}`, { method: "DELETE", headers: headers() });
      if (res.ok) {
        toast({ title: `${type} deleted` });
        if (type === "tickets" && selectedTicket?.id === id) { setSelectedTicket(null); setTicketDetail(null); }
        refresh();
      } else {
        toast({ title: `Failed to delete ${type}`, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b">
        {["contacts", "quotes", "tickets"].map(tab => (
          <button
            key={tab}
            onClick={() => setActiveSubTab(tab as any)}
            className={`px-4 py-2 font-medium text-sm border-b-2 ${
              activeSubTab === tab ? "border-blue-500 text-blue-600" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeSubTab === "contacts" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Contacts</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b"><tr>
                  {["Name", "Email", "Company", "Date", "Actions"].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y">
                  {contacts.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{c.name}</td>
                      <td className="px-3 py-2 text-sm">{c.email}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{c.company}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2"><Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteItem("contacts", c.id)}><Trash2 size={16} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {contacts.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No contacts</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {activeSubTab === "quotes" && (
        <Card>
          <CardHeader><CardTitle className="text-base">Quotes</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b"><tr>
                  {["Name", "Email", "Services", "Tier", "Status", "Date", "Actions"].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y">
                  {quotes.map(q => (
                    <tr key={q.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium">{q.name}</td>
                      <td className="px-3 py-2 text-sm">{q.email}</td>
                      <td className="px-3 py-2 text-sm text-muted-foreground">{typeof q.services === "string" ? q.services.slice(0, 30) : Array.isArray(q.services) ? q.services.join(", ").slice(0, 30) : "—"}</td>
                      <td className="px-3 py-2 text-xs">
                        {q.requestedTier
                          ? <Badge variant="secondary" className="capitalize">{q.requestedTier}</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2"><Badge variant="outline">{q.status}</Badge></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(q.createdAt).toLocaleDateString()}</td>
                      <td className="px-3 py-2"><Button size="sm" variant="ghost" className="text-destructive hover:bg-destructive/10" onClick={() => deleteItem("quotes", q.id)}><Trash2 size={16} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {quotes.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No quotes</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {activeSubTab === "tickets" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" style={{ minHeight: 560 }}>
          <div className="lg:col-span-1">
            <Card className="max-h-[580px] overflow-y-auto">
              {tickets.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">No tickets</div>
              ) : (
                <div>
                  {tickets.map((t: any) => (
                    <button
                      key={t.id}
                      onClick={() => selectTicket(t)}
                      className={`w-full text-left px-4 py-3 border-b last:border-0 hover:bg-muted transition-colors ${selectedTicket?.id === t.id ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                    >
                      <p className="font-medium text-sm">#{t.id} {t.subject}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        <Badge variant={t.priority === "urgent" || t.priority === "critical" ? "destructive" : t.priority === "high" ? "default" : "secondary"} className="text-xs">{t.priority}</Badge>
                        <Badge variant="outline" className="text-xs">{t.status?.replace("_", " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="lg:col-span-2">
            {selectedTicket ? (
              <Card className="flex flex-col" style={{ height: 580 }}>
                <div className="border-b p-4 flex items-start justify-between flex-shrink-0">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-base truncate">#{selectedTicket.id} {selectedTicket.subject}</h3>
                    <div className="flex gap-2 mt-1 items-center flex-wrap">
                      <Badge variant={selectedTicket.priority === "urgent" || selectedTicket.priority === "critical" ? "destructive" : selectedTicket.priority === "high" ? "default" : "secondary"} className="text-xs">{selectedTicket.priority}</Badge>
                      <span className="text-xs text-muted-foreground">{selectedTicket.category}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                    <select
                      className="h-8 px-2 rounded border text-xs bg-background"
                      value={ticketDetail?.status || selectedTicket.status}
                      onChange={e => updateTicketStatus(selectedTicket.id, e.target.value)}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                    <Button size="sm" variant="ghost" className="text-destructive h-8 w-8 p-0" onClick={() => deleteItem("tickets", selectedTicket.id)}>
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {loadingDetail ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      <Loader2 className="animate-spin w-4 h-4 mr-2" /> Loading...
                    </div>
                  ) : (
                    <>
                      <div className="bg-muted/50 rounded-lg p-3">
                        <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase">Original Request</p>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{selectedTicket.description}</p>
                      </div>
                      {ticketDetail?.messages?.map((msg: any) => (
                        <div key={msg.id} className={`flex ${msg.senderType === "admin" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[80%] rounded-lg px-4 py-3 ${msg.senderType === "admin" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
                            <p className="text-xs font-semibold mb-1 opacity-80">{msg.senderName}</p>
                            <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.message}</p>
                            <p className="text-xs opacity-60 mt-1 text-right">{new Date(msg.createdAt).toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                <div className="border-t p-3 flex-shrink-0">
                  <div className="flex gap-2">
                    <textarea
                      className="flex-1 min-h-[64px] max-h-28 px-3 py-2 text-sm rounded-md border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                      placeholder="Type your reply... (client will be notified by email)"
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendTicketReply(); }}
                      disabled={sendingReply}
                    />
                    <Button className="self-end" size="sm" onClick={sendTicketReply} disabled={!replyText.trim() || sendingReply}>
                      {sendingReply ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Ctrl+Enter to send</p>
                </div>
              </Card>
            ) : (
              <Card className="flex items-center justify-center text-muted-foreground" style={{ minHeight: 300 }}>
                <div className="text-center">
                  <p className="font-medium">Select a ticket</p>
                  <p className="text-sm mt-1">View messages and reply to clients</p>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InvoicesTab({ invoices, headers, refresh }: { invoices: any[]; headers: () => any; refresh: () => void }) {
  const { toast } = useToast();

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Client Invoices</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b"><tr>
              {["Invoice", "Client", "Status", "Total", "Due Date", "Created"].map(h => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y">
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-xs">{inv.invoiceNumber}</td>
                  <td className="px-3 py-2 font-medium text-sm">{inv.userName || "N/A"}</td>
                  <td className="px-3 py-2">
                    <Badge variant={inv.status === "paid" ? "default" : "outline"}>
                      {inv.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 font-semibold">${parseFloat(inv.total || 0).toLocaleString()}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(inv.dueDate).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(inv.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {invoices.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No invoices</p>}
        </div>
      </CardContent>
    </Card>
  );
}


const LEAD_MAGNET_LABELS: Record<string, string> = {
  cybersecurity_assessment: "Cybersecurity Assessment",
  downtime_calculator: "Downtime Calculator",
  hipaa_checklist: "HIPAA Checklist",
  buyers_guide: "Buyer's Guide",
};

function LeadMagnetsTab({ submissions, headers, refresh, toast }: { submissions: any[]; headers: () => any; refresh: () => void; toast: any }) {
  const [filter, setFilter] = useState<string>("all");
  const [selected, setSelected] = useState<any | null>(null);
  const filtered = filter === "all" ? submissions : submissions.filter(s => s.magnet === filter);

  return (
    <div className="space-y-6">
      <LeadMagnetAnalytics headers={headers} />
      <LeadMagnetsTable
        submissions={submissions}
        filtered={filtered}
        filter={filter}
        setFilter={setFilter}
        selected={selected}
        setSelected={setSelected}
        headers={headers}
        refresh={refresh}
        toast={toast}
      />
    </div>
  );
}

function LeadMagnetsTable({ submissions, filtered, filter, setFilter, selected, setSelected, headers, refresh, toast }: any) {
  const [sequences, setSequences] = useState<any[]>([]);
  const [seqLoading, setSeqLoading] = useState(false);
  const [selectedSends, setSelectedSends] = useState<any[]>([]);
  const [editingMagnet, setEditingMagnet] = useState<string | null>(null);

  const loadSequences = useCallback(async () => {
    setSeqLoading(true);
    try {
      const r = await fetch("/api/admin/lead-magnets/sequences", { headers: headers() });
      if (r.ok) setSequences(await r.json());
    } finally { setSeqLoading(false); }
  }, [headers]);

  useEffect(() => { loadSequences(); }, [loadSequences]);

  useEffect(() => {
    if (!selected?.id) { setSelectedSends([]); return; }
    (async () => {
      try {
        const r = await fetch(`/api/admin/lead-magnets/${selected.id}/sequence`, { headers: headers() });
        if (r.ok) setSelectedSends(await r.json());
      } catch { setSelectedSends([]); }
    })();
  }, [selected, headers]);

  async function togglePause(magnet: string, paused: boolean) {
    try {
      const r = await fetch(`/api/admin/lead-magnets/sequences/${magnet}`, {
        method: "PATCH",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ paused }),
      });
      if (r.ok) {
        toast({ title: paused ? "Sequence paused" : "Sequence resumed" });
        loadSequences();
      } else toast({ title: "Update failed", variant: "destructive" });
    } catch { toast({ title: "Update failed", variant: "destructive" }); }
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this submission?")) return;
    try {
      const r = await fetch(`/api/admin/lead-magnets/${id}`, { method: "DELETE", headers: headers() });
      if (r.ok) { toast({ title: "Deleted" }); refresh(); }
      else toast({ title: "Delete failed", variant: "destructive" });
    } catch { toast({ title: "Delete failed", variant: "destructive" }); }
  }

  const counts: Record<string, number> = { all: submissions.length };
  for (const s of submissions) counts[s.magnet] = (counts[s.magnet] || 0) + 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Lead Magnet Submissions</span>
          <Button size="sm" variant="outline" onClick={refresh}>Refresh</Button>
        </CardTitle>
        <CardDescription>People who downloaded a free resource. {submissions.length} total.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-5 rounded-md border bg-blue-50/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-blue-900">Follow-up email sequences</h4>
            <span className="text-xs text-blue-800/70">3-step nurture (day 2 / 5 / 10) per magnet, with unsubscribe</span>
          </div>
          {seqLoading ? (
            <p className="text-xs text-muted-foreground">Loading sequences…</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-2">
              {sequences.map((seq: any) => (
                <div key={seq.magnet} className="flex items-center justify-between gap-3 bg-white border rounded px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{LEAD_MAGNET_LABELS[seq.magnet] || seq.magnet}</p>
                    <p className="text-xs text-muted-foreground">
                      {seq.steps?.length || 0} emails ·
                      <span className={seq.paused ? "text-amber-700 font-semibold ml-1" : "text-green-700 font-semibold ml-1"}>
                        {seq.paused ? "Paused" : "Active"}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setEditingMagnet(seq.magnet)}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
                    >
                      Edit copy
                    </button>
                    <button
                      onClick={() => togglePause(seq.magnet, !seq.paused)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                        seq.paused
                          ? "bg-green-600 text-white border-green-600 hover:bg-green-700"
                          : "bg-white text-amber-700 border-amber-300 hover:bg-amber-50"
                      }`}
                    >
                      {seq.paused ? "Resume" : "Pause"}
                    </button>
                  </div>
                </div>
              ))}
              {sequences.length === 0 && <p className="text-xs text-muted-foreground sm:col-span-2">No sequences configured.</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mb-4 border-b pb-3">
          {[
            { id: "all", label: "All" },
            { id: "cybersecurity_assessment", label: "Cybersecurity" },
            { id: "downtime_calculator", label: "Downtime" },
            { id: "hipaa_checklist", label: "HIPAA" },
            { id: "buyers_guide", label: "Buyer's Guide" },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                filter === t.id ? "bg-primary text-white border-primary" : "border-border bg-white text-foreground hover:bg-gray-50"
              }`}
            >
              {t.label} <span className="opacity-60">({counts[t.id] || 0})</span>
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Magnet</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Company</th>
                <th className="px-3 py-2 text-left">Phone</th>
                <th className="px-3 py-2 text-left">Email status</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any) => (
                <tr key={s.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(s.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2"><span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-medium">{LEAD_MAGNET_LABELS[s.magnet] || s.magnet}</span></td>
                  <td className="px-3 py-2 font-medium">{s.name}</td>
                  <td className="px-3 py-2"><a href={`mailto:${s.email}`} className="text-primary hover:underline">{s.email}</a></td>
                  <td className="px-3 py-2">{s.company || "—"}</td>
                  <td className="px-3 py-2">{s.phone ? <a href={`tel:${s.phone}`} className="text-primary hover:underline">{s.phone}</a> : "—"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      s.emailSent === "sent" ? "bg-green-50 text-green-700" :
                      s.emailSent === "failed" ? "bg-red-50 text-red-700" :
                      "bg-amber-50 text-amber-700"
                    }`}>{s.emailSent}</span>
                  </td>
                  <td className="px-3 py-2 space-x-2 text-xs">
                    <button onClick={() => setSelected(s)} className="text-primary hover:underline">View</button>
                    <button onClick={() => handleDelete(s.id)} className="text-red-600 hover:underline">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">No submissions</p>}
        </div>

        {editingMagnet && (
          <SequenceEditorDialog
            magnet={editingMagnet}
            label={LEAD_MAGNET_LABELS[editingMagnet] || editingMagnet}
            headers={headers}
            toast={toast}
            onClose={() => { setEditingMagnet(null); loadSequences(); }}
          />
        )}

        {selected && (
          <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{LEAD_MAGNET_LABELS[selected.magnet] || selected.magnet} — {selected.name}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p><strong>Email:</strong> {selected.email}</p>
                {selected.company && <p><strong>Company:</strong> {selected.company}</p>}
                {selected.phone && <p><strong>Phone:</strong> {selected.phone}</p>}
                {selected.source && <p><strong>Source:</strong> {selected.source}</p>}
                <p><strong>Submitted:</strong> {new Date(selected.createdAt).toLocaleString()}</p>
                {selected.unsubscribedAt && <p className="text-amber-700"><strong>Unsubscribed:</strong> {new Date(selected.unsubscribedAt).toLocaleString()}</p>}
                <div>
                  <p className="font-semibold mb-1">Follow-up sequence:</p>
                  {selectedSends.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No follow-ups sent yet.</p>
                  ) : (
                    <ul className="text-xs space-y-1">
                      {selectedSends.sort((a: any, b: any) => a.step - b.step).map((s: any) => (
                        <li key={s.id} className="flex items-center justify-between border rounded px-2 py-1 bg-gray-50">
                          <span>Step {s.step} · <span className={s.status === "sent" ? "text-green-700" : s.status === "failed" ? "text-red-700" : "text-amber-700"}>{s.status}</span></span>
                          <span className="text-muted-foreground">{new Date(s.sentAt).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-semibold mb-1">Submission payload:</p>
                  <pre className="bg-gray-50 border p-3 rounded text-xs overflow-auto">{JSON.stringify(selected.payload || {}, null, 2)}</pre>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}

interface SequenceStepView {
  step: number;
  delayDays: number;
  subject: string;
  intro: string;
  bodyHtml: string;
  defaults: { delayDays: number; subject: string; intro: string; bodyHtml: string };
  customized: boolean;
  updatedAt: string | null;
}

function SequenceEditorDialog({ magnet, label, headers, toast, onClose }: {
  magnet: string;
  label: string;
  headers: () => any;
  toast: (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
  onClose: () => void;
}) {
  const [steps, setSteps] = useState<SequenceStepView[] | null>(null);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [draft, setDraft] = useState<{ subject: string; intro: string; bodyHtml: string; delayDays: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string>("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/lead-magnets/sequences/${magnet}/steps`, { headers: headers() });
    if (!r.ok) { toast({ title: "Failed to load steps", variant: "destructive" }); return; }
    const data = await r.json();
    const list: SequenceStepView[] = data.steps || [];
    setSteps(list);
    const current = list.find(s => s.step === activeStep) || list[0];
    if (current) {
      setActiveStep(current.step);
      setDraft({ subject: current.subject, intro: current.intro, bodyHtml: current.bodyHtml, delayDays: current.delayDays });
    }
  }, [magnet, headers, toast, activeStep]);

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [magnet]);

  function selectStep(stepNum: number) {
    if (!steps) return;
    const s = steps.find(x => x.step === stepNum);
    if (!s) return;
    setActiveStep(stepNum);
    setDraft({ subject: s.subject, intro: s.intro, bodyHtml: s.bodyHtml, delayDays: s.delayDays });
    setPreviewHtml(null);
  }

  async function save() {
    if (!draft) return;
    if (!draft.subject.trim()) { toast({ title: "Subject is required", variant: "destructive" }); return; }
    if (!draft.bodyHtml.trim()) { toast({ title: "Body is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/lead-magnets/sequences/${magnet}/steps/${activeStep}`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!r.ok) { toast({ title: "Save failed", variant: "destructive" }); return; }
      toast({ title: "Step saved" });
      await load();
    } finally { setSaving(false); }
  }

  async function resetToDefault() {
    if (!confirm("Reset this step to the built-in default copy?")) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/lead-magnets/sequences/${magnet}/steps/${activeStep}`, {
        method: "DELETE",
        headers: headers(),
      });
      if (!r.ok) { toast({ title: "Reset failed", variant: "destructive" }); return; }
      toast({ title: "Reset to default" });
      await load();
    } finally { setSaving(false); }
  }

  async function preview() {
    if (!draft) return;
    const r = await fetch(`/api/admin/lead-magnets/sequences/${magnet}/steps/${activeStep}/preview`, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sample Recipient", subject: draft.subject, bodyHtml: draft.bodyHtml }),
    });
    if (!r.ok) { toast({ title: "Preview failed", variant: "destructive" }); return; }
    const data = await r.json();
    setPreviewSubject(data.subject || "");
    setPreviewHtml(data.html || "");
  }

  const activeView = steps?.find(s => s.step === activeStep) || null;

  return (
    <Dialog open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit follow-up emails — {label}</DialogTitle>
        </DialogHeader>
        {!steps || !draft ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 border-b pb-3">
              {steps.map(s => (
                <button
                  key={s.step}
                  type="button"
                  onClick={() => selectStep(s.step)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                    activeStep === s.step
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-foreground border-border hover:bg-gray-50"
                  }`}
                >
                  Step {s.step} · day {s.delayDays}
                  {s.customized && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 align-middle" title="Customized" />}
                </button>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-muted-foreground">
                Subject line
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className="mt-1 w-full text-sm border rounded px-2 py-1.5"
                  maxLength={500}
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Send this many days after signup
                <input
                  type="number"
                  min={0}
                  max={365}
                  value={draft.delayDays}
                  onChange={(e) => setDraft({ ...draft, delayDays: parseInt(e.target.value, 10) || 0 })}
                  className="mt-1 w-full text-sm border rounded px-2 py-1.5"
                />
              </label>
            </div>

            <label className="text-xs font-medium text-muted-foreground block">
              Internal note / intro line (shown in admin lists, not sent)
              <input
                type="text"
                value={draft.intro}
                onChange={(e) => setDraft({ ...draft, intro: e.target.value })}
                className="mt-1 w-full text-sm border rounded px-2 py-1.5"
                maxLength={1000}
              />
            </label>

            <label className="text-xs font-medium text-muted-foreground block">
              Email body (HTML). Available placeholders: <code className="bg-gray-100 px-1 rounded">{"{{name}}"}</code>, <code className="bg-gray-100 px-1 rounded">{"{{baseUrl}}"}</code>, <code className="bg-gray-100 px-1 rounded">{"{{unsubUrl}}"}</code>
              <textarea
                value={draft.bodyHtml}
                onChange={(e) => setDraft({ ...draft, bodyHtml: e.target.value })}
                rows={14}
                className="mt-1 w-full text-xs font-mono border rounded px-2 py-1.5"
                maxLength={50000}
              />
            </label>

            {activeView?.customized && activeView.updatedAt && (
              <p className="text-xs text-amber-700">
                Customized · last edited {new Date(activeView.updatedAt).toLocaleString()}
              </p>
            )}

            {previewHtml !== null && (
              <div className="border rounded">
                <div className="bg-gray-50 border-b px-3 py-2 text-xs">
                  <strong>Subject:</strong> {previewSubject}
                </div>
                <iframe
                  title="Email preview"
                  srcDoc={previewHtml}
                  sandbox=""
                  className="w-full h-80 bg-white"
                />
              </div>
            )}

            <DialogFooter className="flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={resetToDefault} disabled={saving || !activeView?.customized}>
                Reset to default
              </Button>
              <Button type="button" variant="outline" onClick={preview} disabled={saving}>
                Preview
              </Button>
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save step"}
              </Button>
              <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── LeadMagnetAnalytics ─────────────────────────────────────────────────────
const MAGNET_BAR_COLOR = "#2563eb";
const TIME_AREA_COLOR = "#1d4ed8";

function defaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

function LeadMagnetAnalytics({ headers }: { headers: () => any }) {
  const init = defaultDateRange();
  const [magnet, setMagnet] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [from, setFrom] = useState<string>(init.from);
  const [to, setTo] = useState<string>(init.to);
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (magnet) params.set("magnet", magnet);
        if (source) params.set("source", source);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        const res = await fetch(`/api/admin/lead-magnets/analytics?${params}`, { headers: headers() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [magnet, source, from, to]);

  const totals = data?.totals ?? { submissions: 0, converted: 0, conversionRate: 0 };
  const byMagnet = (data?.byMagnet ?? []).map((m: any) => ({ ...m, label: LEAD_MAGNET_LABELS[m.magnet] || m.magnet }));
  const topSources = data?.topSources ?? [];
  const timeSeries = data?.timeSeries ?? [];
  const sourceOptions: string[] = data?.sourceOptions ?? [];
  const granularity: string = data?.granularity ?? "day";

  function resetFilters() {
    const d = defaultDateRange();
    setMagnet(""); setSource(""); setFrom(d.from); setTo(d.to);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="w-4 h-4 text-primary" />
          Lead Magnet Conversion Dashboard
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 bg-gray-50 border rounded-md p-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs flex items-center gap-1"><Filter className="w-3 h-3" /> Magnet</Label>
            <select
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
              className="h-8 text-sm border border-input bg-white rounded-md px-2 min-w-[180px]"
            >
              <option value="">All magnets</option>
              {Object.entries(LEAD_MAGNET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs flex items-center gap-1"><Filter className="w-3 h-3" /> Source page</Label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="h-8 text-sm border border-input bg-white rounded-md px-2 min-w-[200px] max-w-[280px]"
            >
              <option value="">All sources</option>
              {sourceOptions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[150px]" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs flex items-center gap-1"><Calendar className="w-3 h-3" /> To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[150px]" />
          </div>
          <Button variant="outline" size="sm" onClick={resetFilters} className="h-8">Reset</Button>
        </div>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Downloads" value={totals.submissions} icon={<Download className="w-4 h-4 text-blue-500" />} sub="in selected range" />
          <KpiCard label="Converted to lead" value={totals.converted} icon={<Check className="w-4 h-4 text-green-500" />} sub="contact or quote" />
          <KpiCard label="Conversion rate" value={`${totals.conversionRate}%`} icon={<TrendingUp className="w-4 h-4 text-violet-500" />} sub="downloads → leads" />
          <KpiCard label="Top source" value={topSources[0]?.source ?? "—"} icon={<BarChart2 className="w-4 h-4 text-amber-500" />} sub={topSources[0] ? `${topSources[0].count} downloads` : ""} small />
        </div>

        {/* Time series */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-navy">Downloads over time</h3>
            <span className="text-xs text-muted-foreground capitalize">By {granularity}</span>
          </div>
          {loading ? (
            <div className="h-56 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : timeSeries.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No data in this range.</div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer>
                <AreaChart data={timeSeries} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lmFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={TIME_AREA_COLOR} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={TIME_AREA_COLOR} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area type="monotone" dataKey="count" stroke={TIME_AREA_COLOR} fill="url(#lmFill)" name="Downloads" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* By magnet + Top sources */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div>
            <h3 className="text-sm font-semibold text-navy mb-2">Downloads by magnet</h3>
            {byMagnet.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
            ) : (
              <>
                <div className="h-44 w-full">
                  <ResponsiveContainer>
                    <BarChart data={byMagnet} margin={{ top: 5, right: 12, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" fill={MAGNET_BAR_COLOR} radius={[4, 4, 0, 0]} name="Downloads" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 space-y-1">
                  {byMagnet.map((m: any) => (
                    <div key={m.magnet} className="flex items-center justify-between text-xs border-b last:border-0 py-1">
                      <span className="font-medium text-navy">{m.label}</span>
                      <span className="text-muted-foreground">
                        {m.count} downloads · <span className="text-green-700 font-semibold">{m.conversionRate}%</span> converted
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold text-navy mb-2">Top source pages</h3>
            {topSources.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No data</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-muted-foreground uppercase tracking-wide">
                    <tr>
                      <th className="px-2 py-1 text-left">Source</th>
                      <th className="px-2 py-1 text-right">Downloads</th>
                      <th className="px-2 py-1 text-right">Converted</th>
                      <th className="px-2 py-1 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topSources.map((s: any) => (
                      <tr key={s.source} className="border-t hover:bg-gray-50">
                        <td className="px-2 py-1.5 font-medium text-navy max-w-[260px] truncate" title={s.source}>{s.source}</td>
                        <td className="px-2 py-1.5 text-right">{s.count}</td>
                        <td className="px-2 py-1.5 text-right">{s.converted}</td>
                        <td className="px-2 py-1.5 text-right font-semibold text-green-700">{s.conversionRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function KpiCard({ label, value, icon, sub, small }: { label: string; value: any; icon: React.ReactNode; sub?: string; small?: boolean }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-center gap-2 mb-1">{icon}<span className="text-xs text-muted-foreground font-medium">{label}</span></div>
      <div className={`font-bold text-navy ${small ? "text-sm truncate" : "text-2xl"}`} title={typeof value === "string" ? value : undefined}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
