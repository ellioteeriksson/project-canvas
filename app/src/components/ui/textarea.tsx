import * as React from "react";
import { cn } from "@/lib/utils";
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea className={cn("flex min-h-20 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:border-ring disabled:opacity-50", className)} {...props} />;
}
export { Textarea };
