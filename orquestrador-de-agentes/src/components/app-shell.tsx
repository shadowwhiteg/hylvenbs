"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Sidebar } from "@/components/nav";
import { useMe } from "@/lib/auth-client";

const NO_SHELL_PAGES = new Set(["/login", "/setup"]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading } = useMe();
  const noShell = NO_SHELL_PAGES.has(pathname);

  useEffect(() => {
    if (!loading && me?.mustChangePassword && pathname !== "/conta/senha" && !noShell) {
      router.replace("/conta/senha");
    }
  }, [loading, me, pathname, noShell, router]);

  if (noShell) return <main className="min-w-0 flex-1 bg-bg">{children}</main>;

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="min-w-0 flex-1 bg-bg">{children}</main>
    </div>
  );
}
