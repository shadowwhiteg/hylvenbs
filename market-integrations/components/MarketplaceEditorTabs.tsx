"use client";

import { useState, type ReactNode } from "react";

export function MarketplaceEditorTabs({ ml, shopee }: { ml: ReactNode; shopee: ReactNode }) {
  const [tab, setTab] = useState<"ml" | "shopee">("ml");

  return (
    <div>
      <div className="toolbar" style={{ marginBottom: "1rem" }}>
        <button
          className={`btn ${tab === "ml" ? "btn-primary" : ""}`}
          onClick={() => setTab("ml")}
          type="button"
        >
          Mercado Livre
        </button>
        <button
          className={`btn ${tab === "shopee" ? "btn-primary" : ""}`}
          onClick={() => setTab("shopee")}
          type="button"
        >
          Shopee
        </button>
      </div>
      <div style={{ display: tab === "ml" ? "block" : "none" }}>{ml}</div>
      <div style={{ display: tab === "shopee" ? "block" : "none" }}>{shopee}</div>
    </div>
  );
}
