import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Trash2, ChevronUp, ChevronDown, Pencil, Check, X } from "lucide-react";
import { crmFetch } from "./lib";

type Pipeline = { id: number; name: string; description: string | null; isDefault: boolean; sortOrder: number };
type Stage = { id: number; pipelineId: number; name: string; slug: string; sortOrder: number; isWon: boolean; isLost: boolean; color: string | null };
type Tag = { id: number; name: string; color: string };
type CustomField = { id: number; entity: string; label: string; key: string; type: string; options: any };

export default function CrmSettings() {
  return (
    <PortalLayout>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">CRM Settings</h1>
          <p className="text-sm text-muted-foreground">Customise pipelines, tags, and custom fields</p>
        </div>
        <PipelinesCard />
        <TagsCard />
        <CustomFieldsCard />
      </div>
    </PortalLayout>
  );
}

function PipelinesCard() {
  const qc = useQueryClient();
  const { data } = useQuery<{ pipelines: Pipeline[]; stages: Stage[] }>({
    queryKey: ["crm", "pipelines"],
    queryFn: () => crmFetch("/admin/crm/pipelines"),
  });
  const [newPipeline, setNewPipeline] = useState("");
  const addPipeline = useMutation({
    mutationFn: () => crmFetch("/admin/crm/pipelines", { method: "POST", body: JSON.stringify({ name: newPipeline }) }),
    onSuccess: () => { setNewPipeline(""); qc.invalidateQueries({ queryKey: ["crm", "pipelines"] }); },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Pipelines</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="New pipeline name" value={newPipeline} onChange={(e) => setNewPipeline(e.target.value)} className="max-w-sm" />
          <Button onClick={() => addPipeline.mutate()} disabled={!newPipeline || addPipeline.isPending}><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </div>
        {(data?.pipelines ?? []).map(p => {
          const stages = (data?.stages ?? []).filter(s => s.pipelineId === p.id);
          return <PipelineRow key={p.id} pipeline={p} stages={stages} />;
        })}
      </CardContent>
    </Card>
  );
}

function PipelineRow({ pipeline, stages }: { pipeline: Pipeline; stages: Stage[] }) {
  const qc = useQueryClient();
  const [newStage, setNewStage] = useState("");
  const [editingPipeline, setEditingPipeline] = useState(false);
  const [pipelineName, setPipelineName] = useState(pipeline.name);
  const sorted = [...stages].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const renamePipeline = useMutation({
    mutationFn: () => crmFetch(`/admin/crm/pipelines/${pipeline.id}`, { method: "PUT", body: JSON.stringify({ name: pipelineName }) }),
    onSuccess: () => { setEditingPipeline(false); qc.invalidateQueries({ queryKey: ["crm", "pipelines"] }); },
  });
  const addStage = useMutation({
    mutationFn: () => crmFetch(`/admin/crm/pipelines/${pipeline.id}/stages`, { method: "POST", body: JSON.stringify({ name: newStage, sortOrder: sorted.length }) }),
    onSuccess: () => { setNewStage(""); qc.invalidateQueries({ queryKey: ["crm", "pipelines"] }); },
  });
  const removeStage = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/pipelines/${pipeline.id}/stages/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "pipelines"] }),
  });
  const updateStage = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      crmFetch(`/admin/crm/pipelines/${pipeline.id}/stages/${id}`, { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "pipelines"] }),
  });

  // Reorder by swapping sortOrder values with the neighbor.
  const moveStage = (idx: number, dir: -1 | 1) => {
    const a = sorted[idx], b = sorted[idx + dir];
    if (!a || !b) return;
    updateStage.mutate({ id: a.id, body: { sortOrder: b.sortOrder ?? idx + dir } });
    updateStage.mutate({ id: b.id, body: { sortOrder: a.sortOrder ?? idx } });
  };

  return (
    <div className="border rounded p-3">
      <div className="flex items-center justify-between mb-3">
        {editingPipeline ? (
          <div className="flex gap-1 items-center">
            <Input value={pipelineName} onChange={(e) => setPipelineName(e.target.value)} className="h-8 text-sm max-w-xs" />
            <Button size="sm" onClick={() => renamePipeline.mutate()} disabled={!pipelineName || renamePipeline.isPending}><Check className="w-3.5 h-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditingPipeline(false); setPipelineName(pipeline.name); }}><X className="w-3.5 h-3.5" /></Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-medium">{pipeline.name}</span>
            {pipeline.isDefault && <span className="text-xs text-muted-foreground">(default)</span>}
            <button onClick={() => setEditingPipeline(true)} className="text-muted-foreground hover:text-foreground" aria-label="Rename pipeline"><Pencil className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </div>
      <ul className="divide-y border rounded bg-white mb-2">
        {sorted.map((s, idx) => (
          <StageRow key={s.id} stage={s} canUp={idx > 0} canDown={idx < sorted.length - 1}
            onUp={() => moveStage(idx, -1)} onDown={() => moveStage(idx, 1)}
            onRename={(name) => updateStage.mutate({ id: s.id, body: { name } })}
            onDelete={() => removeStage.mutate(s.id)} />
        ))}
        {sorted.length === 0 && <li className="p-3 text-xs text-muted-foreground text-center">No stages yet.</li>}
      </ul>
      <div className="flex gap-2">
        <Input placeholder="Add a stage…" value={newStage} onChange={(e) => setNewStage(e.target.value)} className="max-w-xs h-8 text-xs" />
        <Button size="sm" onClick={() => addStage.mutate()} disabled={!newStage}>Add</Button>
      </div>
    </div>
  );
}

function StageRow({ stage, canUp, canDown, onUp, onDown, onRename, onDelete }: {
  stage: Stage; canUp: boolean; canDown: boolean;
  onUp: () => void; onDown: () => void; onRename: (name: string) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  return (
    <li className={`flex items-center gap-2 p-2 ${stage.isWon ? "bg-green-50" : stage.isLost ? "bg-red-50" : ""}`}>
      <div className="flex flex-col">
        <button disabled={!canUp} onClick={onUp} className="text-muted-foreground disabled:opacity-30 hover:text-foreground" aria-label="Move up"><ChevronUp className="w-3 h-3" /></button>
        <button disabled={!canDown} onClick={onDown} className="text-muted-foreground disabled:opacity-30 hover:text-foreground" aria-label="Move down"><ChevronDown className="w-3 h-3" /></button>
      </div>
      {editing ? (
        <>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs flex-1" />
          <Button size="sm" onClick={() => { onRename(name); setEditing(false); }} disabled={!name}><Check className="w-3 h-3" /></Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(stage.name); }}><X className="w-3 h-3" /></Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm">{stage.name}</span>
          <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-foreground" aria-label="Rename"><Pencil className="w-3.5 h-3.5" /></button>
          <button onClick={onDelete} className="text-muted-foreground hover:text-red-500" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
        </>
      )}
    </li>
  );
}

function TagsCard() {
  const qc = useQueryClient();
  const { data } = useQuery<{ rows: Tag[] }>({ queryKey: ["crm", "tags"], queryFn: () => crmFetch("/admin/crm/tags") });
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0176d3");
  const add = useMutation({
    mutationFn: () => crmFetch("/admin/crm/tags", { method: "POST", body: JSON.stringify({ name, color }) }),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["crm", "tags"] }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "tags"] }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Tags</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <Input placeholder="Tag name" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-9 w-12 border rounded" />
          <Button onClick={() => add.mutate()} disabled={!name || add.isPending}>Add</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(data?.rows ?? []).map(t => (
            <span key={t.id} className="text-xs px-2 py-1 rounded border flex items-center gap-2" style={{ borderColor: t.color, color: t.color }}>
              {t.name}
              <button onClick={() => del.mutate(t.id)}><Trash2 className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CustomFieldsCard() {
  const qc = useQueryClient();
  const [entity, setEntity] = useState<"contact" | "company" | "deal">("contact");
  const { data } = useQuery<{ rows: CustomField[] }>({
    queryKey: ["crm", "fields", entity],
    queryFn: () => crmFetch(`/admin/crm/custom-fields?entity=${entity}`),
  });
  const [form, setForm] = useState({ label: "", key: "", type: "text" });
  const add = useMutation({
    mutationFn: () => crmFetch("/admin/crm/custom-fields", { method: "POST", body: JSON.stringify({ entity, ...form }) }),
    onSuccess: () => { setForm({ label: "", key: "", type: "text" }); qc.invalidateQueries({ queryKey: ["crm", "fields"] }); },
  });
  const del = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/custom-fields/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm", "fields"] }),
  });
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Custom Fields</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center">
          <select value={entity} onChange={(e) => setEntity(e.target.value as "contact" | "company" | "deal")} className="border rounded px-2 py-1.5 text-sm">
            <option value="contact">Contact</option><option value="company">Company</option><option value="deal">Deal</option>
          </select>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <Input placeholder="Key (snake_case)" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="border rounded px-2 py-1.5 text-sm">
            <option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="select">Select</option>
          </select>
          <Button onClick={() => add.mutate()} disabled={!form.label || !form.key || add.isPending}>Add</Button>
        </div>
        <ul className="border rounded divide-y bg-white">
          {(data?.rows ?? []).map(f => (
            <li key={f.id} className="flex items-center justify-between p-2 text-sm">
              <span>{f.label} <span className="text-xs text-muted-foreground">({f.key} · {f.type})</span></span>
              <button onClick={() => del.mutate(f.id)}><Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" /></button>
            </li>
          ))}
          {(data?.rows.length ?? 0) === 0 && <li className="p-3 text-sm text-muted-foreground text-center">No custom fields yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
