import crypto from "crypto";
import PDFDocument from "pdfkit";

// ─── Built-in e-sign system ───────────────────────────────────────────────────
// No third-party provider. Tokens are generated locally; clients sign via the
// partner portal's /esign/:token page. Signed PDFs are a certificate of completion
// stored back into the documents table.

export interface EsignSigner {
  id: string;
  name: string;
  email: string;
  role?: string;
  signingOrder: number;
}

export interface CreateEnvelopeParams {
  documentName: string;
  fileBase64: string;
  fileName: string;
  signers: EsignSigner[];
  subject?: string;
  message?: string;
}

export interface EnvelopeResult {
  providerEnvelopeId: string; // kept for DB compat — same as review_token
  reviewToken: string;
  status: string;
}

export function generateReviewToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function isSignwellConfigured(): boolean {
  return true; // built-in — always available
}
