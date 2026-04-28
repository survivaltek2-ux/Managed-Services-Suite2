import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Bookmark, Trash2 } from "lucide-react";
import { crmFetch } from "./lib";

type SavedView = {
  id: number;
  entity: string;
  name: string;
  filters: Record<string, unknown>;
  shared: boolean;
  ownerUserId: number;
};

export function SavedViewsBar({
  entity,
  current,
  onApply,
}: {
  entity: "contact" | "company" | "deal" | "lead" | "task" | "activity";
  current: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
}) {
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const { data, refetch } = useQuery<{ rows: SavedView[] }>({
    queryKey: ["crm", "saved-views", entity],
    queryFn: () => crmFetch(`/admin/crm/saved-views?entity=${entity}`),
  });
  const saveMut = useMutation({
    mutationFn: () =>
      crmFetch("/admin/crm/saved-views", {
        method: "POST",
        body: JSON.stringify({ entity, name, filters: current, shared }),
      }),
    onSuccess: () => {
      setShowSave(false); setName(""); setShared(false); refetch();
    },
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) => crmFetch(`/admin/crm/saved-views/${id}`, { method: "DELETE" }),
    onSuccess: () => refetch(),
  });

  const views = data?.rows ?? [];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Bookmark className="w-4 h-4 text-muted-foreground" />
      <span className="text-xs uppercase text-muted-foreground font-semibold tracking-wide">Saved Views:</span>
      {views.length === 0 && <span className="text-xs text-muted-foreground italic">None saved</span>}
      {views.map(v => (
        <div key={v.id} className="inline-flex items-center gap-1 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
          <button
            type="button"
            onClick={() => onApply(v.filters || {})}
            className="text-xs text-blue-700 hover:underline cursor-pointer"
            title={v.shared ? "Shared view" : "My view"}
          >
            {v.name}{v.shared ? " ★" : ""}
          </button>
          <button
            type="button"
            onClick={() => deleteMut.mutate(v.id)}
            className="text-blue-400 hover:text-red-600 cursor-pointer"
            title="Delete view"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      {!showSave ? (
        <Button variant="ghost" size="sm" onClick={() => setShowSave(true)} className="text-xs h-6">
          + Save current
        </Button>
      ) : (
        <div className="inline-flex items-center gap-1">
          <Input
            placeholder="View name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 text-xs w-40"
          />
          <label className="text-xs flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="w-3 h-3" />
            Share
          </label>
          <Button size="sm" disabled={!name.trim() || saveMut.isPending} onClick={() => saveMut.mutate()} className="h-7 text-xs">
            {saveMut.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowSave(false); setName(""); }} className="h-7 text-xs">
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
