import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";

const links = [
  { href: "/", label: "Antigo Catálogo" },
  { href: "/anuncios-ml-2", label: "Anúncios ML" },
  { href: "/anuncios-shopee-2", label: "Anúncios Shopee" },
  { href: "/kits", label: "Kits" },
  { href: "/publish", label: "Publicações" },
  { href: "/agent", label: "Agente" },
  { href: "/settings", label: "Configurações" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">ML Drop Publisher</div>
        <p className="sidebar-sub">Meu Drop → Mercado Livre</p>
        <nav className="nav">
          {links.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="topbar">
        <ThemeToggle />
      </div>
      <main className="main">{children}</main>
    </div>
  );
}
