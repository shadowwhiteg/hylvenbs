"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, Circle, ExternalLink, Lock } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Badge, Card, CardHeader, Spinner } from "@/components/ui";
import { can, useMe } from "@/lib/auth-client";
import { hasPermission, type Role } from "@/lib/auth/permissions";
import { TUTORIAL_STEPS } from "@/lib/tutorial/content";
import type { ProgressCheck } from "@/lib/tutorial/types";

const ROLE_ORDER: Role[] = ["viewer", "editor", "admin"];
const ROLE_LABEL: Record<Role, string> = { viewer: "leitor", editor: "editor", admin: "admin" };

/** Menor papel que já tem a permissão — só para explicar o bloqueio (D5), não para autorizar nada. */
function minRoleFor(permission: Parameters<typeof hasPermission>[1]): Role {
  return ROLE_ORDER.find((role) => hasPermission(role, permission)) ?? "admin";
}

export default function TutorialPage() {
  const { me } = useMe();
  const [checks, setChecks] = useState<Record<ProgressCheck, boolean> | null>(null);

  useEffect(() => {
    fetch("/api/tutorial/progress")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setChecks(data?.checks ?? null))
      .catch(() => setChecks(null));
  }, []);

  const isDone = (stepIndex: number) => {
    if (!checks) return false;
    const step = TUTORIAL_STEPS[stepIndex]!;
    return step.checks.every((c) => checks[c]);
  };

  const firstPendingIndex = checks ? TUTORIAL_STEPS.findIndex((_, i) => !isDone(i)) : -1;
  const doneCount = checks ? TUTORIAL_STEPS.filter((_, i) => isDone(i)).length : 0;

  return (
    <>
      <PageHeader
        title="Tutorial"
        description="O caminho completo da plataforma, na ordem em que cada peça depende da anterior."
        action={checks ? <Badge tone="accent">{doneCount}/{TUTORIAL_STEPS.length} concluídos</Badge> : null}
      />

      <div className="mx-auto max-w-3xl space-y-4 p-8">
        {TUTORIAL_STEPS.map((step, index) => {
          const done = isDone(index);
          const isNext = index === firstPendingIndex;
          const allowed = can(me, step.permission);

          return (
            <div key={step.id} id={step.id} className="scroll-mt-20">
              <Card className={clsx(isNext && "ring-2 ring-accent")}>
                <CardHeader
                  title={
                    <span className="flex items-center gap-2">
                      {done ? (
                        <CheckCircle2 className="size-4 shrink-0 text-success" />
                      ) : (
                        <Circle className="size-4 shrink-0 text-fg-muted" />
                      )}
                      {index + 1}. {step.title}
                      {isNext ? <Badge tone="accent">próximo passo</Badge> : null}
                    </span>
                  }
                  subtitle={step.goal}
                  action={
                    allowed ? (
                      <Link
                        href={step.screen.href}
                        className="flex items-center gap-1 text-xs text-accent hover:underline"
                      >
                        {step.screen.label} <ExternalLink className="size-3" />
                      </Link>
                    ) : (
                      <Badge tone="warning">
                        <Lock className="size-3" /> requer {ROLE_LABEL[minRoleFor(step.permission)]}
                      </Badge>
                    )
                  }
                />
                <div className="space-y-3 p-5 text-sm text-fg-muted">
                  {step.body.map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                  {step.pitfalls?.length ? (
                    <ul className="space-y-1 rounded-lg bg-bg-subtle p-3 text-xs">
                      {step.pitfalls.map((pitfall, i) => (
                        <li key={i}>⚠ {pitfall}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!allowed ? (
                    <p className="text-xs text-fg-muted">
                      Seu papel atual ({me ? ROLE_LABEL[me.role] : "…"}) não executa este passo — peça a um{" "}
                      {ROLE_LABEL[minRoleFor(step.permission)]} ou acima.
                    </p>
                  ) : null}
                </div>
              </Card>
            </div>
          );
        })}

        {!checks ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : null}
      </div>
    </>
  );
}
