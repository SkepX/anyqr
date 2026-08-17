"use client";
import type { Cip30Api } from "./wallet";

/** In-memory cache of the config fetched from /api/config. */
let _config: QrpayBrowserConfig | null = null;

export interface QrpayBrowserConfig {
  validator: { type: "PlutusV3"; script: string };
  usdc: { policyId: string; assetName: string };
  adminPkh: string;
  scriptAddress: string;
  network: "Preprod" | "Mainnet" | "Preview";
}

export async function fetchConfig(): Promise<QrpayBrowserConfig> {
  if (_config) return _config;
  const r = await fetch("/api/config");
  if (!r.ok) throw new Error("failed to load /api/config");
  _config = (await r.json()) as QrpayBrowserConfig;
  return _config;
}

/** Build a fully configured QrpayClient that signs with the given CIP-30 API. */
export async function buildClient(api: Cip30Api) {
  const cfg = await fetchConfig();
  const { Lucid, Blockfrost } = await import("@lucid-evolution/lucid");
  const { createClient } = await import("@qrpay/sdk");
  const key = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID;
  if (!key) throw new Error("NEXT_PUBLIC_BLOCKFROST_PROJECT_ID unset");
  const lucid = await Lucid(
    new Blockfrost("https://cardano-preprod.blockfrost.io/api/v0", key),
    cfg.network,
  );
  lucid.selectWallet.fromAPI(api);
  return createClient({
    lucid,
    validator: cfg.validator,
    usdc: cfg.usdc,
    adminPkh: cfg.adminPkh,
  });
}
