import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  HEADCOUNT_OPTIONS, LOCATIONS_OPTIONS, WORKSTATION_OPTIONS, SERVER_OPTIONS,
  CLOUD_PLATFORM_OPTIONS, EXISTING_IT_OPTIONS,
  PAIN_POINT_OPTIONS, COMPLIANCE_OPTIONS,
  PRIORITY_OPTIONS, BUDGET_OPTIONS, TIMELINE_OPTIONS,
  MFA_OPTIONS, LAST_ASSESSMENT_OPTIONS, CYBER_INSURANCE_OPTIONS,
  HOURS_OPTIONS, AFTER_HOURS_OPTIONS, TICKET_VOLUME_OPTIONS,
  INTERNET_SPEED_OPTIONS, INTERNET_REDUNDANCY_OPTIONS, FIREWALL_OPTIONS, WIFI_OPTIONS,
  PHONE_SYSTEM_OPTIONS, PHONE_USERS_OPTIONS, CONTACT_CENTER_OPTIONS,
  EMAIL_SECURITY_OPTIONS, MDR_COVERAGE_OPTIONS, SECURITY_TRAINING_OPTIONS,
  HARDWARE_AGE_OPTIONS, MDM_OPTIONS, PHYSICAL_SECURITY_OPTIONS,
  CONSUMER_DEVICE_COUNT_OPTIONS, CONSUMER_HOME_NETWORK_OPTIONS,
  CONSUMER_HOME_ALARM_OPTIONS, CONSUMER_SMART_HOME_OPTIONS,
  CONSUMER_ANTIVIRUS_OPTIONS, CONSUMER_IDENTITY_PROTECTION_OPTIONS,
  CONSUMER_PAIN_POINT_OPTIONS, CONSUMER_PRIORITY_OPTIONS, CONSUMER_BUDGET_OPTIONS,
} from "@workspace/db/questionnaire";
import {
  SERVICE_LEVELS, CLIENT_RESPONSIBILITIES, ASSUMPTIONS,
  CONFIDENTIALITY_TEXT, TERMS_TEXT, ACCEPTANCE_TEXT,
  investmentSummaryText, validityNotice,
  CONSUMER_SERVICE_LEVELS, CONSUMER_CLIENT_RESPONSIBILITIES, CONSUMER_ASSUMPTIONS,
  consumerInvestmentSummaryText,
} from "@workspace/db/boilerplate";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, FileText, Clock, CheckCircle, XCircle, Mail, Phone, Eye,
  Download, ChevronLeft, Send, Edit2, RefreshCw, Trash2, X,
  Loader, AlertCircle,
  ChevronDown, ChevronUp, RotateCcw, CalendarClock, Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlanContent {
  executiveSummary: string;
  currentEnvironment: string;
  keyFindings: string[];
  recommendedServices: { service: string; description: string; vendor?: string; product?: string }[];
  recommendedProducts?: { vendor: string; product: string; category: string; rationale: string }[];
  nextSteps: string[];
}

interface WrittenPlan {
  id: number;
  planNumber: string;
  version: number;
  parentPlanId: number | null;
  clientName: string;
  clientEmail: string;
  clientTitle: string | null;
  clientCompany: string;
  clientPhone: string | null;
  questionnaireAnswers: WizardAnswers;
  planContent: PlanContent;
  planType: string;
  status: string;
  reviewToken: string | null;
  expiresAt: string | null;
  validityDays: number;
  personalNote: string | null;
  sentAt: string | null;
  viewedAt: string | null;
  approvedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
  signatureImage: string | null;
  declineReason: string | null;
  declineNote: string | null;
  createdAt: string;
  updatedAt: string;
}

type EventMetadata = Record<string, string | number | boolean | null | undefined>;

interface ActivityEvent {
  id: number;
  planId: number;
  eventType: string;
  metadata: EventMetadata;
  createdAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE = "/api/partner/plans";

function authHeader() {
  const t = localStorage.getItem("partner_token");
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  draft:          { label: "Draft",          color: "text-muted-foreground", bg: "bg-muted",          icon: <FileText className="w-3 h-3" /> },
  sent:           { label: "Sent",           color: "text-blue-600",         bg: "bg-blue-50",        icon: <Mail className="w-3 h-3" /> },
  viewed:         { label: "Viewed",         color: "text-purple-600",       bg: "bg-purple-50",      icon: <Eye className="w-3 h-3" /> },
  approved:       { label: "Approved",       color: "text-green-600",        bg: "bg-green-50",       icon: <CheckCircle className="w-3 h-3" /> },
  declined:       { label: "Declined",       color: "text-red-600",          bg: "bg-red-50",         icon: <XCircle className="w-3 h-3" /> },
  call_requested: { label: "Call Requested", color: "text-orange-600",       bg: "bg-orange-50",      icon: <Phone className="w-3 h-3" /> },
};


// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium", cfg.color, cfg.bg)}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Wizard Steps ─────────────────────────────────────────────────────────────

const WIZARD_STEPS = [
  { id: 1, label: "Client Info" },
  { id: 2, label: "Business" },
  { id: 3, label: "Network" },
  { id: 4, label: "Comms" },
  { id: 5, label: "Security" },
  { id: 6, label: "Support" },
  { id: 7, label: "Pain Points" },
  { id: 8, label: "Review" },
  { id: 9, label: "Send" },
];

const REVIEW_STEP = 8;
const SEND_STEP = 9;
const LAST_INPUT_STEP = 7;

const CONSUMER_WIZARD_STEPS = [
  { id: 1, label: "Client Info" },
  { id: 2, label: "Home Setup" },
  { id: 3, label: "Security" },
  { id: 4, label: "Priorities" },
  { id: 5, label: "Review" },
  { id: 6, label: "Send" },
];

const CONSUMER_REVIEW_STEP = 5;
const CONSUMER_SEND_STEP = 6;
const CONSUMER_LAST_INPUT_STEP = 4;

interface WizardAnswers {
  clientName: string;
  clientEmail: string;
  clientTitle: string;
  clientCompany: string;
  clientPhone: string;
  // Business
  headcount: string;
  locations: string;
  workstations: string;
  servers: string;
  cloudPlatforms: string[];
  existingItSupport: string;
  currentItSetup: string;
  currentVendors: string;
  specialtySoftware: string;
  // Connectivity & Network
  internetSpeed: string;
  internetRedundancy: string;
  firewallInUse: string;
  wifiInfrastructure: string;
  // Communications
  phoneSystem: string;
  phoneUsers: string;
  contactCenterNeeds: string;
  // Security & Compliance
  mfaStatus: string;
  endpointProtection: string;
  emailSecurity: string;
  mdrCoverage: string;
  securityAwarenessTraining: string;
  backupSolution: string;
  lastAssessment: string;
  cyberInsurance: string;
  complianceNeeds: string[];
  // Support & Operations
  hoursOfOperation: string;
  afterHoursSupport: string;
  ticketVolume: string;
  hardwareAge: string;
  mdmInUse: string;
  physicalSecurity: string[];
  growthHeadcount: string;
  plannedProjects: string;
  // Pain Points & Priorities
  painPoints: string[];
  priorities: string[];
  budgetRange: string;
  preferredTimeline: string;
  additionalContext: string;
  // Consumer-specific
  numDevices: string;
  internetProvider: string;
  homeNetworkQuality: string;
  smartHomeDevices: string[];
  consumerAntivirus: string;
  homeAlarmSystem: string;
  identityProtection: string;
  currentSecurityTools: string;
  consumerPainPoints: string[];
  consumerPriorities: string[];
}

const BLANK_ANSWERS: WizardAnswers = {
  clientName: "", clientEmail: "", clientTitle: "", clientCompany: "", clientPhone: "",
  headcount: "", locations: "", workstations: "", servers: "",
  cloudPlatforms: [], existingItSupport: "",
  currentItSetup: "", currentVendors: "", specialtySoftware: "",
  internetSpeed: "", internetRedundancy: "", firewallInUse: "", wifiInfrastructure: "",
  phoneSystem: "", phoneUsers: "", contactCenterNeeds: "",
  mfaStatus: "", endpointProtection: "", emailSecurity: "", mdrCoverage: "",
  securityAwarenessTraining: "", backupSolution: "",
  lastAssessment: "", cyberInsurance: "", complianceNeeds: [],
  hoursOfOperation: "", afterHoursSupport: "", ticketVolume: "",
  hardwareAge: "", mdmInUse: "", physicalSecurity: [],
  growthHeadcount: "", plannedProjects: "",
  painPoints: [], priorities: [],
  budgetRange: "", preferredTimeline: "", additionalContext: "",
  numDevices: "", internetProvider: "", homeNetworkQuality: "",
  smartHomeDevices: [], consumerAntivirus: "", homeAlarmSystem: "",
  identityProtection: "", currentSecurityTools: "",
  consumerPainPoints: [], consumerPriorities: [],
};

// ─── Multiselect Checkbox ─────────────────────────────────────────────────────

function MultiCheck({ options, value, onChange, columns = 2 }: {
  options: { value: string; label: string }[] | string[];
  value: string[];
  onChange: (v: string[]) => void;
  columns?: number;
}) {
  const items = options.map(o => typeof o === "string" ? { value: o, label: o } : o);
  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v]);
  }
  return (
    <div className={cn("grid gap-2", columns === 2 ? "grid-cols-2" : "grid-cols-1")}>
      {items.map(item => (
        <label key={item.value} className={cn(
          "flex items-center gap-2 px-3 py-2 rounded border cursor-pointer transition-colors text-sm",
          value.includes(item.value) ? "border-[#0176d3] bg-[#0176d3]/5 text-[#032d60]" : "border-border hover:border-muted-foreground"
        )}>
          <input type="checkbox" className="accent-[#0176d3] w-3.5 h-3.5"
            checked={value.includes(item.value)} onChange={() => toggle(item.value)} />
          {item.label}
        </label>
      ))}
    </div>
  );
}

function Select({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: string[]; placeholder: string;
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[#0176d3]">
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── Plan Document View ───────────────────────────────────────────────────────

function PlanDocument({ content, editable, onChange, plan, planType }: {
  content: PlanContent;
  editable?: boolean;
  onChange?: (updated: PlanContent) => void;
  plan?: { questionnaireAnswers?: unknown; validityDays?: number; expiresAt?: string | Date | null };
  planType?: string;
}) {
  const isConsumerPlan = planType === "consumer";
  function updateSection(key: keyof PlanContent, val: PlanContent[typeof key]) {
    if (onChange) onChange({ ...content, [key]: val });
  }

  function EditableText({ value, onSave, multiline }: { value: string; onSave: (v: string) => void; multiline?: boolean }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(value);
    if (!editable) return <p className="text-sm text-gray-700 leading-relaxed">{value}</p>;
    if (editing) return (
      <div className="space-y-1">
        {multiline
          ? <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} className="text-sm" />
          : <Input value={draft} onChange={e => setDraft(e.target.value)} className="text-sm" />}
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => { onSave(draft); setEditing(false); }}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDraft(value); setEditing(false); }}>Cancel</Button>
        </div>
      </div>
    );
    return (
      <div className="group relative">
        <p className="text-sm text-gray-700 leading-relaxed">{value}</p>
        <button onClick={() => setEditing(true)} className="absolute top-0 right-0 p-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded border text-muted-foreground hover:text-foreground">
          <Edit2 className="w-3 h-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">
      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Executive Summary</h3>
        <EditableText value={content.executiveSummary} multiline
          onSave={v => updateSection("executiveSummary", v)} />
      </section>
      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Current Environment</h3>
        <EditableText value={content.currentEnvironment} multiline
          onSave={v => updateSection("currentEnvironment", v)} />
      </section>
      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Key Findings</h3>
        <ul className="space-y-1.5">
          {(content.keyFindings || []).map((f, i) => (
            <li key={i} className="flex gap-2 items-start">
              <span className="text-[#0176d3] mt-0.5">▪</span>
              <EditableText value={f} onSave={v => {
                const updated = [...(content.keyFindings || [])];
                updated[i] = v;
                updateSection("keyFindings", updated);
              }} />
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-3 border-b border-[#e2e8f0] pb-1">Recommended Services</h3>
        <div className="space-y-3">
          {(content.recommendedServices || []).map((s, i) => (
            <div key={i} className="p-3 rounded bg-[#f0f7ff] border border-[#0176d3]/20">
              <EditableText value={s.service} onSave={v => {
                const updated = [...(content.recommendedServices || [])];
                updated[i] = { ...updated[i], service: v };
                updateSection("recommendedServices", updated);
              }} />
              {(s.vendor || s.product) && (
                <p className="text-xs text-[#0176d3] font-medium mt-1">
                  Delivered via: {s.vendor}{s.vendor && s.product ? " — " : ""}{s.product}
                </p>
              )}
              <div className="mt-1">
                <EditableText value={s.description} multiline onSave={v => {
                  const updated = [...(content.recommendedServices || [])];
                  updated[i] = { ...updated[i], description: v };
                  updateSection("recommendedServices", updated);
                }} />
              </div>
            </div>
          ))}
        </div>
      </section>
      {(content.recommendedProducts?.length ?? 0) > 0 && (
        <section>
          <h3 className="font-bold text-[#032d60] text-base mb-3 border-b border-[#e2e8f0] pb-1">Recommended Products</h3>
          <div className="space-y-3">
            {(content.recommendedProducts || []).map((p, i) => (
              <div key={i} className="p-3 rounded bg-[#fff7ed] border border-[#fb923c]/30">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <p className="font-semibold text-[#032d60]">
                    <EditableText value={p.product} onSave={v => {
                      const updated = [...(content.recommendedProducts || [])];
                      updated[i] = { ...updated[i], product: v };
                      updateSection("recommendedProducts", updated);
                    }} />
                  </p>
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">{p.category}</span>
                </div>
                <p className="text-xs text-[#9a3412] font-medium mt-0.5">
                  Vendor: <EditableText value={p.vendor} onSave={v => {
                    const updated = [...(content.recommendedProducts || [])];
                    updated[i] = { ...updated[i], vendor: v };
                    updateSection("recommendedProducts", updated);
                  }} />
                </p>
                <div className="mt-1.5 text-sm text-gray-700">
                  <EditableText value={p.rationale} multiline onSave={v => {
                    const updated = [...(content.recommendedProducts || [])];
                    updated[i] = { ...updated[i], rationale: v };
                    updateSection("recommendedProducts", updated);
                  }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Next Steps</h3>
        <ol className="space-y-1.5">
          {(content.nextSteps || []).map((step, i) => (
            <li key={i} className="flex gap-2 items-start">
              <span className="text-[#0176d3] font-bold shrink-0 w-5">{i + 1}.</span>
              <EditableText value={step} onSave={v => {
                const updated = [...(content.nextSteps || [])];
                updated[i] = v;
                updateSection("nextSteps", updated);
              }} />
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">
          {isConsumerPlan ? "Response Times" : "Service Levels"}
        </h3>
        <div className="space-y-2">
          {(isConsumerPlan ? CONSUMER_SERVICE_LEVELS : SERVICE_LEVELS).map((sl, i) => (
            <div key={i}>
              <p className="text-sm font-semibold text-[#032d60]">{sl.tier}</p>
              <p className="text-xs text-muted-foreground">{sl.target}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">
          {isConsumerPlan ? "Plan Summary" : "Investment Summary"}
        </h3>
        <p className="text-sm text-gray-700 leading-relaxed">
          {isConsumerPlan
            ? consumerInvestmentSummaryText((plan?.questionnaireAnswers as Record<string, unknown>) ?? {})
            : investmentSummaryText((plan?.questionnaireAnswers as Record<string, unknown>) ?? {})}
        </p>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">
          {isConsumerPlan ? "Your Responsibilities" : "Client Responsibilities"}
        </h3>
        <ul className="space-y-1.5">
          {(isConsumerPlan ? CONSUMER_CLIENT_RESPONSIBILITIES : CLIENT_RESPONSIBILITIES).map((r, i) => (
            <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
              <span className="text-[#0176d3] mt-0.5 shrink-0">▪</span> {r}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Assumptions</h3>
        <ul className="space-y-1.5">
          {(isConsumerPlan ? CONSUMER_ASSUMPTIONS : ASSUMPTIONS).map((a, i) => (
            <li key={i} className="flex gap-2 items-start text-sm text-gray-700">
              <span className="text-[#0176d3] mt-0.5 shrink-0">▪</span> {a}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Plan Validity</h3>
        <p className="text-sm text-gray-700 leading-relaxed">
          {validityNotice(plan?.validityDays ?? 30, plan?.expiresAt ?? null)}
        </p>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Confidentiality</h3>
        <p className="text-sm text-gray-700 leading-relaxed">{CONFIDENTIALITY_TEXT}</p>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Terms</h3>
        <p className="text-sm text-gray-700 leading-relaxed">{TERMS_TEXT}</p>
      </section>

      <section>
        <h3 className="font-bold text-[#032d60] text-base mb-2 border-b border-[#e2e8f0] pb-1">Acceptance</h3>
        <p className="text-sm text-gray-700 leading-relaxed">{ACCEPTANCE_TEXT}</p>
      </section>
    </div>
  );
}

// ─── Plan Wizard ──────────────────────────────────────────────────────────────

const DRAFT_STORAGE_KEY = "written_plan_wizard_draft";

// Merge any partial/legacy answers shape with BLANK_ANSWERS so every key exists
// and every array field is actually an array. Protects render & canProceed checks
// against drafts saved under older schemas or server-stored answers from old plans.
function normalizeAnswers(raw: unknown): WizardAnswers {
  const src = (raw && typeof raw === "object") ? raw as Record<string, unknown> : {};
  const out: WizardAnswers = { ...BLANK_ANSWERS };
  for (const key of Object.keys(BLANK_ANSWERS) as (keyof WizardAnswers)[]) {
    const v = src[key];
    const blank = BLANK_ANSWERS[key];
    if (Array.isArray(blank)) {
      (out as Record<string, unknown>)[key] = Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
    } else {
      (out as Record<string, unknown>)[key] = typeof v === "string" ? v : "";
    }
  }
  return out;
}

function loadDraft(): { answers: WizardAnswers; step: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const answers = normalizeAnswers(parsed?.answers);
    const stepRaw = typeof parsed?.step === "number" ? parsed.step : 1;
    // Cap restored step to last input step — schema changed, force user back through
    // any newly-required questions instead of dropping them at Review with empty data.
    const step = Math.min(Math.max(stepRaw, 1), LAST_INPUT_STEP);
    return { answers, step };
  } catch { return null; }
}

function saveDraft(answers: WizardAnswers, step: number) {
  try { localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ answers, step })); } catch { /* quota */ }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* */ }
}

export function PlanWizard({ initial, onComplete, onCancel, onBehalfOfPartnerId }: {
  initial?: { answers: WizardAnswers; planId?: number; planContent?: PlanContent | null; mode?: "revise" | "edit-draft"; planType?: string };
  onComplete: (plan: WrittenPlan) => void;
  onCancel: () => void;
  onBehalfOfPartnerId?: number;
}) {
  const { toast } = useToast();

  // Restore draft on initial mount (only when not editing an existing plan)
  const savedDraft = !initial ? loadDraft() : null;

  const [planType, setPlanType] = useState<"business" | "consumer">(
    (initial?.planType as "business" | "consumer") || "business"
  );
  const isConsumer = planType === "consumer";
  const activeSteps = isConsumer ? CONSUMER_WIZARD_STEPS : WIZARD_STEPS;
  const activeReviewStep = isConsumer ? CONSUMER_REVIEW_STEP : REVIEW_STEP;
  const activeSendStep = isConsumer ? CONSUMER_SEND_STEP : SEND_STEP;
  const activeLastInputStep = isConsumer ? CONSUMER_LAST_INPUT_STEP : LAST_INPUT_STEP;

  // Step 0 = plan type selector; step 1+ = questionnaire
  const [step, setStep] = useState(initial ? (savedDraft?.step || 1) : 0);
  const [answers, setAnswers] = useState<WizardAnswers>(
    initial?.answers ? normalizeAnswers(initial.answers) : (savedDraft?.answers || BLANK_ANSWERS)
  );
  const [planId, setPlanId] = useState<number | undefined>(initial?.planId);
  const [generatedPlan, setGeneratedPlan] = useState<WrittenPlan | null>(null);
  const [editedContent, setEditedContent] = useState<PlanContent | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendEmail, setSendEmail] = useState(answers.clientEmail);
  const [validityDays, setValidityDays] = useState(30);
  const [personalNote, setPersonalNote] = useState("");
  const [draftRestored, setDraftRestored] = useState(!!savedDraft);

  // Auto-save questionnaire answers to localStorage on every change
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (step >= activeReviewStep) return; // Don't auto-save after generation
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveDraft(answers, step), 600);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [answers, step]);

  function upd<K extends keyof WizardAnswers>(k: K, v: WizardAnswers[K]) {
    setAnswers(a => ({ ...a, [k]: v }));
  }

  function handleCancel() {
    clearDraft();
    onCancel();
  }

  async function advanceWithServerDraft() {
    try {
      const effectiveCompany = isConsumer
        ? (answers.clientCompany || "Individual / Residential")
        : answers.clientCompany;
      const body = {
        clientName: answers.clientName,
        clientEmail: answers.clientEmail,
        clientTitle: answers.clientTitle,
        clientCompany: effectiveCompany,
        clientPhone: answers.clientPhone,
        questionnaireAnswers: { ...answers, clientCompany: effectiveCompany },
        planType,
        ...(onBehalfOfPartnerId ? { onBehalfOfPartnerId } : {}),
      };
      if (planId) {
        await fetch(`${BASE}/${planId}`, {
          method: "PUT",
          headers: authHeader(),
          body: JSON.stringify(body),
        });
      } else {
        const res = await fetch(`${BASE}/draft`, {
          method: "POST",
          headers: authHeader(),
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const d = await res.json();
          if (d.plan?.id) { setPlanId(d.plan.id); }
        }
      }
    } catch { /* silent — localStorage backup exists */ }
    setStep(s => s + 1);
  }

  async function generatePlan() {
    setGenerating(true);
    try {
      const effectiveCompany = isConsumer
        ? (answers.clientCompany || "Individual / Residential")
        : answers.clientCompany;
      const clientBody = {
        clientName: answers.clientName,
        clientEmail: answers.clientEmail,
        clientTitle: answers.clientTitle,
        clientCompany: effectiveCompany,
        clientPhone: answers.clientPhone,
        questionnaireAnswers: { ...answers, clientCompany: effectiveCompany },
        planType,
        validityDays,
        ...(onBehalfOfPartnerId ? { onBehalfOfPartnerId } : {}),
      };

      let plan;
      if (planId && initial?.planContent && initial?.mode !== "edit-draft") {
        // Revision mode: plan already has parent's edited content — preserve it.
        // Just update questionnaire answers; no regeneration so edits are not overwritten.
        const putRes = await fetch(`${BASE}/${planId}`, {
          method: "PUT",
          headers: authHeader(),
          body: JSON.stringify(clientBody),
        });
        if (!putRes.ok) throw new Error("Failed");
        const d = await putRes.json();
        plan = d.plan || d;
        // Seed the editor with the inherited parent content so the partner can refine it
        if (!plan.planContent || Object.keys(plan.planContent).length === 0) {
          plan = { ...plan, planContent: initial.planContent };
        }
      } else if (planId) {
        // Draft exists (no parent content): update answers then regenerate content from them
        const putRes = await fetch(`${BASE}/${planId}`, {
          method: "PUT",
          headers: authHeader(),
          body: JSON.stringify(clientBody),
        });
        if (!putRes.ok) throw new Error("Failed");
        const regenRes = await fetch(`${BASE}/${planId}/regenerate`, {
          method: "PUT",
          headers: authHeader(),
          body: JSON.stringify({}),
        });
        if (!regenRes.ok) throw new Error("Failed");
        const d = await regenRes.json();
        plan = d.plan || d;
      } else {
        // New plan: POST validates questionnaire and generates content in one step
        const res = await fetch(BASE, {
          method: "POST",
          headers: authHeader(),
          body: JSON.stringify(clientBody),
        });
        if (!res.ok) throw new Error("Failed");
        const d = await res.json();
        plan = d.plan || d;
      }

      setPlanId(plan.id);
      setGeneratedPlan(plan);
      setEditedContent(plan.planContent);
      setSendEmail(answers.clientEmail);
      setStep(activeReviewStep);
    } catch {
      toast({ title: "Failed to generate plan", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function saveEdits() {
    if (!planId || !editedContent) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/${planId}`, {
        method: "PUT",
        headers: authHeader(),
        body: JSON.stringify({ planContent: editedContent }),
      });
      toast({ title: "Plan saved" });
    } catch {
      toast({ title: "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function sendPlan() {
    if (!planId) return;
    setSending(true);
    try {
      if (editedContent) {
        await fetch(`${BASE}/${planId}`, {
          method: "PUT",
          headers: authHeader(),
          body: JSON.stringify({ planContent: editedContent }),
        });
      }
      const res = await fetch(`${BASE}/${planId}/send`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ personalNote, validityDays, clientEmail: sendEmail }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = d?.message || "Failed to send the plan. Please try again.";
        toast({ title: "Send failed", description: reason, variant: "destructive" });
        return;
      }
      toast({ title: "Plan sent to client!" });
      clearDraft();
      onComplete(d.plan);
    } catch {
      toast({ title: "Send failed", description: "An unexpected error occurred. Please try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  }

  const canProceed: Record<number, boolean> = isConsumer ? {
    1: !!(answers.clientName && answers.clientEmail),
    2: true, // Home Setup — all optional
    3: true, // Security — all optional
    4: answers.consumerPainPoints.length > 0,
    5: !!generatedPlan,
    6: !!(sendEmail),
  } : {
    1: !!(answers.clientName && answers.clientEmail && answers.clientCompany),
    2: !!(answers.headcount && answers.locations && answers.workstations && answers.servers && answers.cloudPlatforms.length > 0 && answers.existingItSupport),
    3: true, // Network — all optional
    4: true, // Comms — all optional
    5: !!(answers.mfaStatus && answers.lastAssessment && answers.cyberInsurance && answers.complianceNeeds.length > 0),
    6: !!(answers.hoursOfOperation && answers.afterHoursSupport),
    7: answers.painPoints.length > 0,
    8: !!generatedPlan,
    9: !!(sendEmail),
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Progress Bar — hidden on plan type selector (step 0) */}
      {step > 0 && (
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {activeSteps.map(s => (
              <div key={s.id} className="flex-1 text-center">
                <div className={cn("w-8 h-8 rounded-full mx-auto flex items-center justify-center text-sm font-bold mb-1 transition-colors",
                  step === s.id ? "bg-[#032d60] text-white" :
                  step > s.id ? "bg-[#0176d3] text-white" : "bg-muted text-muted-foreground")}>
                  {step > s.id ? "✓" : s.id}
                </div>
                <p className={cn("text-xs hidden sm:block", step === s.id ? "text-[#032d60] font-medium" : "text-muted-foreground")}>{s.label}</p>
              </div>
            ))}
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 mt-2">
            <div className="bg-[#0176d3] h-1.5 rounded-full transition-all" style={{ width: `${((step - 1) / (activeSteps.length - 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {draftRestored && step < activeReviewStep && (
        <div className="mb-4 flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-blue-50 border border-blue-200 text-sm text-blue-800">
          <span className="flex items-center gap-2"><RotateCcw className="w-3.5 h-3.5" /> Draft restored from your last session.</span>
          <button onClick={() => { clearDraft(); setAnswers(BLANK_ANSWERS); setStep(1); setDraftRestored(false); }}
            className="text-xs underline hover:no-underline text-blue-600 shrink-0">Start fresh</button>
        </div>
      )}

      <Card className="p-6">
        {/* Step 0: Plan Type Selection */}
        {step === 0 && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-bold text-[#032d60]">Who is this plan for?</h2>
              <p className="text-sm text-muted-foreground mt-1">Choose the type of plan to create. Each type uses a different questionnaire tailored to the client.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => { setPlanType("business"); setStep(1); }}
                className={cn(
                  "flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:border-[#0176d3] hover:bg-[#f0f7ff]",
                  planType === "business" ? "border-[#0176d3] bg-[#f0f7ff]" : "border-border bg-card"
                )}
              >
                <div className="w-10 h-10 rounded-lg bg-[#032d60] flex items-center justify-center">
                  <Users className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-[#032d60]">Business / SMB</p>
                  <p className="text-xs text-muted-foreground mt-0.5">For businesses of any size. Covers IT infrastructure, security, compliance, and managed services.</p>
                </div>
              </button>
              <button
                onClick={() => { setPlanType("consumer"); setStep(1); }}
                className={cn(
                  "flex flex-col items-start gap-3 p-5 rounded-xl border-2 text-left transition-all hover:border-[#0176d3] hover:bg-[#f0f7ff]",
                  planType === "consumer" ? "border-[#0176d3] bg-[#f0f7ff]" : "border-border bg-card"
                )}
              >
                <div className="w-10 h-10 rounded-lg bg-[#0176d3] flex items-center justify-center">
                  <FileText className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-[#032d60]">Individual / Consumer</p>
                  <p className="text-xs text-muted-foreground mt-0.5">For residential clients. Covers home internet, personal security, smart home, and tech support.</p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Client Info */}
        {step === 1 && !isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Client Information <span className="text-xs font-normal text-muted-foreground ml-1">(Required)</span></h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Contact Name *</Label>
                <Input value={answers.clientName} onChange={e => upd("clientName", e.target.value)} placeholder="John Smith" />
              </div>
              <div>
                <Label className="text-xs">Title / Role</Label>
                <Input value={answers.clientTitle} onChange={e => upd("clientTitle", e.target.value)} placeholder="IT Manager" />
              </div>
              <div>
                <Label className="text-xs">Company Name *</Label>
                <Input value={answers.clientCompany} onChange={e => upd("clientCompany", e.target.value)} placeholder="Acme Corp" />
              </div>
              <div>
                <Label className="text-xs">Email Address *</Label>
                <Input type="email" value={answers.clientEmail} onChange={e => upd("clientEmail", e.target.value)} placeholder="john@acmecorp.com" />
              </div>
              <div>
                <Label className="text-xs">Phone Number</Label>
                <Input value={answers.clientPhone} onChange={e => upd("clientPhone", e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
            </div>
          </div>
        )}

        {/* Consumer Step 1: Client Info */}
        {step === 1 && isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Client Information <span className="text-xs font-normal text-muted-foreground ml-1">(Required)</span></h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 sm:col-span-1">
                <Label className="text-xs">Full Name *</Label>
                <Input value={answers.clientName} onChange={e => upd("clientName", e.target.value)} placeholder="Jane Smith" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label className="text-xs">Email Address *</Label>
                <Input type="email" value={answers.clientEmail} onChange={e => upd("clientEmail", e.target.value)} placeholder="jane@example.com" />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <Label className="text-xs">Phone Number</Label>
                <Input value={answers.clientPhone} onChange={e => upd("clientPhone", e.target.value)} placeholder="+1 (555) 000-0000" />
              </div>
            </div>
          </div>
        )}

        {/* Consumer Step 2: Home Setup */}
        {step === 2 && isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Home Setup</h2>
            <p className="text-xs text-muted-foreground">All optional — fill in what you know to get more relevant recommendations.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Number of Devices at Home</Label>
                <Select value={answers.numDevices} onChange={v => upd("numDevices", v)} options={CONSUMER_DEVICE_COUNT_OPTIONS} placeholder="Select" />
                <p className="text-[11px] text-muted-foreground mt-1">Phones, tablets, computers, smart TVs, etc.</p>
              </div>
              <div>
                <Label className="text-xs">Home Internet Speed</Label>
                <Select value={answers.internetSpeed} onChange={v => upd("internetSpeed", v)} options={INTERNET_SPEED_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Overall Network Quality</Label>
                <Select value={answers.homeNetworkQuality} onChange={v => upd("homeNetworkQuality", v)} options={CONSUMER_HOME_NETWORK_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Current Internet Provider</Label>
                <Input value={answers.internetProvider} onChange={e => upd("internetProvider", e.target.value)} placeholder="e.g., Comcast, AT&T, Spectrum" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Smart Home Devices in Use <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              <MultiCheck options={CONSUMER_SMART_HOME_OPTIONS} value={answers.smartHomeDevices} onChange={v => upd("smartHomeDevices", v)} />
            </div>
          </div>
        )}

        {/* Consumer Step 3: Security & Protection */}
        {step === 3 && isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Security & Protection</h2>
            <p className="text-xs text-muted-foreground">Help us understand the client's current security posture.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Antivirus / Security Software</Label>
                <Select value={answers.consumerAntivirus} onChange={v => upd("consumerAntivirus", v)} options={CONSUMER_ANTIVIRUS_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Home Alarm / Security System</Label>
                <Select value={answers.homeAlarmSystem} onChange={v => upd("homeAlarmSystem", v)} options={CONSUMER_HOME_ALARM_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Identity Protection Service</Label>
                <Select value={answers.identityProtection} onChange={v => upd("identityProtection", v)} options={CONSUMER_IDENTITY_PROTECTION_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Other Security Tools</Label>
                <Input value={answers.currentSecurityTools} onChange={e => upd("currentSecurityTools", e.target.value)} placeholder="e.g., 1Password, NordVPN, Ring, SimpliSafe" />
              </div>
            </div>
          </div>
        )}

        {/* Consumer Step 4: Pain Points & Priorities */}
        {step === 4 && isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Needs & Priorities</h2>
            <div>
              <Label className="text-xs mb-2 block">Main Pain Points * <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              <MultiCheck
                options={CONSUMER_PAIN_POINT_OPTIONS}
                value={answers.consumerPainPoints}
                onChange={v => upd("consumerPainPoints", v)}
              />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Top Priorities <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              <MultiCheck options={CONSUMER_PRIORITY_OPTIONS} value={answers.consumerPriorities} onChange={v => upd("consumerPriorities", v)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Monthly Budget</Label>
                <Select value={answers.budgetRange} onChange={v => upd("budgetRange", v)} options={CONSUMER_BUDGET_OPTIONS} placeholder="Select range" />
              </div>
              <div>
                <Label className="text-xs">Preferred Timeline</Label>
                <Select value={answers.preferredTimeline} onChange={v => upd("preferredTimeline", v)} options={TIMELINE_OPTIONS} placeholder="Select timeline" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Anything Else? <span className="text-muted-foreground">(optional)</span></Label>
              <Textarea value={answers.additionalContext} onChange={e => upd("additionalContext", e.target.value)}
                placeholder="Any extra details about the client's home setup or goals" rows={2} />
            </div>
          </div>
        )}

        {/* Step 2: Business Details */}
        {step === 2 && !isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Business & Environment</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Headcount *</Label>
                <Select value={answers.headcount} onChange={v => upd("headcount", v)} options={HEADCOUNT_OPTIONS} placeholder="Select employee count" />
              </div>
              <div>
                <Label className="text-xs">Number of Locations *</Label>
                <Select value={answers.locations} onChange={v => upd("locations", v)} options={LOCATIONS_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Workstations / Laptops *</Label>
                <Select value={answers.workstations} onChange={v => upd("workstations", v)} options={WORKSTATION_OPTIONS} placeholder="Select count" />
              </div>
              <div>
                <Label className="text-xs">On-prem Servers *</Label>
                <Select value={answers.servers} onChange={v => upd("servers", v)} options={SERVER_OPTIONS} placeholder="Select count" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Cloud Platforms in Use * <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              <MultiCheck options={CLOUD_PLATFORM_OPTIONS} value={answers.cloudPlatforms} onChange={v => upd("cloudPlatforms", v)} />
            </div>
            <div>
              <Label className="text-xs">Existing IT Support *</Label>
              <Select value={answers.existingItSupport} onChange={v => upd("existingItSupport", v)} options={EXISTING_IT_OPTIONS} placeholder="Select" />
            </div>
            <div>
              <Label className="text-xs">Additional Environment Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={answers.currentItSetup} onChange={e => upd("currentItSetup", e.target.value)}
                placeholder="Anything specific about the network, key apps, custom setups, etc." rows={2} />
            </div>
            <div>
              <Label className="text-xs">Current Vendors / Tools <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={answers.currentVendors} onChange={e => upd("currentVendors", e.target.value)}
                placeholder="e.g., Microsoft 365, Cisco Meraki, AWS" />
            </div>
            <div>
              <Label className="text-xs">Industry / Specialty Software <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={answers.specialtySoftware} onChange={e => upd("specialtySoftware", e.target.value)}
                placeholder="e.g., Epic / Cerner (EHR), Clio (legal), QuickBooks, Toast POS, AutoCAD" />
              <p className="text-[11px] text-muted-foreground mt-1">Line-of-business apps that are critical to operations.</p>
            </div>
          </div>
        )}

        {/* Step 3: Connectivity & Network */}
        {step === 3 && !isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Connectivity & Network</h2>
            <p className="text-xs text-muted-foreground">All optional — fill in what you know to get sharper recommendations.</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Primary Internet Speed</Label>
                <Select value={answers.internetSpeed} onChange={v => upd("internetSpeed", v)} options={INTERNET_SPEED_OPTIONS} placeholder="Select" />
                <p className="text-[11px] text-muted-foreground mt-1">Approximate bandwidth at the main location.</p>
              </div>
              <div>
                <Label className="text-xs">Internet Redundancy / Failover</Label>
                <Select value={answers.internetRedundancy} onChange={v => upd("internetRedundancy", v)} options={INTERNET_REDUNDANCY_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Firewall / Network Security</Label>
                <Select value={answers.firewallInUse} onChange={v => upd("firewallInUse", v)} options={FIREWALL_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">WiFi Infrastructure</Label>
                <Select value={answers.wifiInfrastructure} onChange={v => upd("wifiInfrastructure", v)} options={WIFI_OPTIONS} placeholder="Select" />
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Communications */}
        {step === 4 && !isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Communications</h2>
            <p className="text-xs text-muted-foreground">Phone, voice, and contact-center signals (all optional).</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Current Phone System</Label>
                <Select value={answers.phoneSystem} onChange={v => upd("phoneSystem", v)} options={PHONE_SYSTEM_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Number of Phone Users</Label>
                <Select value={answers.phoneUsers} onChange={v => upd("phoneUsers", v)} options={PHONE_USERS_OPTIONS} placeholder="Select" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Contact Center / Call Routing</Label>
                <Select value={answers.contactCenterNeeds} onChange={v => upd("contactCenterNeeds", v)} options={CONTACT_CENTER_OPTIONS} placeholder="Select" />
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Security & Compliance Posture */}
        {step === 5 && !isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Security & Compliance Posture</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Multi-Factor Authentication *</Label>
                <Select value={answers.mfaStatus} onChange={v => upd("mfaStatus", v)} options={MFA_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Last Security Assessment *</Label>
                <Select value={answers.lastAssessment} onChange={v => upd("lastAssessment", v)} options={LAST_ASSESSMENT_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Endpoint Protection in Use <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={answers.endpointProtection} onChange={e => upd("endpointProtection", e.target.value)}
                  placeholder="e.g., Defender, SentinelOne, none" />
              </div>
              <div>
                <Label className="text-xs">Email Security in Place <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.emailSecurity} onChange={v => upd("emailSecurity", v)} options={EMAIL_SECURITY_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">MDR / SOC Monitoring <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.mdrCoverage} onChange={v => upd("mdrCoverage", v)} options={MDR_COVERAGE_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Security Awareness Training <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.securityAwarenessTraining} onChange={v => upd("securityAwarenessTraining", v)} options={SECURITY_TRAINING_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Backup Solution in Use <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={answers.backupSolution} onChange={e => upd("backupSolution", e.target.value)}
                  placeholder="e.g., Veeam, Datto, none" />
              </div>
              <div>
                <Label className="text-xs">Cyber Insurance *</Label>
                <Select value={answers.cyberInsurance} onChange={v => upd("cyberInsurance", v)} options={CYBER_INSURANCE_OPTIONS} placeholder="Select" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Compliance Requirements * <span className="text-muted-foreground font-normal">(select 'None / Not applicable' if there are no obligations)</span></Label>
              <MultiCheck options={COMPLIANCE_OPTIONS} value={answers.complianceNeeds} onChange={v => upd("complianceNeeds", v)} />
            </div>
          </div>
        )}

        {/* Step 6: Support & Operations */}
        {step === 6 && !isConsumer && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-[#032d60]">Support & Operations</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Hours of Operation *</Label>
                <Select value={answers.hoursOfOperation} onChange={v => upd("hoursOfOperation", v)} options={HOURS_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">After-hours Support Needed *</Label>
                <Select value={answers.afterHoursSupport} onChange={v => upd("afterHoursSupport", v)} options={AFTER_HOURS_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Estimated Monthly Tickets <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.ticketVolume} onChange={v => upd("ticketVolume", v)} options={TICKET_VOLUME_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Hardware Age / Refresh Status <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.hardwareAge} onChange={v => upd("hardwareAge", v)} options={HARDWARE_AGE_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Mobile Device Management (MDM) <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.mdmInUse} onChange={v => upd("mdmInUse", v)} options={MDM_OPTIONS} placeholder="Select" />
              </div>
              <div>
                <Label className="text-xs">Expected Headcount in 12 Months <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input value={answers.growthHeadcount} onChange={e => upd("growthHeadcount", e.target.value)}
                  placeholder="e.g., 75" />
              </div>
            </div>
            <div>
              <Label className="text-xs mb-2 block">Physical Security in Place <span className="text-muted-foreground font-normal">(optional, select all that apply)</span></Label>
              <MultiCheck options={PHYSICAL_SECURITY_OPTIONS} value={answers.physicalSecurity} onChange={v => upd("physicalSecurity", v)} />
            </div>
            <div>
              <Label className="text-xs">Major IT Projects in Next 12 Months <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={answers.plannedProjects} onChange={e => upd("plannedProjects", e.target.value)}
                placeholder="e.g., office relocation, M365 migration, ERP rollout" rows={2} />
            </div>
          </div>
        )}

        {/* Step 7: Pain Points & Priorities */}
        {step === 7 && !isConsumer && (
          <div className="space-y-5">
            <h2 className="text-lg font-bold text-[#032d60]">Pain Points & Priorities</h2>
            <div>
              <Label className="text-xs mb-2 block">Primary Pain Points * <span className="text-muted-foreground font-normal">(select all that apply)</span></Label>
              <MultiCheck options={PAIN_POINT_OPTIONS} value={answers.painPoints} onChange={v => upd("painPoints", v)} />
            </div>
            <div>
              <Label className="text-xs mb-2 block">Top Priorities <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <MultiCheck options={PRIORITY_OPTIONS} value={answers.priorities} onChange={v => upd("priorities", v)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Budget Range <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.budgetRange} onChange={v => upd("budgetRange", v)} options={BUDGET_OPTIONS} placeholder="Select range" />
              </div>
              <div>
                <Label className="text-xs">Preferred Timeline <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Select value={answers.preferredTimeline} onChange={v => upd("preferredTimeline", v)} options={TIMELINE_OPTIONS} placeholder="Select timeline" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Additional Context <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={answers.additionalContext} onChange={e => upd("additionalContext", e.target.value)}
                placeholder="Any other relevant information about the client's situation or goals" rows={3} />
            </div>
          </div>
        )}

        {/* Review & Generate */}
        {step === activeReviewStep && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#032d60]">Review & Generate Plan</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={generatePlan} disabled={generating} className="gap-1.5">
                  <RefreshCw className={cn("w-3.5 h-3.5", generating && "animate-spin")} /> Regenerate
                </Button>
                {editedContent && (
                  <Button variant="outline" size="sm" onClick={saveEdits} disabled={saving} className="gap-1.5">
                    {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Edit2 className="w-3.5 h-3.5" />} Save Edits
                  </Button>
                )}
              </div>
            </div>

            {!generatedPlan ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <p className="text-muted-foreground text-sm">Click below to generate the written plan from your answers</p>
                <Button onClick={generatePlan} disabled={generating} className="bg-[#032d60] hover:bg-[#0176d3] text-white gap-2">
                  {generating ? <Loader className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Generate Written Plan
                </Button>
              </div>
            ) : (
              <div className="border rounded-lg p-5 bg-white shadow-sm">
                <div className="flex items-center gap-3 mb-5 pb-4 border-b">
                  <div>
                    <p className="font-bold text-[#032d60] text-base">{generatedPlan.clientCompany}</p>
                    <p className="text-sm text-muted-foreground">{generatedPlan.planNumber} · Version {generatedPlan.version}</p>
                  </div>
                </div>
                {editedContent && <PlanDocument content={editedContent} editable onChange={setEditedContent} plan={generatedPlan} planType={planType} />}
              </div>
            )}
          </div>
        )}

        {/* Send */}
        {step === activeSendStep && (
          <div className="space-y-5">
            <h2 className="text-lg font-bold text-[#032d60]">Send to Client</h2>
            <div>
              <Label className="text-xs">Client Email *</Label>
              <Input type="email" value={sendEmail} onChange={e => setSendEmail(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Validity Period</Label>
              <Select value={String(validityDays)} onChange={v => setValidityDays(Number(v))}
                options={["7", "14", "30", "60", "90"]}
                placeholder="30 days" />
              <p className="text-xs text-muted-foreground mt-1">Client has until {format(new Date(Date.now() + validityDays * 86400000), "MMMM d, yyyy")} to sign</p>
            </div>
            <div>
              <Label className="text-xs">Personal Note <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea value={personalNote} onChange={e => setPersonalNote(e.target.value)}
                placeholder="Add a personal message to include with the plan email..." rows={3} />
            </div>
            <div className="bg-[#f0f7ff] rounded-lg p-4 border border-[#0176d3]/20">
              <p className="text-xs font-semibold text-[#032d60] mb-1">What happens next?</p>
              <ul className="text-xs text-gray-600 space-y-1">
                <li>• Client receives a branded email with a secure review link</li>
                <li>• They can sign, request a call, or decline — no login required</li>
                <li>• You'll be notified by email when they take action</li>
                <li>• A reminder is sent automatically if unsigned within 3 days of expiry</li>
              </ul>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-5 border-t">
          <div className="flex gap-2">
            <Button variant="outline" onClick={step <= 1 ? handleCancel : () => setStep(s => s - 1)}>
              {step <= 1 ? "Cancel" : <><ChevronLeft className="w-4 h-4 mr-1" /> Back</>}
            </Button>
          </div>
          <div className="flex gap-2">
            {step > 0 && step < activeReviewStep && (
              <Button
                onClick={() => step === activeLastInputStep ? generatePlan() : advanceWithServerDraft()}
                disabled={!canProceed[step] || generating}
                className="bg-[#032d60] hover:bg-[#0176d3] text-white gap-1.5">
                {step === activeLastInputStep ? (generating ? <><Loader className="w-4 h-4 animate-spin" /> Generating…</> : "Generate Plan →") : "Next →"}
              </Button>
            )}
            {step === activeReviewStep && generatedPlan && (
              <Button onClick={() => setStep(activeSendStep)} className="bg-[#032d60] hover:bg-[#0176d3] text-white gap-1.5">
                <Send className="w-4 h-4" /> Proceed to Send
              </Button>
            )}
            {step === activeSendStep && (
              <Button onClick={sendPlan} disabled={sending || !sendEmail}
                className="bg-[#0176d3] hover:bg-[#015fa3] text-white gap-1.5">
                {sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {sending ? "Sending…" : "Send to Client"}
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ─── Plan Detail View ─────────────────────────────────────────────────────────

function PlanDetail({ planId, onBack, onRevise, onEditAnswers }: {
  planId: number;
  onBack: () => void;
  onRevise: (plan: WrittenPlan) => void;
  onEditAnswers: (plan: WrittenPlan) => void;
}) {
  const { toast } = useToast();
  const [data, setData] = useState<{ plan: WrittenPlan; events: ActivityEvent[]; revisions: WrittenPlan[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editedContent, setEditedContent] = useState<PlanContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [sendingReminder, setSendingReminder] = useState(false);
  const [resending, setResending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const [extendDays, setExtendDays] = useState<7 | 14 | 30 | 60>(14);
  const [extending, setExtending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/${planId}`, { headers: authHeader() });
      if (r.ok) {
        const d = await r.json();
        setData(d);
        setEditedContent(d.plan.planContent);
      }
    } finally { setLoading(false); }
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-20"><Loader className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <div className="text-center py-20 text-muted-foreground">Plan not found.</div>;

  const { plan, events, revisions } = data;

  async function handleSaveEdits() {
    if (!editedContent) return;
    setSaving(true);
    try {
      await fetch(`${BASE}/${plan.id}`, {
        method: "PUT",
        headers: authHeader(),
        body: JSON.stringify({ planContent: editedContent }),
      });
      toast({ title: "Plan saved" });
    } catch { toast({ title: "Save failed", variant: "destructive" }); }
    finally { setSaving(false); }
  }

  async function handleExtend() {
    setExtending(true);
    try {
      const res = await fetch(`${BASE}/${plan.id}/extend`, {
        method: "PUT",
        headers: authHeader(),
        body: JSON.stringify({ validityDays: extendDays }),
      });
      if (!res.ok) throw new Error("Failed");
      toast({ title: `Deadline extended by ${extendDays} days` });
      setExtendOpen(false);
      load();
    } catch { toast({ title: "Extension failed", variant: "destructive" }); }
    finally { setExtending(false); }
  }

  async function handleResend() {
    setResending(true);
    try {
      const res = await fetch(`${BASE}/${plan.id}/send`, {
        method: "POST",
        headers: authHeader(),
        body: JSON.stringify({ clientEmail: plan.clientEmail, validityDays: plan.validityDays }),
      });
      const body = await res.json().catch(() => ({} as { message?: string; reason?: string; error?: string }));
      if (!res.ok) {
        const description = body?.message
          || (body?.reason ? `Reason: ${body.reason}` : undefined)
          || (body?.error ? `Error: ${body.error}` : undefined)
          || `Server returned HTTP ${res.status}.`;
        toast({ title: "Resend failed", description, variant: "destructive" });
        return;
      }
      toast({ title: "Plan resent to client", description: `Sent to ${plan.clientEmail}` });
      load();
    } catch (err) {
      toast({
        title: "Resend failed",
        description: err instanceof Error ? `Network error: ${err.message}` : "Network error reaching the server.",
        variant: "destructive",
      });
    }
    finally { setResending(false); }
  }

  const EVENT_LABELS: Record<string, string> = {
    created: "Plan created", sent: "Sent to client", viewed: "Client viewed plan",
    approved: "Plan approved & signed", declined: "Client declined", call_requested: "Client requested a call",
    revised: "New revision created", reminder_sent: "Expiry reminder sent",
    extended: "Deadline extended", send_failed: "Email delivery failed",
  };

  const canResend = ["draft", "viewed", "sent"].includes(plan.status);
  const canRevise = ["declined", "approved", "call_requested"].includes(plan.status);
  const canExtend = ["sent", "viewed"].includes(plan.status);
  const isEditable = plan.status === "draft";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> All Plans</Button>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#032d60]">{plan.clientCompany}</h1>
          <p className="text-muted-foreground text-sm">{plan.planNumber} · v{plan.version} · <StatusBadge status={plan.status} /></p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={async () => {
              const t = localStorage.getItem("partner_token");
              const res = await fetch(`/api/partner/plans/${plan.id}/pdf`, {
                headers: t ? { Authorization: `Bearer ${t}` } : {},
              });
              if (!res.ok) return;
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `plan-${plan.planNumber}.pdf`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </Button>
          {isEditable && (
            <Button variant="outline" size="sm" onClick={() => onEditAnswers(plan)} className="gap-1.5">
              <Edit2 className="w-3.5 h-3.5" /> Edit Answers
            </Button>
          )}
          {isEditable && (
            <Button variant="outline" size="sm" onClick={handleSaveEdits} disabled={saving} className="gap-1.5">
              {saving ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Edit2 className="w-3.5 h-3.5" />} Save
            </Button>
          )}
          {canExtend && (
            <Button variant="outline" size="sm" onClick={() => setExtendOpen(true)} className="gap-1.5">
              <CalendarClock className="w-3.5 h-3.5" /> Extend Deadline
            </Button>
          )}
          {canResend && (
            <Button variant="outline" size="sm" onClick={handleResend} disabled={resending} className="gap-1.5">
              {resending ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {resending ? "Sending…" : "Resend"}
            </Button>
          )}
          {canRevise && (
            <Button size="sm" onClick={() => onRevise(plan)} className="gap-1.5 bg-[#032d60] hover:bg-[#0176d3] text-white">
              <RotateCcw className="w-3.5 h-3.5" /> Revise & Resend
            </Button>
          )}
        </div>
      </div>

      {/* Client info */}
      <Card className="p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Client</p>
            <p className="font-medium">{plan.clientName}</p>
            {plan.clientTitle && <p className="text-xs text-muted-foreground">{plan.clientTitle}</p>}
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Email</p>
            <p className="font-medium break-all">{plan.clientEmail}</p>
          </div>
          {plan.expiresAt && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Expires</p>
              <p className="font-medium">{format(new Date(plan.expiresAt), "MMM d, yyyy")}</p>
            </div>
          )}
          {plan.approvedAt && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Signed</p>
              <p className="font-medium">{format(new Date(plan.approvedAt), "MMM d, yyyy")}</p>
              <p className="text-xs text-muted-foreground">{plan.signerName}</p>
            </div>
          )}
          {plan.declineReason && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Decline Reason</p>
              <p className="font-medium text-red-600">{plan.declineReason}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Activity Timeline */}
      <Card className="p-4">
        <h2 className="font-bold text-[#032d60] mb-3">Activity Timeline</h2>
        <div className="space-y-2">
          {events.map((ev, i) => (
            <div key={ev.id} className="flex items-start gap-3">
              <div className={cn("w-2 h-2 rounded-full mt-1.5 shrink-0",
                ev.eventType === "approved" ? "bg-green-500" :
                ev.eventType === "declined" || ev.eventType === "send_failed" ? "bg-red-500" :
                ev.eventType === "call_requested" ? "bg-orange-500" :
                "bg-[#0176d3]")} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{EVENT_LABELS[ev.eventType] || ev.eventType}</p>
                {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                  <p className="text-xs text-muted-foreground">{JSON.stringify(ev.metadata).replace(/[{}"]/g, "").replace(/,/g, " · ")}</p>
                )}
              </div>
              <p className="text-xs text-muted-foreground shrink-0">{format(new Date(ev.createdAt), "MMM d, h:mm a")}</p>
            </div>
          ))}
          {events.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
        </div>
      </Card>

      {/* Revision history */}
      {revisions.length > 0 && (
        <Card className="p-4">
          <h2 className="font-bold text-[#032d60] mb-3">Revision History</h2>
          <div className="space-y-2">
            {revisions.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                <span className="text-muted-foreground">v{r.version} · {r.planNumber}</span>
                <StatusBadge status={r.status} />
                <span className="text-xs text-muted-foreground">{format(new Date(r.createdAt), "MMM d, yyyy")}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Plan Content */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-[#032d60] text-base">Plan Content</h2>
          {isEditable && <span className="text-xs text-muted-foreground">Hover over sections to edit inline</span>}
        </div>
        {editedContent && <PlanDocument content={editedContent} editable={isEditable} onChange={setEditedContent} plan={data?.plan} planType={data?.plan?.planType} />}
      </Card>

      {/* Extend Deadline Modal */}
      {extendOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !extending && setExtendOpen(false)}>
          <Card className="w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-[#032d60] text-base flex items-center gap-2">
                <CalendarClock className="w-4 h-4" /> Extend Deadline
              </h3>
              <button onClick={() => !extending && setExtendOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Give your client more time to review. The existing review link stays the same — no new version is created.
            </p>
            {plan.expiresAt && (
              <p className="text-xs text-muted-foreground mb-3">
                Current expiry: <span className="font-medium text-foreground">{format(new Date(plan.expiresAt), "MMM d, yyyy")}</span>
              </p>
            )}
            <Label className="text-xs">New validity window</Label>
            <div className="grid grid-cols-4 gap-2 mt-1.5 mb-4">
              {([7, 14, 30, 60] as const).map(d => (
                <button key={d} type="button" onClick={() => setExtendDays(d)}
                  className={cn("px-2 py-2 rounded border text-sm font-medium transition-colors",
                    extendDays === d ? "border-[#0176d3] bg-[#0176d3]/5 text-[#032d60]" : "border-border hover:border-muted-foreground text-muted-foreground")}>
                  {d} days
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              New expiry will be{" "}
              <span className="font-medium text-foreground">
                {format(new Date(Date.now() + extendDays * 86400000), "MMM d, yyyy")}
              </span>.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setExtendOpen(false)} disabled={extending}>Cancel</Button>
              <Button size="sm" onClick={handleExtend} disabled={extending} className="gap-1.5 bg-[#032d60] hover:bg-[#0176d3] text-white">
                {extending ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
                {extending ? "Extending…" : "Extend Deadline"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Signature */}
      {plan.status === "approved" && plan.signatureImage && (
        <Card className="p-4">
          <h2 className="font-bold text-[#032d60] mb-3">Digital Signature</h2>
          <div className="flex items-start gap-4">
            <div>
              <img src={plan.signatureImage} alt="Signature" className="h-16 border rounded bg-white p-1" />
              <p className="text-sm font-medium mt-1">{plan.signerName}</p>
              {plan.signerTitle && <p className="text-xs text-muted-foreground">{plan.signerTitle}</p>}
              <p className="text-xs text-muted-foreground">{plan.clientCompany}</p>
              {plan.approvedAt && <p className="text-xs text-muted-foreground mt-1">Signed {format(new Date(plan.approvedAt), "MMMM d, yyyy 'at' h:mm a")}</p>}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type View = "list" | "wizard" | "detail";

export default function WrittenPlans() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [view, setView] = useState<View>("list");
  const [plans, setPlans] = useState<WrittenPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);
  const [revisionInitial, setRevisionInitial] = useState<{ answers: WizardAnswers; planId?: number; planContent?: PlanContent | null; mode?: "revise" | "edit-draft" } | undefined>();
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(BASE, { headers: authHeader() });
      if (r.ok) { const d = await r.json(); setPlans(d.plans || []); }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleEditAnswers(plan: WrittenPlan) {
    const answers = normalizeAnswers(plan.questionnaireAnswers);
    setRevisionInitial({ answers, planId: plan.id, planContent: plan.planContent as PlanContent | null, mode: "edit-draft" });
    setView("wizard");
  }

  async function handleRevise(plan: WrittenPlan) {
    try {
      const createRes = await fetch(`${BASE}/${plan.id}/revise`, { method: "POST", headers: authHeader() });
      if (!createRes.ok) throw new Error("Failed");
      const d = await createRes.json();
      const newPlan: WrittenPlan = d.plan;
      const answers = (plan.questionnaireAnswers as WizardAnswers) || BLANK_ANSWERS;
      setRevisionInitial({ answers, planId: newPlan.id, planContent: newPlan.planContent as PlanContent | null, mode: "revise" });
      setView("wizard");
    } catch {
      toast({ title: "Failed to create revision", variant: "destructive" });
    }
  }

  async function handleDelete(planId: number) {
    if (!confirm("Delete this plan? This cannot be undone.")) return;
    try {
      const res = await fetch(`${BASE}/${planId}`, { method: "DELETE", headers: authHeader() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: d.message || "Failed to delete", variant: "destructive" });
        return;
      }
      toast({ title: "Plan deleted" });
      load();
    } catch { toast({ title: "Failed to delete", variant: "destructive" }); }
  }

  function handleWizardComplete(plan: WrittenPlan) {
    setRevisionInitial(undefined);
    load();
    setSelectedPlanId(plan.id);
    setView("detail");
  }

  const filtered = statusFilter === "all" ? plans : plans.filter(p => p.status === statusFilter);

  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* List View */}
        {view === "list" && (
          <>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold text-[#032d60]">Written Plans</h1>
                <p className="text-muted-foreground text-sm mt-1">IT Assessment Plans for your clients</p>
              </div>
              <Button onClick={() => { setRevisionInitial(undefined); setView("wizard"); }}
                className="bg-[#032d60] hover:bg-[#0176d3] text-white gap-2">
                <Plus className="w-4 h-4" /> New Plan
              </Button>
            </div>

            {/* Filters */}
            <div className="flex gap-2 mb-4 flex-wrap">
              {["all", "draft", "sent", "viewed", "approved", "declined", "call_requested"].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors",
                    statusFilter === s ? "bg-[#032d60] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                  {s === "all" ? "All" : STATUS_CONFIG[s]?.label || s}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="flex justify-center py-20"><Loader className="w-6 h-6 animate-spin text-muted-foreground" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-20 text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>{statusFilter === "all" ? "No plans yet. Create your first one!" : "No plans with this status."}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(plan => (
                  <Card key={plan.id} className="p-4 hover:shadow-sm transition-shadow cursor-pointer"
                    onClick={() => { setSelectedPlanId(plan.id); setView("detail"); }}>
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-[#032d60] truncate">{plan.clientCompany}</p>
                          <StatusBadge status={plan.status} />
                          {plan.version > 1 && (
                            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">v{plan.version}</span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{plan.clientName} · {plan.planNumber}</p>
                      </div>
                      <div className="text-right shrink-0 text-xs text-muted-foreground space-y-0.5">
                        <p>Created {format(new Date(plan.createdAt), "MMM d, yyyy")}</p>
                        {plan.expiresAt && plan.status === "sent" && (
                          <p className={cn(new Date(plan.expiresAt) < new Date(Date.now() + 3 * 86400000) ? "text-orange-600 font-medium" : "")}>
                            Expires {format(new Date(plan.expiresAt), "MMM d, yyyy")}
                          </p>
                        )}
                      </div>
                      <Button variant="ghost" size="icon" onClick={e => { e.stopPropagation(); handleDelete(plan.id); }}>
                        <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Wizard */}
        {view === "wizard" && (
          <>
            <div className="flex items-center gap-3 mb-6">
              <Button variant="ghost" onClick={() => { setRevisionInitial(undefined); setView("list"); }}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Back to Plans
              </Button>
              <h1 className="text-xl font-bold text-[#032d60]">
                {revisionInitial?.planId ? "Revise Plan" : "New Written Plan"}
              </h1>
            </div>
            <PlanWizard
              initial={revisionInitial}
              onComplete={handleWizardComplete}
              onCancel={() => { setRevisionInitial(undefined); setView("list"); }}
            />
          </>
        )}

        {/* Detail */}
        {view === "detail" && selectedPlanId && (
          <PlanDetail
            planId={selectedPlanId}
            onBack={() => { setSelectedPlanId(null); setView("list"); load(); }}
            onRevise={handleRevise}
            onEditAnswers={handleEditAnswers}
          />
        )}
      </div>
    </PortalLayout>
  );
}
