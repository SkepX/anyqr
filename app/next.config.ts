import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Unique per build — /api/version serves it so open tabs can detect
    // a new deploy and reload themselves (CLI deploys don't set git SHAs).
    NEXT_PUBLIC_BUILD_AT: String(Date.now()),
  },
  serverExternalPackages: [
    "@lucid-evolution/lucid",
    "@lucid-evolution/utils",
    "@lucid-evolution/plutus",
    "@lucid-evolution/wallet",
    "@lucid-evolution/provider",
    "@anastasia-labs/cardano-multiplatform-lib-nodejs",
    "@qrpay/sdk",
  ],
};

export default nextConfig;
