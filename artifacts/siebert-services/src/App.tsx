import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/lib/auth";
import { Layout } from "@/components/layout/Layout";

// Pages
import Home from "./pages/Home";
import Services from "./pages/Services";
import ManagedIT from "./pages/services/ManagedIT";
import Cybersecurity from "./pages/services/Cybersecurity";
import CloudServices from "./pages/services/Cloud";
import BackupDR from "./pages/services/BackupDR";
import Compliance from "./pages/services/Compliance";
import NetworkInfrastructure from "./pages/services/Network";
import ZoomPartner from "./pages/ZoomPartner";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Quote from "./pages/Quote";
import Pricing from "./pages/Pricing";
import Portal from "./pages/Portal";
import Admin from "./pages/Admin";
import ProposalView from "./pages/ProposalView";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";
import CaseStudies from "./pages/CaseStudies";
import CaseStudyDetail from "./pages/CaseStudyDetail";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import AffiliateRecommendations from "./pages/AffiliateRecommendations";
import ExtremeNetworks from "./pages/ExtremeNetworks";
import HP from "./pages/HP";
import Dell from "./pages/Dell";
import JuniperNetworks from "./pages/JuniperNetworks";
import Vivint from "./pages/Vivint";
import VivintForm from "./pages/VivintForm";
import Altice from "./pages/Altice";
import ComcastBusiness from "./pages/ComcastBusiness";
import SpectrumBusiness from "./pages/SpectrumBusiness";
import ATTBusiness from "./pages/ATTBusiness";
import VerizonBusiness from "./pages/VerizonBusiness";
import CoxBusiness from "./pages/CoxBusiness";
import RingCentral from "./pages/RingCentral";
import Microsoft365 from "./pages/Microsoft365";
import CiscoMeraki from "./pages/CiscoMeraki";
import Fortinet from "./pages/Fortinet";
import ADTBusiness from "./pages/ADTBusiness";
import Lumen from "./pages/Lumen";
import TMobileBusiness from "./pages/TMobileBusiness";
import EightByEight from "./pages/EightByEight";
import PaloAltoNetworks from "./pages/PaloAltoNetworks";
import InternetPlans from "./pages/InternetPlans";
import Industries from "./pages/Industries";
import IndustryPage from "./pages/IndustryPage";
import NotFound from "./pages/not-found";
import ResourcesIndex from "./pages/resources/ResourcesIndex";
import CybersecurityAssessment from "./pages/resources/CybersecurityAssessment";
import DowntimeCalculator from "./pages/resources/DowntimeCalculator";
import { HipaaChecklistPage, BuyersGuidePage } from "./pages/resources/GatedDownload";
import ResourceThankYou from "./pages/resources/ThankYou";
import PrintableHipaa from "./pages/resources/PrintableHipaa";
import PrintableBuyersGuide from "./pages/resources/PrintableBuyersGuide";
import { ExitIntentPopup } from "@/components/leadMagnets";
import Welcome from "./pages/Welcome";
import ManageSubscription from "./pages/ManageSubscription";
import ResetPassword from "./pages/ResetPassword";

const queryClient = new QueryClient();

function PublicRouter() {
  return (
    <Layout>
      <Switch>
        {/* Core pages */}
        <Route path="/" component={Home} />
        <Route path="/services" component={Services} />
        <Route path="/services/managed-it" component={ManagedIT} />
        <Route path="/services/cybersecurity" component={Cybersecurity} />
        <Route path="/services/cloud" component={CloudServices} />
        <Route path="/services/backup-disaster-recovery" component={BackupDR} />
        <Route path="/services/compliance" component={Compliance} />
        <Route path="/services/network" component={NetworkInfrastructure} />
        <Route path="/about" component={About} />
        <Route path="/contact" component={Contact} />
        <Route path="/quote" component={Quote} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/welcome" component={Welcome} />
        <Route path="/manage/subscription" component={ManageSubscription} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />

        {/* Industries */}
        <Route path="/industries" component={Industries} />
        <Route path="/industries/:slug" component={IndustryPage} />

        {/* Features & Tools */}
        <Route path="/internet-plans" component={InternetPlans} />
        {/* Future route: /internet-availability */}

        {/* Partner programs */}
        <Route path="/zoom" component={ZoomPartner} />
        <Route path="/portal" component={Portal} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route path="/recommended" component={AffiliateRecommendations} />

        {/* Vendor partner pages */}
        <Route path="/extreme-networks" component={ExtremeNetworks} />
        <Route path="/hp" component={HP} />
        <Route path="/dell" component={Dell} />
        <Route path="/juniper-networks" component={JuniperNetworks} />
        <Route path="/vivint" component={Vivint} />
        <Route path="/vivint/inquiry" component={VivintForm} />
        <Route path="/altice" component={Altice} />
        <Route path="/comcast-business" component={ComcastBusiness} />
        <Route path="/spectrum-business" component={SpectrumBusiness} />
        <Route path="/att-business" component={ATTBusiness} />
        <Route path="/verizon-business" component={VerizonBusiness} />
        <Route path="/cox-business" component={CoxBusiness} />
        <Route path="/ringcentral" component={RingCentral} />
        <Route path="/microsoft-365" component={Microsoft365} />
        <Route path="/cisco-meraki" component={CiscoMeraki} />
        <Route path="/fortinet" component={Fortinet} />
        <Route path="/adt-business" component={ADTBusiness} />
        <Route path="/lumen" component={Lumen} />
        <Route path="/t-mobile-business" component={TMobileBusiness} />
        <Route path="/8x8" component={EightByEight} />
        <Route path="/palo-alto-networks" component={PaloAltoNetworks} />

        {/* Resources / Lead Magnets */}
        <Route path="/resources" component={ResourcesIndex} />
        <Route path="/resources/cybersecurity-assessment" component={CybersecurityAssessment} />
        <Route path="/resources/downtime-calculator" component={DowntimeCalculator} />
        <Route path="/resources/hipaa-checklist" component={HipaaChecklistPage} />
        <Route path="/resources/buyers-guide" component={BuyersGuidePage} />
        <Route path="/resources/hipaa-checklist/download" component={PrintableHipaa} />
        <Route path="/resources/buyers-guide/download" component={PrintableBuyersGuide} />
        <Route path="/resources/:slug/thanks" component={ResourceThankYou} />

        {/* Blog */}
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:slug" component={BlogPost} />

        {/* Case Studies */}
        <Route path="/case-studies" component={CaseStudies} />
        <Route path="/case-studies/:slug" component={CaseStudyDetail} />

        {/* Proposals */}
        <Route path="/proposal/:token" component={ProposalView} />

        {/* Legacy redirects */}
        <Redirect from="/products-and-services" to="/services" />

        {/* 404 Fallback (must be last) */}
        <Route component={NotFound} />
      </Switch>
      <ExitIntentPopup />
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Switch>
            <Route path="/admin" component={Admin} />
            <Route>
              <PublicRouter />
            </Route>
          </Switch>
        </WouterRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
