import * as React from "react";
import { Popover as P } from "radix-ui";
import { cn } from "@/lib/utils";
const Popover = P.Root;
const PopoverTrigger = P.Trigger;
function PopoverContent({ className, align = "end", sideOffset = 6, ...props }: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content align={align} sideOffset={sideOffset} className={cn("z-50 w-80 rounded-lg border bg-popover p-3 text-popover-foreground shadow-[0_8px_24px_-8px_rgba(28,34,48,.3)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0", className)} {...props} />
    </P.Portal>
  );
}
export { Popover, PopoverTrigger, PopoverContent };
