import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Pages
import PublicHome from "./pages/PublicHome";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Deals from "./pages/Deals";
import Leads from "./pages/Leads";
import Resources from "./pages/Resources";
import Training from "./pages/Training";
import Announcements from "./pages/Announcements";
import Profile from "./pages/Profile";
import Commissions from "./pages/Commissions";
import Marketplace from "./pages/Marketplace";
import SupportTickets from "./pages/SupportTickets";
import ClientTickets from "./pages/ClientTickets";
import Documents from "./pages/Documents";
import AdminInquiries from "./pages/AdminInquiries";
import ProposalGenerator from "./pages/ProposalGenerator";
import AdminPartners from "./pages/AdminPartners";
import AdminCommissions from "./pages/AdminCommissions";
import AdminTsdVendorRouting from "./pages/AdminTsdVendorRouting";
import AdminDocuments from "./pages/AdminDocuments";
import AdminInvoices from "./pages/AdminInvoices";
import AdminLeads from "./pages/AdminLeads";
import AdminAffiliateClicks from "./pages/AdminAffiliateClicks";
import AdminAffiliatePrograms from "./pages/AdminAffiliatePrograms";
import AdminImpact from "./pages/AdminImpact";
import AdminMarketplace from "./pages/AdminMarketplace";
import AdminTsdProducts from "./pages/AdminTsdProducts";
import AIPageEditor from "./pages/admin/AIPageEditor";
import OnboardingCommandCenter from "./pages/admin/OnboardingCommandCenter";
import ServiceAvailability from "./pages/ServiceAvailability";
import Vivint from "./pages/Vivint";
import Billing from "./pages/Billing";
import AdminBilling from "./pages/AdminBilling";
import ResetPassword from "./pages/ResetPassword";
import PendingApproval from "./pages/PendingApproval";
import NotFound from "./pages/not-found";
import AdminUsers from "./pages/AdminUsers";
import AdminAzureAd from "./pages/AdminAzureAd";
import AdminMSAGenerator from "./pages/AdminMSAGenerator";
import AdminEsign from "./pages/AdminEsign";
import AdminPricing from "./pages/AdminPricing";
import ForceChangePassword from "./pages/ForceChangePassword";
import WrittenPlans from "./pages/WrittenPlans";
import PlanReview from "./pages/PlanReview";
import EsignReview from "./pages/EsignReview";
import AdminPlans from "./pages/AdminPlans";
import AdminCustomers from "./pages/AdminCustomers";
import AdminPartnerstack from "./pages/AdminPartnerstack";
import ClientDashboard from "./pages/ClientDashboard";
import ClientOnboarding from "./pages/ClientOnboarding";
import Team from "./pages/Team";
import AcceptTeamInvite from "./pages/AcceptTeamInvite";
import CrmDashboard from "./pages/admin/crm/CrmDashboard";
import CrmContacts from "./pages/admin/crm/CrmContacts";
import CrmContactDetail from "./pages/admin/crm/CrmContactDetail";
import CrmCompanies from "./pages/admin/crm/CrmCompanies";
import CrmCompanyDetail from "./pages/admin/crm/CrmCompanyDetail";
import CrmActivities from "./pages/admin/crm/CrmActivities";
import CrmTasks from "./pages/admin/crm/CrmTasks";
import CrmSettings from "./pages/admin/crm/CrmSettings";
import CrmDealDetail from "./pages/admin/crm/CrmDealDetail";

import { useAuth } from "./hooks/use-auth";

const queryClient = new QueryClient();

// Protected route wrapper
function ProtectedRoute({ component: Component, allowWithMustChangePassword }: { component: any; allowWithMustChangePassword?: boolean }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && user.mustChangePassword && !allowWithMustChangePassword) {
      setLocation("/force-change-password");
    }
  }, [isLoading, user, allowWithMustChangePassword]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">Loading...</div>;
  }

  if (!user) {
    window.location.href = `${import.meta.env.BASE_URL}login`;
    return null;
  }

  if (user.mustChangePassword && !allowWithMustChangePassword) {
    return null;
  }

  return <Component />;
}

// Admin-only route wrapper — gates routes behind isMainSiteAdmin.
function AdminProtectedRoute({ component: Component }: { component: any }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && user && !user.isMainSiteAdmin) {
      setLocation("/dashboard");
    }
  }, [isLoading, user]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">Loading...</div>;
  }

  if (!user) {
    window.location.href = `${import.meta.env.BASE_URL}login`;
    return null;
  }

  if (!user.isMainSiteAdmin) {
    return null;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={PublicHome} />
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/pending" component={PendingApproval} />
      
      {/* Protected Portal Routes */}
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/deals"><ProtectedRoute component={Deals} /></Route>
      <Route path="/leads"><ProtectedRoute component={Leads} /></Route>
      <Route path="/resources"><ProtectedRoute component={Resources} /></Route>
      <Route path="/training"><ProtectedRoute component={Training} /></Route>
      <Route path="/announcements"><ProtectedRoute component={Announcements} /></Route>
      <Route path="/commissions"><ProtectedRoute component={Commissions} /></Route>
      <Route path="/marketplace"><ProtectedRoute component={Marketplace} /></Route>
      <Route path="/support"><ProtectedRoute component={SupportTickets} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
      <Route path="/team"><ProtectedRoute component={Team} /></Route>
      <Route path="/team/accept/:token" component={AcceptTeamInvite} />
      <Route path="/client-tickets"><ProtectedRoute component={ClientTickets} /></Route>
      <Route path="/documents"><ProtectedRoute component={Documents} /></Route>
      <Route path="/admin/inquiries"><ProtectedRoute component={AdminInquiries} /></Route>
      <Route path="/proposals/generate"><ProtectedRoute component={ProposalGenerator} /></Route>
      <Route path="/plans"><ProtectedRoute component={WrittenPlans} /></Route>
      <Route path="/plan-review/:token" component={PlanReview} />
      <Route path="/esign/:token" component={EsignReview} />
      <Route path="/c/:token/onboarding" component={ClientOnboarding} />
      <Route path="/c/:token" component={ClientDashboard} />

      {/* Admin-only Partner Management Routes */}
      <Route path="/admin/partners"><ProtectedRoute component={AdminPartners} /></Route>
      <Route path="/admin/leads"><ProtectedRoute component={AdminLeads} /></Route>
      <Route path="/admin/commissions"><ProtectedRoute component={AdminCommissions} /></Route>
      <Route path="/admin/tsd-vendor-routing"><ProtectedRoute component={AdminTsdVendorRouting} /></Route>
      <Route path="/admin/documents"><ProtectedRoute component={AdminDocuments} /></Route>
      <Route path="/admin/invoices"><ProtectedRoute component={AdminInvoices} /></Route>
      <Route path="/admin/affiliate-clicks"><ProtectedRoute component={AdminAffiliateClicks} /></Route>
      <Route path="/admin/affiliate-programs"><ProtectedRoute component={AdminAffiliatePrograms} /></Route>
      <Route path="/admin/impact"><ProtectedRoute component={AdminImpact} /></Route>
      <Route path="/admin/marketplace"><ProtectedRoute component={AdminMarketplace} /></Route>
      <Route path="/admin/tsd-products"><ProtectedRoute component={AdminTsdProducts} /></Route>
      <Route path="/admin/ai-page-editor"><ProtectedRoute component={AIPageEditor} /></Route>
      <Route path="/admin/onboarding"><ProtectedRoute component={OnboardingCommandCenter} /></Route>
      <Route path="/admin/billing"><ProtectedRoute component={AdminBilling} /></Route>
      <Route path="/admin/users"><ProtectedRoute component={AdminUsers} /></Route>
      <Route path="/admin/azure-ad"><ProtectedRoute component={AdminAzureAd} /></Route>
      <Route path="/admin/msa-generator"><ProtectedRoute component={AdminMSAGenerator} /></Route>
      <Route path="/admin/esign"><ProtectedRoute component={AdminEsign} /></Route>
      <Route path="/admin/pricing"><ProtectedRoute component={AdminPricing} /></Route>
      <Route path="/admin/plans"><ProtectedRoute component={AdminPlans} /></Route>
      <Route path="/admin/customers"><Redirect to="/admin/crm/companies" /></Route>
      <Route path="/admin/customers/:key">{(params) => <Redirect to={`/admin/crm/companies?key=${encodeURIComponent(params.key)}`} />}</Route>
      <Route path="/admin/partnerstack"><ProtectedRoute component={AdminPartnerstack} /></Route>

      {/* CRM is admin-only end-to-end — APIs require the admin JWT shape. */}
      <Route path="/admin/crm"><AdminProtectedRoute component={CrmDashboard} /></Route>
      <Route path="/admin/crm/dashboard"><AdminProtectedRoute component={CrmDashboard} /></Route>
      <Route path="/admin/crm/contacts"><AdminProtectedRoute component={CrmContacts} /></Route>
      <Route path="/admin/crm/contacts/:id"><AdminProtectedRoute component={CrmContactDetail} /></Route>
      <Route path="/admin/crm/companies"><AdminProtectedRoute component={CrmCompanies} /></Route>
      <Route path="/admin/crm/companies/:id"><AdminProtectedRoute component={CrmCompanyDetail} /></Route>
      <Route path="/admin/crm/activities"><AdminProtectedRoute component={CrmActivities} /></Route>
      <Route path="/admin/crm/tasks"><AdminProtectedRoute component={CrmTasks} /></Route>
      <Route path="/admin/crm/settings"><AdminProtectedRoute component={CrmSettings} /></Route>
      <Route path="/admin/crm/deals/:id"><AdminProtectedRoute component={CrmDealDetail} /></Route>
      <Route path="/admin/crm/deals"><AdminProtectedRoute component={Deals} /></Route>
      <Route path="/admin/crm/leads"><AdminProtectedRoute component={AdminLeads} /></Route>
      <Route path="/billing"><ProtectedRoute component={Billing} /></Route>
      <Route path="/service-availability"><ProtectedRoute component={ServiceAvailability} /></Route>
      <Route path="/vivint"><ProtectedRoute component={Vivint} /></Route>
      <Route path="/force-change-password"><ProtectedRoute component={ForceChangePassword} allowWithMustChangePassword /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
