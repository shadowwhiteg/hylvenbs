import { Suspense } from "react";
import { SettingsClient } from "@/components/SettingsClient";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="muted">Carregando...</div>}>
      <SettingsClient />
    </Suspense>
  );
}
