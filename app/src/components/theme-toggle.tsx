import { Sun, Moon, Desktop, Check } from "@phosphor-icons/react";
import { useTheme, type ThemePref } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const OPTIONS: { value: ThemePref; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Match system", icon: Desktop },
];

export function ThemeToggle() {
  const [pref, setPref] = useTheme();
  const Current = pref === "dark" ? Moon : pref === "light" ? Sun : Desktop;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Canvas theme: ${OPTIONS.find((o) => o.value === pref)?.label}`}>
          <Current size={17} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onSelect={() => setPref(o.value)}>
            <o.icon size={15} /> {o.label}
            {pref === o.value && <Check size={14} className="ml-auto !text-foreground" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
