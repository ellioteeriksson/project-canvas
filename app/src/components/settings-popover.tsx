import { useEffect, useState } from "react";
import { GearSix, ArrowsClockwise, ArrowCounterClockwise, Images } from "@phosphor-icons/react";
import type { Manifest } from "@/lib/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

const FRAMEWORKS = ["auto", "next", "react-router", "tanstack", "astro", "html"];

export function SettingsPopover({ manifest }: { manifest: Manifest }) {
  const [devUrl, setDevUrl] = useState(manifest.devUrl);
  const [preview, setPreview] = useState(manifest.previewRoute ?? "");
  useEffect(() => setDevUrl(manifest.devUrl), [manifest.devUrl]);
  useEffect(() => setPreview(manifest.previewRoute ?? ""), [manifest.previewRoute]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Project settings"><GearSix size={17} /></Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-80 flex-col gap-3">
        <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); api.config({ devUrl }); }}>
          <label htmlFor="dev-url" className="text-[13px] font-medium">Dev server URL</label>
          <div className="flex gap-1.5">
            <Input id="dev-url" value={devUrl} onChange={(e) => setDevUrl(e.target.value)} className="font-mono text-[12px]" />
            <Button type="submit" variant="outline">Save</Button>
          </div>
          <p className="text-xs text-muted-foreground">Frames load each route from here.</p>
        </form>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="fw" className="text-[13px] font-medium">Framework</label>
          <select
            id="fw"
            defaultValue="auto"
            onChange={(e) => api.config({ framework: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FRAMEWORKS.map((f) => <option key={f} value={f}>{f === "auto" ? `Detect automatically (${manifest.project.framework})` : f}</option>)}
          </select>
        </div>
        <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); api.config({ previewRoute: preview || null }); }}>
          <label htmlFor="pv" className="text-[13px] font-medium">Component preview route</label>
          <div className="flex gap-1.5">
            <Input id="pv" value={preview} placeholder="/__canvas" onChange={(e) => setPreview(e.target.value)} className="font-mono text-[12px]" />
            <Button type="submit" variant="outline">Save</Button>
          </div>
        </form>
        <Separator />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => api.refreshSnapshots()}><Images size={14} /> Refresh snapshots</Button>
          <Button variant="outline" size="sm" onClick={() => api.rescan()}><ArrowsClockwise size={14} /> Rescan project</Button>
          <Button variant="outline" size="sm" onClick={() => api.config({ positions: { ...manifest.positions, [manifest.mode]: {}, [`${manifest.mode}-full`]: {} } })}>
            <ArrowCounterClockwise size={14} /> Reset layout
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Snapshots refresh by themselves when files change. Use Refresh snapshots after content changes outside the code, like CMS edits. Settings are saved to <span className="font-mono">.canvas/config.json</span>. Commit it so your team gets the same names and layout.
        </p>
      </PopoverContent>
    </Popover>
  );
}
