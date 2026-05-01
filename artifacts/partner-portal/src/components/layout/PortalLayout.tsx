import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Handshake, 
  Target, 
  BookOpen, 
  Award, 
  Bell, 
  User, 
  LogOut,
  DollarSign,
  Headphones,
  TrendingUp,
  Search,
  Grid3X3,
  ChevronDown,
  HelpCircle,
  Settings,
  Menu,
  X,
  Users,
  FolderOpen,
  Inbox,
  Building2,
  FileText,
  RefreshCw,
  CreditCard,
  ShieldCheck,
  Shield,
  AlertCircle,
  MapPin,
  MousePointerClick,
  Zap,
  ShoppingCart,
  Sparkles,
  Package,
  FileSignature,
  Activity,
} from "lucide-react";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

const BASE_NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/deals", label: "Deals", icon: Handshake },
  { href: "/leads", label: "Leads", icon: Target },
  { href: "/proposals/generate", label: "Generate Proposal", icon: FileText },
  { href: "/plans", label: "Written Plans", icon: FileSignature },
  { href: "/commissions", label: "Commissions", icon: DollarSign },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/marketplace", label: "Marketplace", icon: ShoppingCart },
  { href: "/vivint", label: "Vivint", icon: ShieldCheck },
  { href: "/documents", label: "Documents", icon: FolderOpen },
  { href: "/resources", label: "Resources", icon: BookOpen },
  { href: "/training", label: "Training", icon: Award },
  { href: "/service-availability", label: "Check Service", icon: MapPin },
  { href: "/support", label: "Support", icon: Headphones },
  { href: "/announcements", label: "News", icon: Bell },
];

const TEAM_NAV_ITEM = { href: "/team", label: "Team", icon: Users };

const CRM_NAV_ITEMS: { href: string; label: string; icon: any; adminOnly?: boolean }[] = [
  { href: "/admin/crm/dashboard", label: "CRM Dashboard", icon: LayoutDashboard },
  { href: "/admin/crm/contacts", label: "Contacts", icon: Users },
  { href: "/admin/crm/companies", label: "Companies", icon: Building2 },
  { href: "/admin/crm/leads", label: "Leads", icon: Target },
  { href: "/admin/crm/deals", label: "Deals", icon: Handshake },
  { href: "/admin/crm/activities", label: "Activities", icon: Activity },
  { href: "/admin/crm/tasks", label: "Tasks", icon: Bell },
  { href: "/admin/inquiries", label: "Inquiries", icon: Inbox, adminOnly: true },
  { href: "/admin/crm/settings", label: "CRM Settings", icon: Settings, adminOnly: true },
];

const ADMIN_NAV_ITEMS = [
  { href: "/admin/onboarding", label: "Onboarding Command Center", icon: Activity },
  { href: "/client-tickets", label: "Client Tickets", icon: Users },
  { href: "/admin/partners", label: "Partners", icon: Building2 },
  { href: "/admin/billing", label: "Billing Dashboard", icon: TrendingUp },
  { href: "/admin/pricing", label: "Pricing Tiers", icon: DollarSign },
  { href: "/admin/commissions", label: "Commissions (Admin)", icon: CreditCard },
  { href: "/admin/tsd-products", label: "TSD Products", icon: Package },
  { href: "/admin/tsd-vendor-routing", label: "TSD Vendor Routing", icon: RefreshCw },
  { href: "/admin/documents", label: "Documents (Admin)", icon: FileText },
  { href: "/admin/invoices", label: "Invoices", icon: FileText },
  { href: "/admin/affiliate-clicks", label: "ISP Affiliate Clicks", icon: MousePointerClick },
  { href: "/admin/affiliate-programs", label: "Affiliate Programs", icon: DollarSign },
  { href: "/admin/impact", label: "Impact.com", icon: Zap },
  { href: "/admin/partnerstack", label: "PartnerStack", icon: RefreshCw },
  { href: "/admin/marketplace", label: "Marketplace", icon: ShoppingCart },
  { href: "/admin/ai-page-editor", label: "AI Page Editor", icon: Sparkles },
  { href: "/admin/esign", label: "E-Signatures", icon: FileSignature },
  { href: "/admin/users", label: "Admin Users", icon: ShieldCheck },
  { href: "/admin/azure-ad", label: "Azure AD (Entra)", icon: ShieldCheck },
  { href: "/admin/security", label: "Security Settings", icon: Shield },
];

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");

  if (!user) return null;

  const isPending = user.status === "pending";
  const isTeamMember = Boolean(user.isTeamMember);
  const tmPerms = user.teamMember?.permissions;

  const baseItems = isTeamMember
    ? BASE_NAV_ITEMS.filter(item => {
        if (!tmPerms) return false;
        switch (item.href) {
          case "/dashboard": return true;
          case "/deals": return tmPerms.canViewDeals;
          case "/leads": return tmPerms.canViewLeads;
          case "/commissions": return tmPerms.canViewCommissions;
          case "/resources": return tmPerms.canViewResources;
          case "/plans": return tmPerms.canCreatePlans;
          case "/proposals/generate": return tmPerms.canCreatePlans;
          case "/billing": return false;
          case "/marketplace": return tmPerms.canViewResources;
          case "/vivint": return false;
          case "/documents": return tmPerms.canViewResources;
          case "/training": return tmPerms.canViewResources;
          case "/service-availability": return true;
          case "/support": return true;
          case "/announcements": return true;
          default: return true;
        }
      })
    : BASE_NAV_ITEMS;

  const navItems = isTeamMember ? baseItems : [...baseItems, TEAM_NAV_ITEM];
  const adminItems = user.isMainSiteAdmin ? ADMIN_NAV_ITEMS : [];
  const NAV_ITEMS = [...navItems, ...adminItems];
  const currentTab = NAV_ITEMS.find(i => location === i.href) || NAV_ITEMS[0];

  return (
    <div className="min-h-screen flex flex-col bg-[#f3f3f3]">
      {/* Salesforce-style Top Header */}
      <header className="sf-header text-white flex-shrink-0 z-50 relative">
        <div className="h-10 sm:h-11 flex items-center px-2 sm:px-4 gap-2 sm:gap-3">
          {/* App Launcher */}
          <button className="p-1 sm:p-1.5 hover:bg-white/10 rounded transition-colors hidden sm:flex" title="App Launcher" aria-label="App Launcher">
            <Grid3X3 className="w-4 sm:w-5 h-4 sm:h-5" />
          </button>

          {/* Logo */}
          <Link href="/dashboard" className="flex items-center gap-1.5 sm:gap-2 mr-2 sm:mr-4 shrink-0">
            <span className="font-bold text-xs sm:text-base tracking-tight">Siebert <span className="hidden sm:inline">Partners</span></span>
          </Link>

          {/* Desktop Nav Tabs */}
          <nav className="hidden lg:flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto">
            {navItems.map(item => {
              const isActive = location === item.href;
              const disabled = isPending && item.href !== "/dashboard" && item.href !== "/profile";
              return (
                <Link 
                  key={item.href} 
                  href={disabled ? "#" : item.href}
                  onClick={(e) => disabled && e.preventDefault()}
                >
                  <div className={cn(
                    "px-2 sm:px-3 py-2 text-[12px] sm:text-[13px] font-medium rounded-t transition-colors whitespace-nowrap cursor-pointer",
                    isActive 
                      ? "bg-[#f3f3f3] text-[#032d60]" 
                      : disabled 
                        ? "opacity-40 cursor-not-allowed text-white/70" 
                        : "text-white/90 hover:bg-white/10 hover:text-white"
                  )}>
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </nav>

          {/* CRM and Admin dropdowns are both gated to main-site admins —
              CRM endpoints require the admin JWT shape, so non-admin sessions
              would only see broken UI here. */}
          {user.isMainSiteAdmin && <CrmNavDropdown location={location} isAdmin />}
          {user.isMainSiteAdmin && <AdminNavDropdown location={location} />}

          {/* Mobile Menu Toggle */}
          <button className="lg:hidden p-1 sm:p-1.5 hover:bg-white/10 rounded ml-auto" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label={mobileMenuOpen ? "Close menu" : "Open menu"} aria-expanded={mobileMenuOpen}>
            {mobileMenuOpen ? <X className="w-4 sm:w-5 h-4 sm:h-5" /> : <Menu className="w-4 sm:w-5 h-4 sm:h-5" />}
          </button>

          {/* Right side actions */}
          <div className="hidden lg:flex items-center gap-1 ml-auto">
            {/* Global CRM search — admin-only since the backend route is
                guarded by requireAdmin. */}
            {user.isMainSiteAdmin && <GlobalCrmSearch />}

            <button className="p-1 sm:p-1.5 hover:bg-white/10 rounded transition-colors" title="Help" aria-label="Help">
              <HelpCircle className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-white/80" />
            </button>

            {/* User Avatar */}
            <div className="relative ml-1">
              <button 
                onClick={() => setShowUserMenu(!showUserMenu)}
                aria-label="User menu" aria-expanded={showUserMenu}
                className="w-6 sm:w-7 h-6 sm:h-7 rounded-full bg-[#fe9339] flex items-center justify-center text-white text-[10px] sm:text-xs font-bold hover:ring-2 hover:ring-white/30 transition-all"
              >
                {user.contactName.charAt(0).toUpperCase()}
              </button>
              
              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded shadow-lg border border-[#d8dde6] z-50 text-foreground overflow-hidden">
                    <div className="p-4 border-b border-[#d8dde6] bg-[#fafaf9]">
                      <p className="font-semibold text-sm">{user.contactName}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                      <p className="text-xs text-muted-foreground mt-1">{user.companyName}</p>
                      <span className="inline-block mt-2 px-2 py-0.5 text-[10px] font-semibold rounded bg-[#0176d3]/10 text-[#0176d3] uppercase">{user.tier} Partner</span>
                    </div>
                    <Link href="/profile" onClick={() => setShowUserMenu(false)}>
                      <div className="px-4 py-2.5 text-sm hover:bg-[#f3f3f3] flex items-center gap-2 cursor-pointer">
                        <Settings className="w-3.5 h-3.5 text-muted-foreground" /> Settings
                      </div>
                    </Link>
                    <button onClick={logout} className="w-full px-4 py-2.5 text-sm hover:bg-[#f3f3f3] flex items-center gap-2 text-left border-t border-[#d8dde6]">
                      <LogOut className="w-3.5 h-3.5 text-muted-foreground" /> Log Out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Menu Dropdown */}
        {mobileMenuOpen && (
          <div className="lg:hidden border-t border-white/10 bg-[#032d60] pb-2 px-2 max-h-[calc(100vh-40px)] overflow-y-auto">
            {navItems.map(item => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                  <div className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium",
                    isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10"
                  )}>
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
            {/* CRM section is admin-only — non-admin sessions cannot reach
                /admin/crm/* APIs. */}
            {user.isMainSiteAdmin && (
              <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-white/40 font-semibold mt-2 flex items-center gap-1.5">
                <Users className="w-3 h-3" /> CRM
              </div>
            )}
            {user.isMainSiteAdmin && CRM_NAV_ITEMS.map(item => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                  <div className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium",
                    isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10"
                  )}>
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
            {user.isMainSiteAdmin && (
              <>
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-white/40 font-semibold mt-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3" /> Admin
                </div>
                {ADMIN_NAV_ITEMS.map(item => {
                  const isActive = location === item.href;
                  const Icon = item.icon;
                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}>
                      <div className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium",
                        isActive ? "bg-white/15 text-white" : "text-white/80 hover:bg-white/10"
                      )}>
                        <Icon className="w-4 h-4" />
                        {item.label}
                      </div>
                    </Link>
                  );
                })}
              </>
            )}
            <div className="border-t border-white/10 mt-1 pt-1">
              <Link href="/profile" onClick={() => setMobileMenuOpen(false)}>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium text-white/80 hover:bg-white/10">
                  <User className="w-4 h-4" /> Profile
                </div>
              </Link>
              <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded text-sm font-medium text-white/80 hover:bg-white/10">
                <LogOut className="w-4 h-4" /> Sign Out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Page Content */}
      <main className="flex-1 overflow-auto">
        {isPending && location !== "/profile" ? (
          <div className="max-w-2xl mx-auto mt-6 sm:mt-12 px-3 sm:px-4">
            <div className="sf-card p-4 sm:p-8 text-center">
              <div className="w-12 sm:w-14 h-12 sm:h-14 bg-[#fe9339]/10 rounded-full flex items-center justify-center mx-auto mb-3 sm:mb-4">
                <Target className="w-6 sm:w-7 h-6 sm:h-7 text-[#fe9339]" />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-foreground mb-2">Application Under Review</h2>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                Thank you for applying to the Siebert Services Partner Program. Our team is currently reviewing your application.
              </p>
              <Link href="/profile">
                <button className="sf-btn sf-btn-primary">Review Your Profile</button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="w-full">
            {children}
          </div>
        )}
      </main>
    </div>
  );
}

function AdminNavDropdown({ location }: { location: string }) {
  const [open, setOpen] = useState(false);

  const isAdminRoute = location.startsWith("/admin") || location === "/client-tickets";

  const adminLinks = [
    { href: "/admin/onboarding", label: "Onboarding Command Center", icon: Activity },
    { href: "/client-tickets", label: "Client Tickets", icon: Users },
    { href: "/admin/inquiries", label: "Inquiries", icon: Inbox },
    { href: "/admin/leads", label: "Manage Leads", icon: AlertCircle },
    { href: "/admin/partners", label: "Partners", icon: Building2 },
    { href: "/admin/billing", label: "Billing Dashboard", icon: TrendingUp },
    { href: "/admin/pricing", label: "Pricing Tiers", icon: DollarSign },
    { href: "/admin/commissions", label: "Commissions", icon: CreditCard },
    { href: "/admin/tsd-products", label: "TSD Products", icon: Package },
    { href: "/admin/tsd-vendor-routing", label: "TSD Vendor Routing", icon: RefreshCw },
    { href: "/admin/documents", label: "Documents", icon: FileText },
    { href: "/admin/msa-generator", label: "MSA Generator", icon: FileText },
    { href: "/admin/invoices", label: "Invoices", icon: FileText },
    { href: "/admin/affiliate-clicks", label: "ISP Affiliate Clicks", icon: MousePointerClick },
    { href: "/admin/affiliate-programs", label: "Affiliate Programs", icon: DollarSign },
    { href: "/admin/impact", label: "Impact.com", icon: Zap },
    { href: "/admin/partnerstack", label: "PartnerStack", icon: RefreshCw },
    { href: "/admin/ai-page-editor", label: "AI Page Editor", icon: Sparkles },
    { href: "/admin/esign", label: "E-Signatures", icon: FileSignature },
    { href: "/admin/plans", label: "Written Plans", icon: FileText },
    { href: "/admin/users", label: "Admin Users", icon: ShieldCheck },
    { href: "/admin/azure-ad", label: "Azure AD (Entra)", icon: ShieldCheck },
  ];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 px-3 py-2 text-[13px] font-medium rounded-t transition-colors whitespace-nowrap cursor-pointer",
          isAdminRoute
            ? "bg-[#f3f3f3] text-[#032d60]"
            : "text-white/90 hover:bg-white/10 hover:text-white"
        )}
        aria-expanded={open}
      >
        <ShieldCheck className="w-3.5 h-3.5 mr-0.5" />
        Admin
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-0.5 w-52 bg-white rounded shadow-lg border border-[#d8dde6] z-50 text-foreground overflow-hidden py-1">
            {adminLinks.map(item => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors",
                    isActive
                      ? "bg-[#032d60]/10 text-[#032d60] font-medium"
                      : "text-foreground hover:bg-[#f3f3f3]"
                  )}>
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function CrmNavDropdown({ location, isAdmin }: { location: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const isCrm = location.startsWith("/admin/crm") || location === "/admin/inquiries";
  const items = CRM_NAV_ITEMS.filter(i => isAdmin || !i.adminOnly);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-1 px-3 py-2 text-[13px] font-medium rounded-t transition-colors whitespace-nowrap cursor-pointer",
          isCrm ? "bg-[#f3f3f3] text-[#032d60]" : "text-white/90 hover:bg-white/10 hover:text-white"
        )}
        aria-expanded={open}
      >
        <Users className="w-3.5 h-3.5 mr-0.5" />
        CRM
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-0.5 w-56 bg-white rounded shadow-lg border border-[#d8dde6] z-50 text-foreground overflow-hidden py-1">
            {items.map(item => {
              const isActive = location === item.href;
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} onClick={() => setOpen(false)}>
                  <div className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer transition-colors",
                    isActive ? "bg-[#032d60]/10 text-[#032d60] font-medium" : "text-foreground hover:bg-[#f3f3f3]"
                  )}>
                    <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

type SearchHit = { id: number; name?: string; fullName?: string; title?: string; contactName?: string; email?: string; companyName?: string; customerName?: string };
type SearchResults = { contacts: SearchHit[]; companies: SearchHit[]; deals: SearchHit[]; leads: SearchHit[] };

function GlobalCrmSearch() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q.trim()) { setResults(null); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/admin/crm/search?q=${encodeURIComponent(q)}`, { headers: getAuthHeaders(), signal: ctrl.signal });
        if (r.ok) { setResults(await r.json()); setOpen(true); }
      } catch { /* aborted */ }
    }, 250);
    return () => { ctrl.abort(); clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const total = results
    ? results.contacts.length + results.companies.length + results.deals.length + results.leads.length
    : 0;

  return (
    <div className="relative hidden md:block" ref={ref}>
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/50" />
      <input
        type="text"
        placeholder="Search CRM..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        className="h-7 w-56 pl-8 pr-3 text-xs bg-white/15 border border-white/20 rounded text-white placeholder:text-white/50 focus:outline-none focus:bg-white/25 focus:border-white/40 transition-all"
      />
      {open && results && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-96 overflow-y-auto bg-white rounded shadow-xl border border-[#d8dde6] z-50 text-foreground">
          {total === 0 && <div className="p-3 text-sm text-muted-foreground">No matches.</div>}
          {results.contacts.length > 0 && <SearchSection title="Contacts" hits={results.contacts} hrefFor={(h) => `/admin/crm/contacts/${h.id}`} labelFor={(h) => h.fullName || h.name || `Contact #${h.id}`} subFor={(h) => h.email || ""} onClose={() => setOpen(false)} />}
          {results.companies.length > 0 && <SearchSection title="Companies" hits={results.companies} hrefFor={(h) => `/admin/crm/companies/${h.id}`} labelFor={(h) => h.name || `Company #${h.id}`} subFor={() => ""} onClose={() => setOpen(false)} />}
          {results.deals.length > 0 && <SearchSection title="Deals" hits={results.deals} hrefFor={(h) => `/admin/crm/deals/${h.id}`} labelFor={(h) => h.title || h.customerName || `Deal #${h.id}`} subFor={(h) => h.customerName || ""} onClose={() => setOpen(false)} />}
          {/* Leads have no detail page yet — link to the list and let the user filter. */}
          {results.leads.length > 0 && <SearchSection title="Leads" hits={results.leads} hrefFor={() => `/admin/crm/leads`} labelFor={(h) => h.contactName || `Lead #${h.id}`} subFor={(h) => h.companyName || ""} onClose={() => setOpen(false)} />}
        </div>
      )}
    </div>
  );
}

function SearchSection({ title, hits, hrefFor, labelFor, subFor, onClose }: {
  title: string; hits: SearchHit[];
  hrefFor: (h: SearchHit) => string;
  labelFor: (h: SearchHit) => string;
  subFor: (h: SearchHit) => string;
  onClose: () => void;
}) {
  return (
    <div className="border-b last:border-b-0 border-[#e5e5e5]">
      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-[#fafafa]">{title}</div>
      {hits.map(h => (
        <Link key={`${title}-${h.id}`} href={hrefFor(h)} onClick={onClose}>
          <div className="px-3 py-2 text-sm hover:bg-[#f3f3f3] cursor-pointer">
            <div className="font-medium">{labelFor(h)}</div>
            {subFor(h) && <div className="text-xs text-muted-foreground">{subFor(h)}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}
