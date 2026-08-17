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
  // Coin-select from Blockfrost's CONFIRMED view, not the wallet's
  // optimistic one. Lace's getUtxos() includes change from txs still in
  // the mempool; building on a not-yet-confirmed output gets rejected
  // with BadInputsUTxO by any node that hasn't seen the parent tx.
  try {
    const addr = await lucid.wallet().address();
    const confirmed = await lucid.utxosAt(addr);
    if (confirmed.length > 0) lucid.overrideUTxOs(confirmed);
  } catch {
    // Blockfrost hiccup — fall back to the wallet's own UTxO view.
  }
  return createClient({
    lucid,
    validator: cfg.validator,
    usdc: cfg.usdc,
    adminPkh: cfg.adminPkh,
  });
}

type BuiltClient = Awaited<ReturnType<typeof buildClient>>;

// One wallet signs one tx at a time. Two flows building concurrently (a
// user click racing the auto-complete timer) select from the same UTxO
// snapshot — the first submit consumes it and the second dies on
// BadInputsUTxO. The lock serializes build+sign+submit per tab.
let txChain: Promise<unknown> = Promise.resolve();
export function withTxLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = txChain.then(fn, fn);
  txChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Append work to the tx queue WITHOUT making the current caller wait.
 *  Used to hold the queue until a just-submitted tx confirms: mempool
 *  chaining is unreliable across Blockfrost's load-balanced nodes, so
 *  the next tx must not build until this one is in a block. */
function extendTxLock(fn: () => Promise<unknown>): void {
  txChain = txChain.then(fn, fn).then(
    () => undefined,
    () => undefined,
  );
}

/** Ledger rejections meaning the tx was built against a UTxO view that
 *  a just-submitted tx has already invalidated (spent inputs, cascading
 *  collateral/value complaints). A fresh rebuild after ~1 block fixes
 *  these; anything else is a real error. */
const STALE_UTXO_RE =
  /BadInputsUTxO|TranslationLogicMissingInput|ValueNotConservedUTxO|InsufficientCollateral|CollateralContainsNonADA|NoCollateralInputs|IncorrectTotalCollateralField/i;
export function isStaleUtxoError(e: unknown): boolean {
  const msg = String((e as { message?: string })?.message ?? e);
  return STALE_UTXO_RE.test(msg);
}

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
  // The signed tx stays valid until its TTL, and resubmitting the SAME
  // cbor needs no new signature. So on any stale-view rejection (a node
  // that hasn't caught up to our inputs' block — either error dialect,
  // including collateral/value cascades) keep resubmitting until it
  // lands. Only give up — which sends the caller to a rebuild and a
  // fresh signature — when the tx expires, the error is a real one, or
  // 4 minutes pass.
  const ttlRaw = signed.toTransaction().body().ttl();
  const ttlSlot = ttlRaw === undefined ? Number.POSITIVE_INFINITY : Number(ttlRaw);
  const giveUpAt = Date.now() + 240_000;
  for (let attempt = 1; ; attempt++) {
    try {
      const hash = await provider.submitTx(cbor);
      // Hold the tx queue (not this caller) until the tx lands in a
      // block, so the next build sees its inputs spent and its change
      // available. Cap the wait so a Blockfrost outage can't wedge the
      // queue forever.
      extendTxLock(() =>
        Promise.race([
          lucid.awaitTx(hash, 3_000),
          new Promise((r) => setTimeout(r, 120_000)),
        ]),
      );
      return hash;
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      const transient =
        isStaleUtxoError(e) ||
        /3117|unknown UTxO|Could not submit transaction/i.test(msg);
      const expired = lucid.currentSlot() > ttlSlot - 2;
      if (!transient || expired || Date.now() > giveUpAt) throw e;
      const delay = Math.min(5_000 * attempt, 15_000);
      console.warn(
        `[submit] node view stale (attempt ${attempt}) — resubmitting same signed tx in ${delay / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
