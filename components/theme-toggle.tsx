"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-1 rounded-full border border-border/70 bg-card/40 px-2 text-muted-foreground transition-colors",
        "hover:bg-card/70 hover:text-foreground",
        className
      )}
      title={label}
    >
      <Sun
        aria-hidden="true"
        className={cn(
          "hidden size-3.5 transition-colors sm:block",
          !isDark && "text-foreground"
        )}
      />
      <Switch
        size="sm"
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label={label}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          "hidden size-3.5 transition-colors sm:block",
          isDark && "text-foreground"
        )}
      />
    </div>
  );
}
