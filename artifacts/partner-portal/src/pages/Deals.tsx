import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import {
  useDeals, useCreateDeal, useResolveTsdMatches, useDealTsdLogs, useRetryTsdPush, useVendors,
  type Deal, type TsdMatch, type TsdSyncLog, type Vendor, type VendorSelection,
} from "@/hooks/use-deals";
import { useTsdProducts, type TsdProduct } from "@/hooks/use-tsd-products";
import { formatCurrency } from "@/lib/utils";
import { getAuthHeaders } from "@/hooks/use-auth";
import {
  Plus, Search, List, Columns3, X, ChevronDown, Filter, ChevronRight,
  RefreshCw, CheckCircle, AlertCircle, Clock, ArrowLeft, Building2, Tag, Check,
} from "lucide-react";
import { format } from "date-fns";

const DEFAULT_STAGES = ["prospect", "qualification", "proposal", "negotiation", "closed_won", "closed_lost"];
const STAGE_COLORS: Record<string, string> = {
  prospect: "#0176d3",
  qualification: "#1b96ff",
  proposal: "#fe9339",
  negotiation: "#9050e9",
  closed_won: "#2e844a",
  closed_lost: "#ea001e",
};
const FALLBACK_STAGE_COLOR = "#706e6b";

type CrmPipeline = { id: number; name: string; stages: { id: number; slug: string; name: string; sortOrder: number }[] };

const TSD_LABELS: Record<string, string> = {
  avant: "Avant",
  telarus: "Telarus",
  intelisys: "Intelisys",
};

export default function Deals() {
  const { data: deals = [], isLoading } = useDeals();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"list" | "kanban">("list");
  const [expandedDealId, setExpandedDealId] = useState<number | null>(null);
  const [pipelineId, setPipelineId] = useState<number | "all">("all");

  // Pull custom pipelines/stages from the CRM so admins can switch board layouts.
  const { data: pipelinesData } = useQuery<CrmPipeline[]>({
    queryKey: ["crm", "pipelines"],
    queryFn: async () => {
      const res = await fetch("/api/admin/crm/pipelines", { headers: getAuthHeaders() });
      if (!res.ok) return [];
      const body = (await res.json()) as { pipelines?: { id: number; name: string }[]; stages?: { id: number; pipelineId: number; slug: string; name: string; sortOrder: number }[] };
      const pls = body.pipelines ?? [];
      const sts = body.stages ?? [];
      return pls.map(p => ({
        id: p.id,
        name: p.name,
        stages: sts.filter(s => s.pipelineId === p.id).map(s => ({ id: s.id, slug: s.slug, name: s.name, sortOrder: s.sortOrder })),
      }));
    },
  });
  const pipelines = pipelinesData ?? [];
  const activePipeline = pipelineId === "all" ? null : pipelines.find(p => p.id === pipelineId) ?? null;

  // When a pipeline is active, columns are addressed by stage ID (string) and
  // the synthetic "_unassigned" bucket holds deals with no pipelineStageId.
  // Otherwise we fall back to the legacy enum slugs from `deal.stage`.
  const kanbanColumns: { key: string; label: string; color: string; stageId: number | null }[] = useMemo(() => {
    if (activePipeline && activePipeline.stages.length > 0) {
      const sorted = [...activePipeline.stages].sort((a, b) => a.sortOrder - b.sortOrder);
      const cols: { key: string; label: string; color: string; stageId: number | null }[] = sorted.map(s => ({
        key: `s${s.id}`,
        label: s.name,
        color: STAGE_COLORS[s.slug] || FALLBACK_STAGE_COLOR,
        stageId: s.id,
      }));
      cols.push({ key: "_unassigned", label: "Unassigned", color: FALLBACK_STAGE_COLOR, stageId: null });
      return cols;
    }
    return DEFAULT_STAGES.map(s => ({
      key: s,
      label: s.replace(/_/g, " "),
      color: STAGE_COLORS[s] || FALLBACK_STAGE_COLOR,
      stageId: null,
    }));
  }, [activePipeline]);

  // Map a deal to its column key for the active grouping mode.
  const dealColumnKey = (d: Deal): string => {
    if (activePipeline) {
      const stageId = d.pipelineStageId;
      if (stageId == null) return "_unassigned";
      const match = activePipeline.stages.find(s => s.id === stageId);
      return match ? `s${match.id}` : "_unassigned";
    }
    return d.stage;
  };

  const filteredDeals = deals.filter(d =>
    d.title.toLowerCase().includes(search.toLowerCase()) ||
    d.customerName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <PortalLayout>
      <div className="sf-page-header px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-bold text-foreground">Deals</h1>
            <span className="text-xs text-muted-foreground">{filteredDeals.length} items</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border border-border rounded overflow-hidden">
              <button onClick={() => setView("list")} aria-label="List view" className={`p-1.5 ${view === "list" ? "bg-[#0176d3] text-white" : "bg-white text-muted-foreground hover:bg-[#f3f3f3]"}`}>
                <List className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setView("kanban")} aria-label="Kanban view" className={`p-1.5 ${view === "kanban" ? "bg-[#0176d3] text-white" : "bg-white text-muted-foreground hover:bg-[#f3f3f3]"}`}>
                <Columns3 className="w-3.5 h-3.5" />
              </button>
            </div>
            <button onClick={() => setShowModal(true)} className="sf-btn sf-btn-primary">
              <Plus className="w-3.5 h-3.5" /> New Deal
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search deals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sf-input pl-8"
            />
          </div>
          <button className="sf-btn sf-btn-neutral">
            <Filter className="w-3.5 h-3.5" /> Filters <ChevronDown className="w-3 h-3" />
          </button>
          {pipelines.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">Pipeline:</span>
              <select
                value={pipelineId}
                onChange={(e) => setPipelineId(e.target.value === "all" ? "all" : Number(e.target.value))}
                className="sf-input py-1 text-xs"
                aria-label="Pipeline"
              >
                <option value="all">Default stages</option>
                {pipelines.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {view === "list" ? (
          <div className="sf-card overflow-x-auto">
            <table className="w-full sf-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Deal Name</th>
                  <th>Customer</th>
                  <th className="text-right">Est. Value</th>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>TSD Routing</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</td></tr>
                ) : filteredDeals.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-muted-foreground">No deals found. Register your first deal to get started.</td></tr>
                ) : (
                  filteredDeals.map((deal) => (
                    <>
                      <tr
                        key={deal.id}
                        className="cursor-pointer hover:bg-[#f3f3f3]"
                        onClick={() => setExpandedDealId(expandedDealId === deal.id ? null : deal.id)}
                      >
                        <td className="w-6">
                          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${expandedDealId === deal.id ? "rotate-90" : ""}`} />
                        </td>
                        <td className="font-medium text-[#0176d3]">{deal.title}</td>
                        <td>{deal.customerName}</td>
                        <td className="text-right font-semibold">{formatCurrency(deal.estimatedValue)}</td>
                        <td>
                          <span className="sf-badge capitalize" style={{ backgroundColor: `${STAGE_COLORS[deal.stage] || '#706e6b'}15`, color: STAGE_COLORS[deal.stage] || '#706e6b' }}>
                            {deal.stage.replace('_', ' ')}
                          </span>
                        </td>
                        <td><StatusBadge status={deal.status} /></td>
                        <td><TsdRoutingBadges tsdTargets={deal.tsdTargets} /></td>
                        <td className="text-muted-foreground text-xs">{format(new Date(deal.createdAt), 'MMM d, yyyy')}</td>
                      </tr>
                      {expandedDealId === deal.id && (
                        <tr key={`${deal.id}-detail`}>
                          <td colSpan={8} className="p-0">
                            <DealTsdDetail dealId={deal.id} tsdTargets={deal.tsdTargets} vendorSelections={deal.vendorSelections} />
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-4">
            {kanbanColumns.map(col => {
              const stageDeals = filteredDeals.filter(d => dealColumnKey(d) === col.key);
              const stageTotal = stageDeals.reduce((s, d) => s + parseFloat(String(d.estimatedValue) || "0"), 0);
              const color = col.color;
              return (
                <div key={col.key} className="min-w-[260px] flex-1">
                  <div className="rounded-t px-3 py-2 flex items-center justify-between" style={{ backgroundColor: `${color}15`, borderBottom: `2px solid ${color}` }}>
                    <span className="text-xs font-bold uppercase tracking-wider capitalize" style={{ color }}>{col.label}</span>
                    <span className="text-[10px] font-semibold text-muted-foreground">{stageDeals.length} &middot; {formatCurrency(stageTotal)}</span>
                  </div>
                  <div className="space-y-2 mt-2 min-h-[200px]">
                    {stageDeals.map(deal => (
                      <div
                        key={deal.id}
                        className="sf-card p-3 cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => setExpandedDealId(expandedDealId === deal.id ? null : deal.id)}
                      >
                        <p className="font-medium text-sm text-[#0176d3] mb-1">{deal.title}</p>
                        <p className="text-xs text-muted-foreground mb-2">{deal.customerName}</p>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold">{formatCurrency(deal.estimatedValue)}</span>
                          <StatusBadge status={deal.status} />
                        </div>
                        {activePipeline && (
                          <div className="mb-2" onClick={e => e.stopPropagation()}>
                            <PipelineStageMover deal={deal} pipeline={activePipeline} />
                          </div>
                        )}
                        {deal.vendorSelections && deal.vendorSelections.length > 0 && (
                          <div className="mb-1.5">
                            <VendorBadges vendorSelections={deal.vendorSelections} />
                          </div>
                        )}
                        {deal.tsdTargets && deal.tsdTargets.length > 0 && (
                          <TsdRoutingBadges tsdTargets={deal.tsdTargets} />
                        )}
                        {expandedDealId === deal.id && (
                          <div className="mt-2 border-t pt-2">
                            <DealTsdDetail dealId={deal.id} tsdTargets={deal.tsdTargets} vendorSelections={deal.vendorSelections} />
                          </div>
                        )}
                      </div>
                    ))}
                    {stageDeals.length === 0 && (
                      <div className="text-center py-8 text-xs text-muted-foreground">No deals</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && <AddDealModal onClose={() => setShowModal(false)} />}
    </PortalLayout>
  );
}

function TsdRoutingBadges({ tsdTargets }: { tsdTargets: string[] }) {
  if (!tsdTargets || tsdTargets.length === 0) {
    return <span className="text-xs text-muted-foreground italic">None</span>;
  }
  return (
    <div className="flex gap-1 flex-wrap">
      {tsdTargets.map(id => (
        <span key={id} className="sf-badge sf-badge-info text-[10px]">{TSD_LABELS[id] || id}</span>
      ))}
    </div>
  );
}

function DealTsdDetail({ dealId, tsdTargets, vendorSelections }: { dealId: number; tsdTargets: string[]; vendorSelections?: VendorSelection[] }) {
  const { data: logs = [], isLoading, refetch } = useDealTsdLogs(dealId);
  const { mutateAsync: retryPush, isPending: isRetrying } = useRetryTsdPush();

  const hasFailed = logs.some(l => l.status === "failed");

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await retryPush(dealId);
    refetch();
  };

  return (
    <div className="bg-[#f8f8f8] border-t border-[#e5e5e5] px-6 py-3" onClick={e => e.stopPropagation()}>
      {vendorSelections && vendorSelections.length > 0 && (
        <div className="mb-3">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide block mb-1.5">Vendors &amp; Services</span>
          <VendorBadges vendorSelections={vendorSelections} />
        </div>
      )}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">TSD Push Status</span>
        {hasFailed && (
          <button
            className="sf-btn sf-btn-neutral text-xs py-0.5 px-2"
            onClick={handleRetry}
            disabled={isRetrying}
          >
            <RefreshCw className={`w-3 h-3 ${isRetrying ? "animate-spin" : ""}`} />
            {isRetrying ? "Retrying..." : "Retry Failed"}
          </button>
        )}
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          {tsdTargets && tsdTargets.length > 0
            ? "Push in progress..."
            : "No TSD push configured for this deal."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {logs.map(log => (
            <TsdLogRow key={log.id} log={log} />
          ))}
        </div>
      )}
    </div>
  );
}

function TsdLogRow({ log }: { log: TsdSyncLog }) {
  const label = TSD_LABELS[log.tsdId] || log.tsdId;
  if (log.status === "success") {
    return (
      <div className="flex items-center gap-2 text-xs">
        <CheckCircle className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">— Successfully submitted</span>
        {log.payload && (() => {
          try {
            const p = JSON.parse(log.payload);
            return p.externalId ? <span className="text-muted-foreground">({p.externalId})</span> : null;
          } catch { return null; }
        })()}
      </div>
    );
  }
  if (log.status === "failed") {
    return (
      <div className="flex items-start gap-2 text-xs">
        <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">{label}</span>
          <span className="text-muted-foreground ml-1">— Push failed</span>
          {log.errorMessage && <p className="text-red-500 mt-0.5">{log.errorMessage}</p>}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      <Clock className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
      <span className="font-medium">{label}</span>
      <span className="text-muted-foreground">— Pending</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    registered: "sf-badge-info",
    in_progress: "sf-badge-warning",
    won: "sf-badge-success",
    lost: "sf-badge-error",
    expired: "sf-badge-default",
  };
  return <span className={`sf-badge ${map[status] || 'sf-badge-default'} capitalize`}>{status.replace('_', ' ')}</span>;
}

function VendorBadges({ vendorSelections }: { vendorSelections: VendorSelection[] }) {
  if (!vendorSelections || vendorSelections.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {vendorSelections.map(v => (
        <span key={v.vendorId} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#f3f3f3] border border-[#d8dde6] text-xs rounded-full text-foreground">
          <Building2 className="w-2.5 h-2.5 text-muted-foreground flex-shrink-0" />
          <span>{v.vendorName}</span>
          {v.services.length > 0 && (
            <span className="text-muted-foreground">· {v.services.join(", ")}</span>
          )}
        </span>
      ))}
    </div>
  );
}

type WizardStep = "deal-info" | "vendors" | "products" | "review";

function VendorSelector({
  selected,
  onChange,
}: {
  selected: VendorSelection[];
  onChange: (selections: VendorSelection[]) => void;
}) {
  const { data: vendors = [], isLoading } = useVendors();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});

  // Get all unique categories from vendors
  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    vendors.forEach(v => {
      if (v.products && Array.isArray(v.products)) {
        v.products.forEach(p => cats.add(p.category));
      }
    });
    return Array.from(cats).sort();
  }, [vendors]);

  const filtered = useMemo(() => {
    let result = vendors;
    
    // Filter by category if selected
    if (selectedCategory) {
      result = result.filter(v => 
        v.products && Array.isArray(v.products) && v.products.some(p => p.category === selectedCategory)
      );
    }
    
    // Then filter by search
    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter(v =>
        v.name.toLowerCase().includes(q) ||
        (v.industry || "").toLowerCase().includes(q) ||
        (v.accountType || "").toLowerCase().includes(q) ||
        (v.products && Array.isArray(v.products) && v.products.some(p => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)))
      );
    }
    
    return result;
  }, [vendors, search, selectedCategory]);

  const isSelected = (v: Vendor) => selected.some(s => s.vendorId === v.externalId);

  const toggleVendor = (v: Vendor) => {
    if (isSelected(v)) {
      onChange(selected.filter(s => s.vendorId !== v.externalId));
    } else {
      onChange([...selected, { vendorId: v.externalId, vendorName: v.name, services: [] }]);
    }
  };

  const toggleService = (vendorId: string, serviceName: string) => {
    onChange(selected.map(s =>
      s.vendorId === vendorId
        ? {
            ...s,
            services: s.services.includes(serviceName)
              ? s.services.filter(x => x !== serviceName)
              : [...s.services, serviceName],
          }
        : s
    ));
  };

  const addCustomService = (vendorId: string) => {
    const raw = (customInputs[vendorId] || "").trim();
    if (!raw) return;
    const tags = raw.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    onChange(selected.map(s =>
      s.vendorId === vendorId
        ? { ...s, services: [...new Set([...s.services, ...tags])] }
        : s
    ));
    setCustomInputs(prev => ({ ...prev, [vendorId]: "" }));
  };

  const removeService = (vendorId: string, service: string) => {
    onChange(selected.map(s =>
      s.vendorId === vendorId
        ? { ...s, services: s.services.filter(x => x !== service) }
        : s
    ));
  };

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Loading vendors...</div>;
  }

  if (!vendors.length) {
    return <div className="text-xs text-muted-foreground py-4 text-center">No vendors synced yet. Sync from Telarus in the Admin panel.</div>;
  }

  return (
    <div className="flex gap-3 h-[420px]">
      {/* ── Left panel: vendor browser ── */}
      <div className="w-56 flex-shrink-0 flex flex-col border border-[#e5e7eb] rounded-lg overflow-hidden">
        <div className="border-b border-[#e5e7eb] bg-[#f9fafb]">
          {/* Search box */}
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vendors..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="sf-input pl-6 text-xs py-1.5 w-full"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Category filter tabs */}
          {allCategories.length > 0 && (
            <div className="px-2 pb-2 border-t border-[#e5e7eb]">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Category</p>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                    selectedCategory === null
                      ? "bg-[#0176d3] text-white font-medium"
                      : "hover:bg-[#f0f0f0] text-foreground"
                  }`}
                >
                  All ({vendors.length})
                </button>
                {allCategories.map(cat => {
                  const count = vendors.filter(v => v.products.some(p => p.category === cat)).length;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`w-full text-left px-2 py-1 text-xs rounded transition-colors truncate ${
                        selectedCategory === cat
                          ? "bg-[#0176d3] text-white font-medium"
                          : "hover:bg-[#f0f0f0] text-foreground"
                      }`}
                      title={cat}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selection counter */}
          {selected.length > 0 && (
            <div className="p-2 border-t border-[#e5e7eb]">
              <p className="text-[10px] text-[#0176d3] font-semibold text-center">
                {selected.length} vendor{selected.length !== 1 ? "s" : ""} selected
              </p>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0]">
          {filtered.length === 0 ? (
            <div className="text-center py-6 text-xs text-muted-foreground">No matches.</div>
          ) : (
            filtered.map(v => {
              const checked = isSelected(v);
              return (
                <button
                  key={v.externalId}
                  type="button"
                  onClick={() => toggleVendor(v)}
                  className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                    checked
                      ? "bg-[#e8f3fd] text-[#0176d3]"
                      : "hover:bg-[#f3f3f3] text-foreground"
                  }`}
                >
                  <div className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                    checked ? "bg-[#0176d3] border-[#0176d3]" : "border-[#d1d5db] bg-white"
                  }`}>
                    {checked && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className="text-xs font-medium truncate">{v.name}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right panel: product picker for selected vendors ── */}
      <div className="flex-1 flex flex-col border border-[#e5e7eb] rounded-lg overflow-hidden">
        {selected.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 text-muted-foreground gap-2">
            <Building2 className="w-8 h-8 text-[#d1d5db]" />
            <p className="text-sm font-medium">No vendors selected</p>
            <p className="text-xs">Click vendors on the left to add them, then select which products apply.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0]">
            {selected.map(sel => {
              const vendor = vendors.find(v => v.externalId === sel.vendorId);
              if (!vendor) return null;
              const grouped = vendor.products.reduce<Record<string, typeof vendor.products>>((acc, p) => {
                if (!acc[p.category]) acc[p.category] = [];
                acc[p.category].push(p);
                return acc;
              }, {});
              const categories = Object.keys(grouped).sort();

              return (
                <div key={sel.vendorId} className="p-3">
                  {/* Vendor header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[#0176d3]" />
                      <span className="text-sm font-semibold text-foreground">{vendor.name}</span>
                      {sel.services.length > 0 && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-[#0176d3] text-white rounded-full">
                          {sel.services.length}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleVendor(vendor)}
                      className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Selected service chips */}
                  {sel.services.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {sel.services.map(svc => (
                        <span key={svc} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0176d3] text-white text-xs rounded-full">
                          {svc}
                          <button type="button" onClick={() => removeService(sel.vendorId, svc)} className="hover:text-red-200 ml-0.5">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Product catalog chips grouped by category */}
                  {categories.length > 0 ? (
                    <div className="space-y-2">
                      {categories.map(cat => (
                        <div key={cat}>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">{cat}</p>
                          <div className="flex flex-wrap gap-1">
                            {grouped[cat].map(p => {
                              const isActive = sel.services.includes(p.name);
                              return (
                                <button
                                  key={p.name}
                                  type="button"
                                  title={p.description}
                                  onClick={() => toggleService(sel.vendorId, p.name)}
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border transition-all ${
                                    isActive
                                      ? "bg-[#0176d3] text-white border-[#0176d3]"
                                      : "bg-white text-foreground border-[#d1d5db] hover:border-[#0176d3] hover:text-[#0176d3]"
                                  }`}
                                >
                                  {isActive && <Check className="w-2.5 h-2.5" />}
                                  {p.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No catalog products for this vendor.</p>
                  )}

                  {/* Custom service input */}
                  <div className="mt-2 flex gap-1">
                    <input
                      type="text"
                      placeholder="Add a custom service..."
                      value={customInputs[sel.vendorId] || ""}
                      onChange={e => setCustomInputs(prev => ({ ...prev, [sel.vendorId]: e.target.value }))}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomService(sel.vendorId); } }}
                      className="sf-input text-xs py-1 flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => addCustomService(sel.vendorId)}
                      className="sf-btn sf-btn-neutral text-xs px-2 py-1"
                    >
                      Add
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductSelector({ selected, onChange }: { selected: string[]; onChange: (products: string[]) => void }) {
  const { data: catalog, isLoading } = useTsdProducts();
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleProduct = (name: string) => {
    onChange(selected.includes(name) ? selected.filter(x => x !== name) : [...selected, name]);
  };

  const filteredGrouped = useMemo(() => {
    if (!catalog) return {};
    if (!search.trim()) return catalog.grouped;
    const q = search.toLowerCase();
    const result: Record<string, TsdProduct[]> = {};
    for (const [cat, items] of Object.entries(catalog.grouped)) {
      const filtered = items.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.description || "").toLowerCase().includes(q)
      );
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [catalog, search]);

  const categories = Object.keys(filteredGrouped).sort();
  const hasSearch = !!search.trim();

  if (isLoading) {
    return <div className="text-xs text-muted-foreground py-4 text-center">Loading product catalog...</div>;
  }

  if (!catalog || catalog.products.length === 0) {
    return <div className="text-xs text-muted-foreground py-4 text-center">No products available.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search products and services..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="sf-input pl-8 text-sm"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 p-2 bg-[#f3f3f3] rounded border border-border">
          {selected.map(name => (
            <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0176d3]/10 text-[#0176d3] text-xs rounded-full">
              {name}
              <button onClick={() => toggleProduct(name)} className="hover:text-red-500">
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="border border-border rounded max-h-60 overflow-y-auto">
        {categories.length === 0 ? (
          <div className="text-center py-6 text-xs text-muted-foreground">No products match your search.</div>
        ) : (
          categories.map(cat => {
            const items = filteredGrouped[cat];
            const isExpanded = hasSearch || expandedCategories.has(cat);
            const selectedInCat = items.filter(p => selected.includes(p.name)).length;
            return (
              <div key={cat} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#f3f3f3] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {!hasSearch && (
                      <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                    )}
                    <span className="text-xs font-semibold text-foreground">{cat}</span>
                    <span className="text-[10px] text-muted-foreground">({items.length})</span>
                  </div>
                  {selectedInCat > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-[#0176d3]/10 text-[#0176d3] rounded-full">{selectedInCat} selected</span>
                  )}
                </button>
                {isExpanded && (
                  <div className="px-3 pb-2 space-y-1">
                    {items.map(product => (
                      <label
                        key={product.id}
                        className="flex items-start gap-2 p-1.5 rounded hover:bg-[#f3f3f3] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="w-3.5 h-3.5 mt-0.5 rounded text-[#0176d3] focus:ring-[#0176d3] flex-shrink-0"
                          checked={selected.includes(product.name)}
                          onChange={() => toggleProduct(product.name)}
                        />
                        <div className="min-w-0">
                          <span className="text-sm text-foreground leading-tight block">{product.name}</span>
                          {product.description && (
                            <span className="text-[11px] text-muted-foreground leading-tight block">{product.description}</span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const WIZARD_STEPS: { id: WizardStep; label: string; description: string }[] = [
  { id: "deal-info",  label: "Deal Info",           description: "Basic opportunity details" },
  { id: "vendors",   label: "Vendors & Carriers",   description: "Who are you quoting?" },
  { id: "products",  label: "Products & Services",  description: "What will they buy?" },
  { id: "review",    label: "Review & Submit",      description: "Confirm and send" },
];

function WizardStepBar({ current }: { current: WizardStep }) {
  const currentIdx = WIZARD_STEPS.findIndex(s => s.id === current);
  return (
    <div className="px-6 py-4 border-b border-[#e5e7eb] bg-white">
      <div className="flex items-center gap-0">
        {WIZARD_STEPS.map((step, idx) => {
          const done   = idx < currentIdx;
          const active = idx === currentIdx;
          return (
            <div key={step.id} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-all ${
                  done   ? "bg-green-500 text-white" :
                  active ? "bg-[#0176d3] text-white ring-4 ring-[#0176d3]/20" :
                           "bg-[#f3f3f3] text-[#9aa0ae]"
                }`}>
                  {done ? <CheckCircle className="w-4 h-4" /> : idx + 1}
                </div>
                <div className={`text-[10px] font-semibold whitespace-nowrap ${active ? "text-[#0176d3]" : done ? "text-green-600" : "text-[#9aa0ae]"}`}>
                  {step.label}
                </div>
              </div>
              {idx < WIZARD_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-5 transition-colors ${done ? "bg-green-400" : "bg-[#e5e7eb]"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddDealModal({ onClose }: { onClose: () => void }) {
  const { mutateAsync: createDeal, isPending } = useCreateDeal();
  const { mutateAsync: resolveTsdMatches, isPending: isResolving } = useResolveTsdMatches();
  const [step, setStep] = useState<WizardStep>("deal-info");
  const [formData, setFormData] = useState({
    title: "", customerName: "", customerEmail: "", estimatedValue: "",
    products: [] as string[],
    vendorSelections: [] as VendorSelection[],
  });
  const [tsdMatches, setTsdMatches] = useState<TsdMatch[]>([]);
  const [selectedTsds, setSelectedTsds] = useState<string[]>([]);

  const currentIdx = WIZARD_STEPS.findIndex(s => s.id === step);

  const goBack = () => setStep(WIZARD_STEPS[currentIdx - 1].id);

  const handleDealInfoNext = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("vendors");
  };

  const handleVendorsNext = () => setStep("products");

  const handleProductsNext = async () => {
    const result = await resolveTsdMatches(formData.products);
    const matches = result.matches || [];
    setTsdMatches(matches);
    setSelectedTsds(matches.length > 0 ? [matches[0].id] : []);
    setStep("review");
  };

  const handleSubmit = async () => {
    await createDeal({
      ...formData,
      estimatedValue: parseFloat(formData.estimatedValue) || 0,
      tsdTargets: selectedTsds,
    });
    onClose();
  };

  const toggleTsd = (id: string) =>
    setSelectedTsds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const ALL_TSDS: TsdMatch[] = [
    { id: "avant",      label: "Avant" },
    { id: "telarus",    label: "Telarus" },
    { id: "intelisys",  label: "Intelisys" },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deal-modal-title"
      onKeyDown={e => e.key === "Escape" && onClose()}
    >
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-[#e5e7eb] flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-6 py-4 border-b border-[#e5e7eb] flex justify-between items-center">
          <div>
            <h2 id="deal-modal-title" className="text-lg font-bold text-foreground">New Deal Registration</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{WIZARD_STEPS[currentIdx].description}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-[#f3f3f3]">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step progress bar */}
        <WizardStepBar current={step} />

        {/* Step content */}
        <div className="p-6 overflow-y-auto flex-1">

          {/* ── Step 1: Deal Info ── */}
          {step === "deal-info" && (
            <form id="wizard-form" onSubmit={handleDealInfoNext} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Opportunity Name <span className="text-red-400">*</span>
                </label>
                <input
                  className="sf-input text-base"
                  placeholder="e.g. Acme Corp — SD-WAN Refresh"
                  value={formData.title}
                  onChange={e => setFormData({ ...formData, title: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Customer Company <span className="text-red-400">*</span>
                  </label>
                  <input
                    className="sf-input"
                    placeholder="Company name"
                    value={formData.customerName}
                    onChange={e => setFormData({ ...formData, customerName: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer Email</label>
                  <input
                    className="sf-input"
                    type="email"
                    placeholder="contact@company.com"
                    value={formData.customerEmail}
                    onChange={e => setFormData({ ...formData, customerEmail: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Estimated Monthly Value <span className="text-red-400">*</span>
                </label>
                <input
                  className="sf-input"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 2500.00"
                  value={formData.estimatedValue}
                  onChange={e => setFormData({ ...formData, estimatedValue: e.target.value })}
                  required
                />
              </div>
            </form>
          )}

          {/* ── Step 2: Vendors ── */}
          {step === "vendors" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select the carriers and vendors you're quoting for this opportunity. Then click their products to specify what you're selling.
              </p>
              <VendorSelector
                selected={formData.vendorSelections}
                onChange={vendorSelections => setFormData({ ...formData, vendorSelections })}
              />
            </div>
          )}

          {/* ── Step 3: Products ── */}
          {step === "products" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Select the product categories and services this customer is interested in. These are used to route the deal to the right distributor.
              </p>
              <ProductSelector
                selected={formData.products}
                onChange={products => setFormData({ ...formData, products })}
              />
            </div>
          )}

          {/* ── Step 4: Review & Submit ── */}
          {step === "review" && (
            <div className="space-y-5">
              {/* Deal summary card */}
              <div className="rounded-lg border border-[#e5e7eb] overflow-hidden">
                <div className="bg-[#f9fafb] px-4 py-2.5 border-b border-[#e5e7eb]">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Deal Summary</p>
                </div>
                <div className="p-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Opportunity</p>
                    <p className="font-semibold">{formData.title || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Customer</p>
                    <p className="font-semibold">{formData.customerName || "—"}</p>
                  </div>
                  {formData.customerEmail && (
                    <div>
                      <p className="text-xs text-muted-foreground">Customer Email</p>
                      <p className="font-medium">{formData.customerEmail}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">Est. Monthly Value</p>
                    <p className="font-semibold text-green-700">${parseFloat(formData.estimatedValue || "0").toLocaleString()}</p>
                  </div>
                  {formData.vendorSelections.length > 0 ? (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground mb-2 font-semibold">Vendors & Carriers ({formData.vendorSelections.length})</p>
                      <div className="space-y-2">
                        {formData.vendorSelections.map(v => (
                          <div key={v.vendorId} className="p-2 bg-[#f0f7ff] border border-[#bfdbfe] rounded-lg">
                            <div className="flex items-center gap-2 mb-1">
                              <Building2 className="w-3.5 h-3.5 text-[#0176d3]" />
                              <p className="font-semibold text-sm text-[#0176d3]">{v.vendorName}</p>
                              {v.services.length > 0 && (
                                <span className="ml-auto text-[10px] bg-[#0176d3] text-white px-2 py-0.5 rounded-full font-medium">{v.services.length} product{v.services.length !== 1 ? "s" : ""}</span>
                              )}
                            </div>
                            {v.services.length > 0 && (
                              <div className="flex flex-wrap gap-1 ml-5">
                                {v.services.map(svc => (
                                  <span key={svc} className="text-[10px] px-2 py-0.5 bg-white border border-[#0176d3] text-[#0176d3] rounded-full">{svc}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground mb-1 font-semibold">Vendors & Carriers</p>
                      <p className="text-xs text-[#9ca3af] italic">No vendors selected</p>
                    </div>
                  )}
                  {formData.products.length > 0 && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground mb-1">Products & Services</p>
                      <div className="flex flex-wrap gap-1">
                        {formData.products.map(p => (
                          <span key={p} className="px-2 py-0.5 bg-[#f3f3f3] border border-[#e5e7eb] text-xs rounded-full">{p}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* TSD routing */}
              <div className="rounded-lg border border-[#e5e7eb] overflow-hidden">
                <div className="bg-[#f9fafb] px-4 py-2.5 border-b border-[#e5e7eb]">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">TSD Distributor Routing</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {tsdMatches.length > 0
                      ? `${tsdMatches.length} distributor${tsdMatches.length > 1 ? "s" : ""} matched to your products`
                      : "Select distributors to push this deal to"}
                  </p>
                </div>
                <div className="p-4 space-y-2">
                  {ALL_TSDS.map(tsd => {
                    const matched  = tsdMatches.some(m => m.id === tsd.id);
                    const selected = selectedTsds.includes(tsd.id);
                    return (
                      <label
                        key={tsd.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                          selected ? "border-[#0176d3] bg-[#f0f7ff]" : "border-[#e5e7eb] hover:bg-[#f9fafb]"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleTsd(tsd.id)}
                          className="w-4 h-4 rounded text-[#0176d3] focus:ring-[#0176d3]"
                        />
                        <div className="flex-1">
                          <p className="font-semibold text-sm">{tsd.label}</p>
                          <p className={`text-xs ${matched ? "text-[#0176d3]" : "text-muted-foreground"}`}>
                            {matched ? "Recommended — carries your selected products" : "Not matched to your products"}
                          </p>
                        </div>
                        {matched && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#0176d3]/10 text-[#0176d3] text-[10px] font-semibold rounded-full">
                            <CheckCircle className="w-2.5 h-2.5" /> Matched
                          </span>
                        )}
                      </label>
                    );
                  })}
                  {selectedTsds.length === 0 && (
                    <p className="text-xs text-muted-foreground italic pt-1">No distributors selected — deal will be saved locally. You can route it later.</p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer navigation */}
        <div className="px-6 py-4 border-t border-[#e5e7eb] bg-[#f9fafb] flex justify-between items-center">
          <div>
            {currentIdx > 0 && (
              <button type="button" onClick={goBack} className="sf-btn sf-btn-neutral flex items-center gap-1.5">
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Step {currentIdx + 1} of {WIZARD_STEPS.length}</span>
            <button type="button" onClick={onClose} className="sf-btn sf-btn-neutral">Cancel</button>
            {step === "deal-info" && (
              <button type="submit" form="wizard-form" className="sf-btn sf-btn-primary">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            {step === "vendors" && (
              <button type="button" onClick={handleVendorsNext} className="sf-btn sf-btn-primary">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
            {step === "products" && (
              <button type="button" onClick={handleProductsNext} disabled={isResolving} className="sf-btn sf-btn-primary">
                {isResolving ? "Loading..." : <><span>Next</span> <ChevronRight className="w-3.5 h-3.5" /></>}
              </button>
            )}
            {step === "review" && (
              <button type="button" onClick={handleSubmit} disabled={isPending} className="sf-btn sf-btn-primary">
                {isPending ? "Submitting..." : "Submit Deal"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PipelineStageMover({ deal, pipeline }: { deal: Deal; pipeline: CrmPipeline }) {
  const queryClient = useQueryClient();
  const sortedStages = [...pipeline.stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const move = useMutation({
    mutationFn: async (stageId: number | null) => {
      const res = await fetch(`/api/admin/crm/deals/${deal.id}/pipeline-stage`, {
        method: "PATCH",
        headers: getAuthHeaders(),
        body: JSON.stringify({ pipelineStageId: stageId }),
      });
      if (!res.ok) throw new Error("Failed to move deal");
      return res.json();
    },
    onSuccess: () => {
      // Invalidate both keys so the kanban refreshes regardless of which
      // session shape is viewing it (admin uses /admin/crm/deals, partner
      // uses /partner/deals — see useDeals()).
      queryClient.invalidateQueries({ queryKey: ["/api/partner/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/deals"] });
    },
  });
  const current = deal.pipelineStageId ?? "";
  return (
    <select
      value={current === "" ? "" : String(current)}
      onChange={(e) => {
        const v = e.target.value;
        move.mutate(v === "" ? null : Number(v));
      }}
      disabled={move.isPending}
      className="w-full text-[11px] border border-[#dddbda] rounded px-1.5 py-0.5 bg-white"
      aria-label={`Move deal "${deal.title}" to a different stage`}
    >
      <option value="">— Unassigned —</option>
      {sortedStages.map(s => (
        <option key={s.id} value={String(s.id)}>{s.name}</option>
      ))}
    </select>
  );
}
