import * as React from "react";
import { ToggleGroup as TG } from "radix-ui";
import { cn } from "@/lib/utils";
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return <TG.Root className={cn("inline-flex items-center rounded-[8px] bg-segment p-[2px]", className)} {...props} />;
}
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
      className={cn("inline-flex h-6 min-w-7 items-center justify-center gap-1.5 rounded-[6px] px-1.5 text-xs font-medium text-muted-foreground transition-[color,background-color,box-shadow] duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-soft-sm dark:data-[state=on]:bg-[#636366] [&_svg]:shrink-0", className)}
      {...props}
    />
  );
}
export { ToggleGroup, ToggleGroupItem };
