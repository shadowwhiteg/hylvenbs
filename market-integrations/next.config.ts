import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
