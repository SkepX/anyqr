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
  const bfUrl = "https://cardano-preprod.blockfrost.io/api/v0";
  const lucid = await Lucid(new Blockfrost(bfUrl, key), cfg.network);

  // Monkey-patch provider.evaluateTx to call Blockfrost's simpler
  // /utils/txs/evaluate endpoint (raw CBOR body). The default
  // /utils/txs/evaluate/utxos endpoint returns
  // {"fault":{"string":"failed to decode payload from base64 or base16"}}
  // on Preprod for our Accept tx — Ogmios can't parse whatever Lucid
  // 0.4.34's provider is currently sending. The raw-body endpoint works.
  const provider = lucid.config().provider as {
    evaluateTx: (tx: string, extra?: unknown) => Promise<unknown>;
  };
  provider.evaluateTx = async (tx: string) => {
    console.log(`[eval] POST ${bfUrl}/utils/txs/evaluate (raw cbor ${tx.length / 2}B)`);
    const t0 = performance.now();
    const res = await fetch(`${bfUrl}/utils/txs/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/cbor", project_id: key },
      body: tx,
    });
    const body = await res.json();
    console.log(`[eval] ${res.status} in ${Math.round(performance.now() - t0)}ms`, body);
    if (!res.ok || body.fault) {
      throw new Error(
        `evaluate failed: ${JSON.stringify(body)}. Tx: ${tx.slice(0, 200)}…`,
      );
    }
    if (!body.result?.EvaluationResult) {
      throw new Error(`unexpected eval response: ${JSON.stringify(body)}`);
    }
    // Convert to the format Lucid expects (matches its own parser).
    return Object.entries(body.result.EvaluationResult).map(
      ([pointer, data]) => {
        const [pTag, pIndex] = pointer.split(":");
        const d = data as { memory: number; steps: number };
        const tagMap: Record<string, number> = {
          spend: 0,
          mint: 1,
          certificate: 2,
          withdrawal: 3,
        };
        return {
          redeemer_tag: tagMap[pTag] ?? 0,
          redeemer_index: Number(pIndex),
          ex_units: { mem: d.memory, steps: d.steps },
        };
      },
    );
  };

  lucid.selectWallet.fromAPI(
    api as unknown as Parameters<typeof lucid.selectWallet.fromAPI>[0],
  );
  return createClient({
    lucid,
    validator: cfg.validator,
    usdc: cfg.usdc,
    adminPkh: cfg.adminPkh,
  });
}
