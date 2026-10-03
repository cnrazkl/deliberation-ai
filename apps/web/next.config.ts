import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.DELIBERATION_E2E === "1" ? ".next-e2e" : process.env.DELIBERATION_VERIFY_BUILD === "1" ? ".next-verify" : ".next",
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
