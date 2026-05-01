export type TsdProvider = "telarus" | "intelisys" | "avant";

export interface TsdAuthCredentials {
  type: "api_key" | "username_password";
  apiKey?: string;
  agentId?: string;
  partnerId?: string;
  username?: string;
  password?: string;
  mfaCode?: string;
  securityToken?: string;
}

export interface TsdDeal {
  externalId?: string;
  title: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  description?: string | null;
  estimatedValue?: string | null;
  stage?: string;
  products?: string[];
}

export interface TsdLead {
  externalId: string;
  companyName: string;
  contactName: string;
  email?: string;
  phone?: string;
  source?: string;
  interest?: string;
  status?: string;
}

export interface TsdCommission {
  externalId: string;
  dealReference?: string;
  amount: string;
  status: string;
  description?: string;
  paidAt?: Date;
  periodStart?: Date;
  periodEnd?: Date;
}

export interface TsdOpportunity {
  externalId: string;
  name: string;
  accountName?: string;
  accountId?: string;
  amount?: string;
  stage?: string;
  probability?: number;
  closeDate?: Date;
  type?: string;
  description?: string;
  leadSource?: string;
  ownerName?: string;
  ownerId?: string;
  rawData?: Record<string, unknown>;
}

export interface TsdAccount {
  externalId: string;
  name: string;
  industry?: string;
  phone?: string;
  website?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  employeeCount?: number;
  annualRevenue?: string;
  type?: string;
  description?: string;
  rawData?: Record<string, unknown>;
}

export interface TsdContact {
  externalId: string;
  firstName?: string;
  lastName: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  title?: string;
  department?: string;
  accountId?: string;
  accountName?: string;
  mailingCity?: string;
  mailingState?: string;
  rawData?: Record<string, unknown>;
}

export interface TsdOrder {
  externalId: string;
  name: string;
  accountId?: string;
  accountName?: string;
  status?: string;
  orderAmount?: string;
  startDate?: Date;
  endDate?: Date;
  contractId?: string;
  type?: string;
  description?: string;
  rawData?: Record<string, unknown>;
}

export interface TsdQuote {
  externalId: string;
  name: string;
  opportunityId?: string;
  opportunityName?: string;
  accountId?: string;
  accountName?: string;
  status?: string;
  totalPrice?: string;
  expirationDate?: Date;
  description?: string;
  rawData?: Record<string, unknown>;
}

export interface TsdActivity {
  externalId: string;
  subject: string;
  type?: string;
  status?: string;
  priority?: string;
  description?: string;
  accountId?: string;
  accountName?: string;
  whoId?: string;
  whoName?: string;
  whatId?: string;
  whatName?: string;
  activityDate?: Date;
  durationMinutes?: number;
  rawData?: Record<string, unknown>;
}

export interface TsdTask {
  externalId: string;
  subject: string;
  status?: string;
  priority?: string;
  description?: string;
  whoId?: string;
  whoName?: string;
  whatId?: string;
  whatName?: string;
  ownerId?: string;
  ownerName?: string;
  activityDate?: Date;
  isCompleted?: boolean;
  rawData?: Record<string, unknown>;
}

export interface TsdWebhookEvent {
  type: "deal_update" | "lead_assigned" | "commission_paid" | "unknown";
  provider: TsdProvider;
  payload: Record<string, unknown>;
  raw: string;
}

export interface TsdPushResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export interface TsdLoginResult {
  success: boolean;
  sessionToken?: string;
  requiresMfa?: boolean;
  mfaMethod?: string;
  error?: string;
}

export interface TsdVendor {
  externalId: string;
  name: string;
  accountType?: string;
  industry?: string;
  phone?: string;
  website?: string;
  billingStreet?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  billingCountry?: string;
  description?: string;
  partnerType?: string;
  partnerStatus?: string;
  numberOfEmployees?: number;
  annualRevenue?: string;
  isActive?: boolean;
  rawData?: Record<string, unknown>;
}

export interface TsdConnector {
  provider: TsdProvider;
  pushDeal(deal: TsdDeal): Promise<TsdPushResult>;
  pullLeads(since?: Date): Promise<TsdLead[]>;
  pullCommissions(since?: Date): Promise<TsdCommission[]>;
  pullOpportunities?(since?: Date): Promise<TsdOpportunity[]>;
  pullAccounts?(since?: Date): Promise<TsdAccount[]>;
  pullContacts?(since?: Date): Promise<TsdContact[]>;
  pullOrders?(since?: Date): Promise<TsdOrder[]>;
  pullQuotes?(since?: Date): Promise<TsdQuote[]>;
  pullActivities?(since?: Date): Promise<TsdActivity[]>;
  pullTasks?(since?: Date): Promise<TsdTask[]>;
  pullVendors?(since?: Date): Promise<TsdVendor[]>;
  handleWebhook(rawBody: string, signature: string, secret: string): Promise<TsdWebhookEvent>;
  testConnection(): Promise<{ ok: boolean; error?: string; requiresMfa?: boolean }>;
  login?(): Promise<TsdLoginResult>;
  isAuthenticated?(): boolean;
}
