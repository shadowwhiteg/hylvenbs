"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
    </ThemeProvider>
  );
}

const OPTIONS = [
  { value: "light", icon: Sun, label: "Claro" },
  { value: "dark", icon: Moon, label: "Escuro" },
  { value: "system", icon: Monitor, label: "Sistema" },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          title={`Tema ${label.toLowerCase()}`}
          aria-label={`Tema ${label.toLowerCase()}`}
          aria-pressed={mounted && theme === value}
          onClick={() => setTheme(value)}
          className={clsx(
            "rounded-md p-1.5 transition",
            mounted && theme === value
              ? "bg-accent-soft text-accent"
              : "text-fg-muted hover:bg-surface-hover hover:text-fg",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
