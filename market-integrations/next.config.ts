import type { NextConfig } from "next";

// O app é servido como subpágina de hylvenbs.xyz, em /market-integrations.
// Em dev fica vazio para continuar acessível em http://localhost:3000/.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath,
  assetPrefix: basePath || undefined,
  // Permite assets/HMR via IP da LAN e Cloudflare Quick Tunnel
  allowedDevOrigins: [
    "10.131.24.6",
    "*.trycloudflare.com",
    "localhost",
    "127.0.0.1",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
  },
};

export default nextConfig;
