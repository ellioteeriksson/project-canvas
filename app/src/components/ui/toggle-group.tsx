import * as React from "react";
import { ToggleGroup as TG } from "radix-ui";
import { cn } from "@/lib/utils";
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof TG.Root>) {
  return <TG.Root className={cn("inline-flex items-center rounded-md border border-input bg-background p-0.5", className)} {...props} />;
}
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof TG.Item>) {
  return (
    <TG.Item
      className={cn("inline-flex h-6 items-center justify-center gap-1.5 rounded-[5px] px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-secondary data-[state=on]:text-foreground [&_svg]:shrink-0", className)}
      {...props}
    />
  );
}
export { ToggleGroup, ToggleGroupItem };
