import * as React from "react";
import { ScrollArea as SA } from "radix-ui";
import { cn } from "@/lib/utils";
function ScrollArea({ className, children, ...props }: React.ComponentProps<typeof SA.Root>) {
  return (
    <SA.Root className={cn("relative overflow-hidden", className)} {...props}>
      <SA.Viewport className="size-full rounded-[inherit] [&>div]:!block">{children}</SA.Viewport>
      <SA.Scrollbar orientation="vertical" className="flex w-2 touch-none p-px select-none">
        <SA.Thumb className="relative flex-1 rounded-full bg-border" />
      </SA.Scrollbar>
    </SA.Root>
  );
}
export { ScrollArea };
