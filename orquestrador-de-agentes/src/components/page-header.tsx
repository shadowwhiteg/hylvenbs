"use client";

import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TUTORIAL_STEPS } from "@/lib/tutorial/content";

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  const pathname = usePathname();
  // Atalho contextual (RQ-TUT-06): a primeira tela que este passo aponta é onde o
  // atalho aparece. Mais de um passo pode apontar pra mesma tela (ex. /agents) —
  // fica o primeiro na ordem de dependência, que é o que o usuário provavelmente quer.
  const step = pathname !== "/tutorial" ? TUTORIAL_STEPS.find((s) => s.screen.href === pathname) : undefined;

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/85 px-8 py-5 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {step ? (
              <Link
                href={`/tutorial#${step.id}`}
                title={`Ver no tutorial: ${step.title}`}
                className="text-fg-muted transition hover:text-accent"
              >
                <GraduationCap className="size-4" />
              </Link>
            ) : null}
          </div>
          {description ? <p className="mt-0.5 text-sm text-fg-muted">{description}</p> : null}
        </div>
        {action ? <div className="flex items-center gap-2">{action}</div> : null}
      </div>
    </header>
  );
}
