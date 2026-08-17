"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { API_ENDPOINTS } from "@/lib/api-registry";
import { PageHeader } from "@/components/page-header";
import { Badge, Button, Card, CardHeader } from "@/components/ui";

const METHOD_TONE = {
  GET: "success",
  POST: "accent",
  PATCH: "warning",
  PUT: "warning",
  DELETE: "danger",
} as const;

export default function ApiPage() {
  const [copied, setCopied] = useState(false);

  const groups = [...new Set(API_ENDPOINTS.map((e) => e.group))];

  async function copyCollection() {
    const res = await fetch("/api/postman/collection");
    await navigator.clipboard.writeText(await res.text());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <PageHeader
        title="API & Postman"
        description="Toda a plataforma é controlável por HTTP. Exporte a collection e automatize de fora."
        action={
          <>
            <Button onClick={copyCollection}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copiado" : "Copiar JSON"}
            </Button>
            <a href="/api/postman/collection" download>
              <Button variant="primary">
                <Download className="size-4" /> Baixar collection
              </Button>
            </a>
          </>
        }
      />

      <div className="space-y-4 p-8">
        <Card>
          <CardHeader title="Como importar" />
          <ol className="list-inside list-decimal space-y-1.5 p-5 text-sm text-fg-muted">
            <li>Baixe a collection e importe no Postman (File → Import).</li>
            <li>
              Ajuste a variável <code className="font-mono text-accent">baseUrl</code> se não estiver em{" "}
              <code className="font-mono">http://localhost:3000</code>.
            </li>
            <li>
              Preencha <code className="font-mono text-accent">provider_id</code>,{" "}
              <code className="font-mono text-accent">agent_id</code> e{" "}
              <code className="font-mono text-accent">mcp_server_id</code> nas variáveis da collection.
            </li>
          </ol>
        </Card>

        {groups.map((group) => (
          <Card key={group}>
            <CardHeader title={group} />
            <ul className="divide-y divide-border">
              {API_ENDPOINTS.filter((e) => e.group === group).map((endpoint) => (
                <li key={`${endpoint.method}-${endpoint.path}`} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={METHOD_TONE[endpoint.method]}>{endpoint.method}</Badge>
                    <code className="font-mono text-xs">{endpoint.path}</code>
                    <span className="text-sm font-medium">{endpoint.name}</span>
                  </div>
                  <p className="mt-1 text-xs text-fg-muted">{endpoint.description}</p>
                  {endpoint.body ? (
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-bg-subtle p-3 font-mono text-[11px]">
                      {JSON.stringify(endpoint.body, null, 2)}
                    </pre>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
