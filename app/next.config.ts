import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
