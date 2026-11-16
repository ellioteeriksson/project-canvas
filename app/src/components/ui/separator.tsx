import * as React from "react";
import { Separator as S } from "radix-ui";
import { cn } from "@/lib/utils";
function Separator({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof S.Root>) {
  return <S.Root orientation={orientation} className={cn("shrink-0 bg-border", orientation === "horizontal" ? "h-px w-full" : "h-5 w-px", className)} {...props} />;
}
export { Separator };
