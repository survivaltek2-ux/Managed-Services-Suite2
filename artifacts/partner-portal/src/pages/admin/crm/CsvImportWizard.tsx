import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { crmFetch } from "./lib";

export type FieldOption = { value: string; label: string };

export type ImportResult = {
  inserted: number;
  updated: number;
  skipped: number;
  total: number;
  dryRun?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
  /** Dialog title — e.g. "Import Contacts (CSV)". */
  title: string;
  /** Backend import endpoint, e.g. "/admin/crm/contacts/import". */
  endpoint: string;
  /** Selectable target fields. The first option (value="") represents "skip". */
  fieldOptions: FieldOption[];
  /** Header → field auto-detection. Returns "" to leave unmapped. */
  autoDetect: (header: string) => string;
  /** Field values that, if any are mapped, satisfy "row is identifiable". */
  identifierFields: string[];
  /** Sentence shown if no identifier field is mapped. */
  identifierHint: string;
};

// Lightweight CSV row splitter — handles quoted fields with embedded commas/quotes.
function splitCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === ',') { out.push(cur); cur = ""; }
      else if (c === '"' && cur === "") { inQ = true; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

export function CsvImportWizard({
  open, onOpenChange, onDone,
  title, endpoint, fieldOptions, autoDetect, identifierFields, identifierHint,
}: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [csv, setCsv] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sampleRows, setSampleRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => { setStep(1); setCsv(""); setHeaders([]); setSampleRows([]); setMapping({}); setResult(null); };

  const parseAndAdvance = () => {
    const lines = csv.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim().length > 0);
    if (lines.length < 1) return;
    const hdr = splitCsvRow(lines[0]);
    const sample = lines.slice(1, 6).map(splitCsvRow);
    setHeaders(hdr);
    setSampleRows(sample);
    const m: Record<string, string> = {};
    hdr.forEach(h => { m[h] = autoDetect(h); });
    setMapping(m);
    setStep(2);
  };

  const dryRun = useMutation<ImportResult>({
    mutationFn: () => crmFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ csv, dryRun: true, mapping }),
    }) as Promise<ImportResult>,
    onSuccess: (r) => { setResult(r); setStep(3); },
  });
  const realRun = useMutation<ImportResult>({
    mutationFn: () => crmFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ csv, mapping }),
    }) as Promise<ImportResult>,
    onSuccess: (r) => { setResult(r); onDone(); },
  });

  const hasIdentifier = Object.values(mapping).some(v => identifierFields.includes(v));

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title} — Step {step} of 3</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload a CSV file or paste rows below. The first row must be column headers — you'll map them to fields next.
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                setCsv(await f.text());
              }}
              className="text-xs"
            />
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              className="w-full h-40 border rounded p-2 text-xs font-mono"
            />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Map each CSV column to a field. Unmapped columns will be ignored.
            </p>
            <div className="border rounded max-h-[360px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#fafafa] border-b sticky top-0">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="p-2">CSV column</th>
                    <th className="p-2">Preview</th>
                    <th className="p-2 w-[200px]">Maps to</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, idx) => (
                    <tr key={h + idx} className="border-b">
                      <td className="p-2 font-mono text-xs">{h}</td>
                      <td className="p-2 text-xs text-muted-foreground truncate max-w-[280px]">
                        {sampleRows.map(r => r[idx]).filter(Boolean).slice(0, 3).join(" · ") || <em>empty</em>}
                      </td>
                      <td className="p-2">
                        <select
                          value={mapping[h] ?? ""}
                          onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                          className="border rounded px-2 py-1 text-xs w-full"
                        >
                          {fieldOptions.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasIdentifier && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                {identifierHint}
              </div>
            )}
          </div>
        )}

        {step === 3 && result && (
          <div className="space-y-3">
            <div className="text-sm bg-blue-50 border border-blue-200 rounded p-3 space-y-1">
              <div className="font-medium">Dry-run preview</div>
              <div>Total rows scanned: <strong>{result.total}</strong></div>
              <div>New rows to insert: <strong>{result.inserted}</strong></div>
              <div>Existing rows to update: <strong>{result.updated}</strong></div>
              <div>Rows skipped: <strong>{result.skipped}</strong></div>
            </div>
            <p className="text-xs text-muted-foreground">
              No data has been written yet. Click <strong>Confirm import</strong> to apply, or go back to adjust the mapping.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          {step === 2 && <Button variant="outline" onClick={() => setStep(1)}>Back</Button>}
          {step === 3 && <Button variant="outline" onClick={() => setStep(2)}>Back to mapping</Button>}
          {step === 1 && (
            <Button disabled={!csv.trim()} onClick={parseAndAdvance}>Next: map columns</Button>
          )}
          {step === 2 && (
            <Button disabled={!hasIdentifier || dryRun.isPending} onClick={() => dryRun.mutate()}>
              {dryRun.isPending ? "Checking…" : "Preview (dry-run)"}
            </Button>
          )}
          {step === 3 && (
            <Button disabled={realRun.isPending} onClick={() => realRun.mutate()}>
              {realRun.isPending ? "Importing…" : "Confirm import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Field configurations ────────────────────────────────────────────────────

export const CONTACT_FIELD_OPTIONS: FieldOption[] = [
  { value: "", label: "— Skip column —" },
  { value: "email", label: "Email" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "fullName", label: "Full name" },
  { value: "phone", label: "Phone" },
  { value: "title", label: "Title" },
  { value: "companyName", label: "Company" },
  { value: "source", label: "Source" },
];

export function autoDetectContact(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (["email", "emailaddress"].includes(h)) return "email";
  if (["firstname", "first", "givenname"].includes(h)) return "firstName";
  if (["lastname", "last", "surname", "familyname"].includes(h)) return "lastName";
  if (["fullname", "name"].includes(h)) return "fullName";
  if (["phone", "phonenumber", "mobile", "telephone"].includes(h)) return "phone";
  if (["title", "jobtitle", "position"].includes(h)) return "title";
  if (["company", "companyname", "organization", "organisation", "account"].includes(h)) return "companyName";
  if (h === "source") return "source";
  return "";
}

export const COMPANY_FIELD_OPTIONS: FieldOption[] = [
  { value: "", label: "— Skip column —" },
  { value: "name", label: "Company name" },
  { value: "website", label: "Website" },
  { value: "phone", label: "Phone" },
  { value: "industry", label: "Industry" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "zip", label: "ZIP / Postal code" },
  { value: "source", label: "Source" },
];

export function autoDetectCompany(header: string): string {
  const h = header.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (["name", "company", "companyname", "organization", "organisation", "account"].includes(h)) return "name";
  if (["website", "url", "domain"].includes(h)) return "website";
  if (["phone", "phonenumber", "mobile", "telephone"].includes(h)) return "phone";
  if (["industry", "sector", "vertical"].includes(h)) return "industry";
  if (h === "city") return "city";
  if (["state", "region", "province"].includes(h)) return "state";
  if (["zip", "zipcode", "postal", "postalcode"].includes(h)) return "zip";
  if (h === "source") return "source";
  return "";
}
