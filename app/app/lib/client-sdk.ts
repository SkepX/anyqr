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
  // MANDATORY — a silent fallback to the wallet view produced txs
  // spending phantom coins. Retry, then fail loud.
  await refreshWalletView(lucid);
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

/** (Re)load the wallet's CONFIRMED coins from Blockfrost into the Lucid
 *  instance. Must be called again right before building whenever time
 *  has passed since the client was created (e.g. after waiting for an
 *  order to index): with one wallet playing both roles, the buyer's
 *  place tx can spend a coin DURING that wait, and a build from the
 *  stale snapshot then references a permanently-consumed input that
 *  every node rejects. */
export async function refreshWalletView(
  lucid: BuiltClient["cfg"]["lucid"],
): Promise<void> {
  const addr = await lucid.wallet().address();
  for (let attempt = 1; ; attempt++) {
    try {
      const confirmed = await lucid.utxosAt(addr);
      if (confirmed.length > 0) lucid.overrideUTxOs(confirmed);
      else
        console.warn("[buildClient] confirmed wallet view is empty — using wallet's own view");
      return;
    } catch (e) {
      if (attempt >= 3)
        throw new Error(
          "Couldn't fetch your wallet's confirmed coins (chain API busy) — wait a few seconds and retry.",
        );
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

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
  // Some browser sessions have produced script txs whose serialized
  // body was MISSING the collateral return — every submit door rejects
  // those with CollateralContainsNonADA, while the identical build in
  // Node carries the field. Detect and repair BEFORE signing (the
  // repair changes the txid, so it must precede the signature).
  let unsignedCbor = prepared.toCBOR();
  try {
    const mod = (await import("@lucid-evolution/lucid")) as unknown as {
      CML: typeof import("@lucid-evolution/lucid").CML;
      assetsToValue: (assets: Record<string, bigint>) => unknown;
    };
    const { CML, assetsToValue } = mod;
    const parsed = CML.Transaction.from_cbor_hex(unsignedCbor);
    const body = parsed.body();
    const cols = body.collateral_inputs();
    if (cols && cols.len() > 0 && !body.collateral_return()) {
      console.warn(
        "[submit] built tx MISSING collateral_return — repairing before sign",
      );
      const walletUtxos = await lucid.wallet().getUtxos();
      const assets: Record<string, bigint> = {};
      for (let i = 0; i < cols.len(); i++) {
        const ci = cols.get(i);
        const id = ci.transaction_id().to_hex();
        const idx = Number(ci.index());
        const hit = walletUtxos.find(
          (u) => u.txHash === id && u.outputIndex === idx,
        );
        if (!hit) throw new Error("collateral input not in wallet view");
        for (const [unit, qty] of Object.entries(hit.assets))
          assets[unit] = (assets[unit] ?? BigInt(0)) + qty;
      }
      const totalCol = body.total_collateral() ?? BigInt(5_000_000);
      assets.lovelace = (assets.lovelace ?? BigInt(0)) - totalCol;
      const addr = await lucid.wallet().address();
      const out = CML.TransactionOutput.new(
        CML.Address.from_bech32(addr),
        assetsToValue(assets) as Parameters<typeof CML.TransactionOutput.new>[1],
      );
      body.set_collateral_return(out);
      body.set_total_collateral(totalCol);
      const rebuilt = CML.Transaction.new(
        body,
        parsed.witness_set(),
        true,
        parsed.auxiliary_data(),
      );
      unsignedCbor = rebuilt.to_cbor_hex();
      console.log("[submit] collateral_return repaired");
    }
  } catch (e) {
    console.warn(
      "[submit] collateral inspection failed (continuing as built):",
      String((e as { message?: string })?.message ?? e).slice(0, 160),
    );
  }
  const rebound = lucid.fromTx(unsignedCbor);
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
        lucid.awaitTx(hash, 10_000),
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
  // "All inputs are spent … probably already been included": a duplicate
  // submission of a tx that already reached the chain — a SUCCESS, not a
  // failure. (A 20s timeout on a slow-but-working node makes duplicates
  // routine.) Verify OUR hash is really there; if the inputs were taken
  // by a different tx instead, escalate as BadInputs so the caller
  // rebuilds.
  const resolveAlreadyIncluded = async (msg: string): Promise<string | null> => {
    if (!/already been included|All inputs are spent/i.test(msg)) return null;
    const hash = signed.toHash();
    console.log("[submit] node says already included — verifying", hash.slice(0, 10));
    const found = await Promise.race([
      lucid.awaitTx(hash, 10_000),
      new Promise<boolean>((r) => setTimeout(() => r(false), 90_000)),
    ]);
    if (found) {
      console.log("[submit] confirmed: our tx is on-chain");
      return hash;
    }
    throw new Error(
      "BadInputsUTxO: inputs were consumed by a conflicting transaction",
    );
  };
  // Three doors to the mempool, tried in order each round with the SAME
  // signed cbor (never a new signature). The server relay goes first:
  // browser sessions get sticky-routed to a stale Blockfrost submit
  // backend, and the wallet's backend rides the same infrastructure —
  // the lambda's network path has been reliably healthy.
  const doors: Array<[string, () => Promise<string>]> = [
    [
      "server",
      async () => {
        const r = await fetch("/api/tx/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cbor }),
        });
        const j = (await r.json()) as { txHash?: string; error?: string };
        if (!r.ok || !j.txHash) throw new Error(j.error ?? `server submit ${r.status}`);
        return j.txHash;
      },
    ],
    ["provider", () => provider.submitTx(cbor)],
    ["wallet", () => signed.submit()],
  ];
  for (let attempt = 1; ; attempt++) {
    let lastErr: unknown = null;
    for (const [door, submit] of doors) {
      try {
        console.log(`[submit] via ${door} (attempt ${attempt})`);
        const hash = await withStepTimeout(submit(), 25_000, `${door} submit`);
        console.log(`[submit] ${door} accepted the tx`);
        holdQueueUntilConfirmed(hash);
        return hash;
      } catch (e) {
        lastErr = e;
        const msg = String((e as { message?: string })?.message ?? e);
        const included = await resolveAlreadyIncluded(msg);
        if (included) {
          holdQueueUntilConfirmed(included);
          return included;
        }
        const expired = lucid.currentSlot() > ttlSlot - 2;
        const retriable = isMissingInputMsg(msg) || /timed out|server submit 5/i.test(msg);
        if (!retriable || expired || Date.now() > giveUpAt) throw e;
        console.warn(
          `[submit] ${door} rejected/stalled (attempt ${attempt}):`,
          msg.slice(0, 260),
        );
      }
    }
    if (Date.now() > giveUpAt) throw lastErr;
    const delay = Math.min(5_000 * attempt, 15_000);
    await new Promise((r) => setTimeout(r, delay));
  }
}
