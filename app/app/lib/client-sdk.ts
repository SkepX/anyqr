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

/** Build a fully configured QrpayClient that signs with the given CIP-30 API.
 *  `minFreeAda` preflights the wallet's spendable tADA: script spends need
 *  fees + 5 tADA collateral + min-ADA on outputs, and a wallet below that
 *  produces endless inscrutable ledger rejections. */
export async function buildClient(api: Cip30Api, minFreeAda = 3) {
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
  const utxos = await lucid.wallet().getUtxos();
  let lovelace = BigInt(0);
  for (const u of utxos) lovelace += u.assets.lovelace ?? BigInt(0);
  const ada = Number(lovelace) / 1e6;
  if (ada < minFreeAda)
    throw new Error(
      `Wallet has only ${ada.toFixed(2)} tADA. This action needs about ${minFreeAda}+ tADA free for network fees${minFreeAda >= 8 ? " and 5 tADA collateral" : ""} — top up tADA and retry.`,
    );
  return createClient({
    lucid,
    validator: cfg.validator,
    usdc: cfg.usdc,
    adminPkh: cfg.adminPkh,
  });
}

type BuiltClient = Awaited<ReturnType<typeof buildClient>>;

/** Every awaited network/wallet step gets a hard deadline — a stalled
 *  connection (a sick Blockfrost node holding the socket open, a wedged
 *  wallet promise) must become a catchable error, never a silent
 *  forever-spinner. */
function withStepTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms / 1000}s`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

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
  console.log("[submit] requesting wallet signature");
  const signed = await withStepTimeout(
    rebound.sign.withWallet().complete(),
    120_000,
    "wallet signature",
  );
  console.log("[submit] tx signed");
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
  // Hold the tx queue (not the caller) until the tx lands in a block,
  // so the next build sees its inputs spent and its change available.
  // Capped so an outage can't wedge the queue forever.
  const holdQueueUntilConfirmed = (hash: string) =>
    extendTxLock(() =>
      Promise.race([
        lucid.awaitTx(hash, 3_000),
        new Promise((r) => setTimeout(r, 120_000)),
      ]),
    );
  // "Node doesn't know these inputs" in either dialect. Individual
  // Blockfrost submit nodes have been observed MINUTES behind their own
  // query API (session-sticky LB), so a rejection from one door says
  // nothing about the other.
  const isMissingInputMsg = (m: string) =>
    /3117|unknown UTxO|BadInputsUTxO|TranslationLogicMissingInput|InsufficientCollateral|IncorrectTotalCollateralField|NoCollateralInputs|Could not submit transaction/i.test(
      m,
    );
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`[submit] via provider (attempt ${attempt})`);
      const hash = await withStepTimeout(
        provider.submitTx(cbor),
        20_000,
        "provider submit",
      );
      console.log(`[submit] provider accepted the tx`);
      holdQueueUntilConfirmed(hash);
      return hash;
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      const expired = lucid.currentSlot() > ttlSlot - 2;
      const retriable = isMissingInputMsg(msg) || /timed out/i.test(msg);
      if (!retriable || expired || Date.now() > giveUpAt) throw e;
      console.warn(
        `[submit] provider rejected/stalled (attempt ${attempt}):`,
        msg.slice(0, 260),
      );
      // Second, independent door to the mempool: the wallet's own
      // backend. Same signed cbor, no new signature. Whichever node is
      // actually current accepts the tx.
      try {
        console.log(`[submit] trying wallet path`);
        const hash = await withStepTimeout(
          signed.submit(),
          30_000,
          "wallet submit",
        );
        console.log(`[submit] wallet path accepted the tx`);
        holdQueueUntilConfirmed(hash);
        return hash;
      } catch (e2) {
        console.warn(
          `[submit] wallet path also failed:`,
          String((e2 as { message?: string })?.message ?? e2).slice(0, 200),
        );
      }
      const delay = Math.min(5_000 * attempt, 15_000);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
