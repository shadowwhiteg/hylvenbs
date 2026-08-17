import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { Providers } from "@/components/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orquestrador de Agentes",
  description: "Plataforma de desenvolvimento e gerenciamento de orquestradores de agentes e subagentes.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
