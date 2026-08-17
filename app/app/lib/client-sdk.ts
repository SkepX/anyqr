"use client";
import type { TxSignBuilder } from "@lucid-evolution/lucid";
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

type BuiltClient = Awaited<ReturnType<typeof buildClient>>;

/** Sign + submit a prepared tx through a freshly validated wallet handle.
 *
 *  The build phase runs 30s+ with zero wallet traffic — long enough for
 *  Chrome to idle-kill the wallet extension's service worker, which
 *  permanently invalidates the CIP-30 handle the Lucid client was built
 *  with ("RemoteApiShutdownError ... object can no longer be used").
 *  Lucid captures the wallet per-TxSignBuilder at creation, so a stale
 *  handle inside `prepared` can't just be swapped. Instead: fetch a
 *  live handle (getApi probes and re-enables only if the channel died),
 *  re-select it on the Lucid instance, and re-wrap the built tx via
 *  fromTx() — which binds sign AND submit to the current wallet. */
export async function signAndSubmitPrepared(
  client: BuiltClient,
  prepared: TxSignBuilder,
  getLiveApi: () => Promise<Cip30Api | null>,
): Promise<string> {
  const lucid = client.cfg.lucid;
  const live = await getLiveApi();
  if (live) {
    lucid.selectWallet.fromAPI(
      live as unknown as Parameters<typeof lucid.selectWallet.fromAPI>[0],
    );
  }
  const rebound = lucid.fromTx(prepared.toCBOR());
  const signed = await rebound.sign.withWallet().complete();
  // Submit through our own Blockfrost provider — the same instance the
  // tx was built against — instead of the wallet's backend. The wallet
  // submits via a different node that can lag a block behind Blockfrost
  // and reject just-created inputs as "unknown UTxO references" (code
  // 3117). That same skew can still race Blockfrost's own node, so
  // retry the transient case a few times before giving up.
  const provider = lucid.config().provider;
  if (!provider) return signed.submit();
  const cbor = signed.toCBOR();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      return await provider.submitTx(cbor);
    } catch (e) {
      lastErr = e;
      const msg = String((e as { message?: string })?.message ?? e);
      const transient = /3117|unknown UTxO|Could not submit transaction/i.test(msg);
      if (!transient || attempt === 5) throw e;
      console.warn(
        `[submit] node hasn't seen our inputs yet (attempt ${attempt}/5) — retrying in 4s`,
      );
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  throw lastErr;
}
