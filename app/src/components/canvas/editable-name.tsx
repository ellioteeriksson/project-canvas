import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Double-click to rename. Enter saves, Escape cancels. */
export function EditableName({ value, onSave, onClick, className, inputClassName }: { value: string; onSave: (v: string) => void; onClick?: () => void; className?: string; inputClassName?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => { if (editing) ref.current?.select(); }, [editing]);
  if (!editing)
    return (
      <span className={cn("truncate", className)} onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined} onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }} title="Double-click to rename">
        {value}
      </span>
    );
  const commit = () => { setEditing(false); const v = draft.trim(); if (v && v !== value) onSave(v); else setDraft(value); };
  return (
    <input
      ref={ref}
      aria-label="View name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit();
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
      className={cn("nodrag min-w-0 flex-1 rounded-sm bg-background px-1 outline-2 outline-ring", inputClassName)}
    />
  );
}
