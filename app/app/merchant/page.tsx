"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { WalletButton } from "../components/WalletButton";
import { RoleGuard } from "../components/RoleGuard";
import {
  buildClient,
  isStaleUtxoError,
  signAndSubmitPrepared,
  withTxLock,
} from "../lib/client-sdk";
import {
  isDeadChannelError,
  useWalletConnect,
  withWalletKeepAlive,
  type Cip30Api,
} from "../lib/wallet";
import type { WireOrder } from "../lib/wire";

const SCAN_URL = "https://preprod.cardanoscan.io/transaction/";
const FAIR_RATE_INR_PER_USDC = 97.65; // "fair" reference rate

// Track auto-complete attempts at module scope so a component remount
// does not trigger a second signing attempt for the same order — the
// old wallet API handle would already be invalidated by the extension,
// producing a "RemoteApiShutdownError" that surfaces as the red error
// card on the merchant page.
const AUTO_COMPLETE_ATTEMPTED = new Map<string, number>();

// Cross-lambda meta cache. Vercel's file-based registry doesn't
// propagate across lambda instances, so a poll that hits a "cold"
// lambda gets meta=null for orders another lambda placed. We remember
// the last non-null meta per orderId in-tab so paymentAddress /
// payeeName / txHash pills don't blink when polls bounce.
type MetaFields = Pick<
  WireOrder,
  | "paymentAddress"
  | "payeeName"
  | "buyerConfirmed"
  | "merchantPaid"
  | "placeTxHash"
  | "acceptTxHash"
  | "buyerConfirmedTxHash"
  | "completeTxHash"
>;
const META_CACHE = new Map<string, MetaFields>();
function mergeMeta(o: WireOrder): WireOrder {
  const cached = META_CACHE.get(o.orderId);
  // Fold non-null fields from this response into the cache, and fill
  // any null fields on the response with cached values.
  const next: MetaFields = {
    paymentAddress: o.paymentAddress ?? cached?.paymentAddress ?? null,
    payeeName: o.payeeName ?? cached?.payeeName ?? null,
    buyerConfirmed: o.buyerConfirmed ?? cached?.buyerConfirmed ?? null,
    merchantPaid: o.merchantPaid ?? cached?.merchantPaid ?? null,
    placeTxHash: o.placeTxHash ?? cached?.placeTxHash ?? null,
    acceptTxHash: o.acceptTxHash ?? cached?.acceptTxHash ?? null,
    buyerConfirmedTxHash: o.buyerConfirmedTxHash ?? cached?.buyerConfirmedTxHash ?? null,
    completeTxHash: o.completeTxHash ?? cached?.completeTxHash ?? null,
  };
  META_CACHE.set(o.orderId, next);
  return { ...o, ...next };
}

export default function MerchantPage() {
  return (
    <RoleGuard expects="merchant" connectPrompt={<MerchantOnboarding />}>
      <MerchantInner />
    </RoleGuard>
  );
}

function MerchantInner() {
  const { conn, getApi } = useWalletConnect();
  const [merchantPkh, setMerchantPkh] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [orders, setOrders] = useState<WireOrder[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // True while a tx sits in the wallet waiting for the user's signature —
  // Lace doesn't always auto-open its confirmation window, so we surface
  // a hint telling the merchant where to find the pending request.
  const [awaitingSignature, setAwaitingSignature] = useState(false);
  const [pendingAccepts, setPendingAccepts] = useState<Record<string, WireOrder>>({});
  const emptyStreak = useRef(0);
  const mountId = useRef(Math.random().toString(36).slice(2, 7));


  useEffect(() => {
    if (!conn) {
      setMerchantPkh(null);
      return;
    }
    let live = true;
    (async () => {
      const { paymentCredentialOf } = await import("@lucid-evolution/lucid");
      if (!live) return;
      setMerchantPkh(paymentCredentialOf(conn.address).hash);
    })();
    return () => {
      live = false;
    };
  }, [conn]);

  useEffect(() => {
    if (!conn) {
      setBalance(null);
      return;
    }
    let live = true;
    const key = process.env.NEXT_PUBLIC_BLOCKFROST_PROJECT_ID;
    const unit =
      process.env.NEXT_PUBLIC_TUSDC_POLICY_ID! +
      process.env.NEXT_PUBLIC_TUSDC_ASSET_NAME!;
    const tick = () =>
      fetch(
        `https://cardano-preprod.blockfrost.io/api/v0/addresses/${conn.address}`,
        { headers: { project_id: key ?? "" } },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!live || !d?.amount) return;
          const asset = d.amount.find(
            (a: { unit: string; quantity: string }) => a.unit === unit,
          );
          setBalance(asset ? (Number(asset.quantity) / 1_000_000).toFixed(3) : "0.000");
        })
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 6000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [conn]);

  const load = useCallback(async () => {
    let next: WireOrder[];
    try {
      const res = await fetch("/api/orders/list", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { orders: WireOrder[] };
      next = j.orders.map(mergeMeta);
    } catch {
      return;
    }
    setOrders((prev) => {
      if (next.length === 0 && prev.length > 0) {
        emptyStreak.current += 1;
        if (emptyStreak.current < 3) return prev;
      } else {
        emptyStreak.current = 0;
      }
      if (
        prev.length === next.length &&
        prev.every(
          (p, i) =>
            p.orderId === next[i].orderId &&
            p.status === next[i].status &&
            p.merchantPaid === next[i].merchantPaid,
        )
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      if (stop) return;
      await load();
      if (stop) return;
      timer = setTimeout(loop, 4000);
    };
    void loop();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  // Sign accept/complete client-side with connected wallet.
  // `silent` mode (used by auto-complete) suppresses the red error card
  // so a stale-handle failure in the background doesn't scream at the
  // merchant — the next poll will retry via `mine()` if the order still
  // sits past its deadline.
  const act = async (
    kind: "accept" | "complete",
    order: WireOrder,
    silent = false,
  ) => {
    if (!conn) {
      if (!silent) setError("Connect a wallet to act as merchant.");
      return;
    }
    // A stale row can outlive the order's accept window (polls keep the
    // last non-empty list for a few beats). Refuse up front instead of
    // building a tx that expires before it can land.
    if (kind === "accept" && order.acceptDeadline < Date.now() + 30_000) {
      if (!silent)
        setError(
          "This order's accept window has expired — it will disappear shortly. Ask the buyer to place a fresh one.",
        );
      return;
    }
    setBusy((b) => ({ ...b, [order.orderId]: true }));
    if (!silent) setError(null);
    if (kind === "accept") {
      setPendingAccepts((p) => ({
        ...p,
        [order.orderId]: { ...order, status: "Accepted" },
      }));
    }
    console.log(`[merchant] act:${kind} START orderId=${order.orderId.slice(0, 8)}`);
    try {
      const runOnce = async (api: Cip30Api): Promise<string> => {
        console.log(`[merchant] act:${kind} got api, building Lucid client`);
        const t1 = performance.now();
        const client = await buildClient(api, 8);
        console.log(`[merchant] act:${kind} client built in ${Math.round(performance.now() - t1)}ms`);
        if (kind === "accept") {
          const randomBytes = new Uint8Array(64);
          crypto.getRandomValues(randomBytes);
          const merchantPublicKey = [...randomBytes]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          const { acceptOrder } = await import("@qrpay/sdk");
          if (order.pending) {
            // Registry-only row — the place tx hasn't been indexed yet.
            // Wait for it so findOrderById inside prepare() can see it.
            console.log(`[merchant] act:accept order pending indexing — waiting for chain`);
            await client.waitForStatus(order.orderId, "Placed", {
              timeoutMs: 90_000,
              intervalMs: 3_000,
            });
          }
          console.log(`[merchant] act:accept building tx`);
          const t2 = performance.now();
          const prepared = await acceptOrder(client).prepare({
            orderId: order.orderId,
            merchantPublicKey,
          });
          console.log(`[merchant] act:accept build done in ${Math.round(performance.now() - t2)}ms`, prepared.isOk() ? "OK" : "ERR");
          if (prepared.isErr()) throw new Error(extractErr(prepared.error));
          // Sign through a revalidated handle — the 30s+ build above is
          // exactly long enough for Chrome to idle-kill the wallet's
          // service worker, so the handle the client was built with may
          // be dead by now.
          console.log(`[merchant] act:accept signing + submitting`);
          setAwaitingSignature(true);
          const txHash = await signAndSubmitPrepared(client, prepared.value, getApi);
          console.log(`[merchant] act:accept submitted`);
          return txHash;
        }
        const { complete } = await import("@qrpay/sdk");
        console.log(`[merchant] act:complete building tx`);
        const prepared = await complete(client).prepare({ orderId: order.orderId });
        if (prepared.isErr()) throw new Error(extractErr(prepared.error));
        console.log(`[merchant] act:complete signing + submitting`);
        setAwaitingSignature(true);
        return await signAndSubmitPrepared(client, prepared.value, getApi);
      };
      const sign = async (): Promise<string> => {
        console.log(`[merchant] act:${kind} calling getApi`);
        const api = await getApi();
        if (!api) throw new Error("Wallet unavailable");
        try {
          return await withWalletKeepAlive(api, () => runOnce(api));
        } catch (e) {
          // The extension worker died mid-flow and took the api handle
          // with it. Open a fresh channel and retry the whole build+sign
          // once — the tx was never submitted, so a rebuild is safe.
          if (!isDeadChannelError(e)) throw e;
          console.warn(
            `[merchant] act:${kind} wallet channel died mid-flow — refreshing handle, retrying once`,
          );
          const fresh = await getApi({ fresh: true });
          if (!fresh) throw e;
          return await withWalletKeepAlive(fresh, () => runOnce(fresh));
        }
      };
      // Serialize wallet txs (a click racing the auto-complete timer
      // must not build from the same UTxO snapshot), and on a stale-
      // UTxO rejection wait one block and rebuild fresh once.
      const txHash = await withTxLock(async () => {
        try {
          return await sign();
        } catch (e) {
          if (!isStaleUtxoError(e)) throw e;
          console.warn(
            `[merchant] act:${kind} built on stale UTxOs — waiting 30s for chain to settle, rebuilding`,
          );
          await new Promise((r) => setTimeout(r, 30_000));
          return await sign();
        }
      });
      console.log(`[merchant] act:${kind} SUCCESS txHash=${txHash.slice(0, 10)}…`);
      // Record the hash so home/recent and merchant desk can show it.
      await fetch("/api/orders/record-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          kind,
          txHash,
          ...(kind === "accept" && merchantPkh ? { merchantPkh } : {}),
          ...(kind === "accept" && conn ? { merchantAddress: conn.address } : {}),
        }),
      });
      setTimeout(load, 2500);
    } catch (e) {
      if (kind === "accept") {
        setPendingAccepts((p) => {
          const { [order.orderId]: _, ...rest } = p;
          return rest;
        });
      }
      const msg = String(e instanceof Error ? e.message : e);
      if (silent) {
        // Auto-complete failure — log but don't spam the user with a red
        // card. The order stays in AUTO_COMPLETE_ATTEMPTED so we don't
        // pop the wallet again on every poll. Refresh to retry manually.
        console.warn("[merchant] auto-complete failed:", msg);
      } else {
        setError(msg);
      }
    } finally {
      setAwaitingSignature(false);
      setBusy((b) => ({ ...b, [order.orderId]: false }));
    }
  };

  const markMerchantPaid = async (orderId: string) => {
    setError(null);
    // Optimistic-first: flip the card to "waiting for buyer" on the
    // FIRST press, then land the flag server-side with retries in the
    // background. Registry writes can be slow or race across lambdas —
    // a press must never look like a no-op.
    const paidAt = Date.now();
    const before = META_CACHE.get(orderId);
    const seed = (merchantPaid: number | null) => {
      META_CACHE.set(orderId, {
        paymentAddress: before?.paymentAddress ?? null,
        payeeName: before?.payeeName ?? null,
        buyerConfirmed: before?.buyerConfirmed ?? null,
        merchantPaid,
        placeTxHash: before?.placeTxHash ?? null,
        acceptTxHash: before?.acceptTxHash ?? null,
        buyerConfirmedTxHash: before?.buyerConfirmedTxHash ?? null,
        completeTxHash: before?.completeTxHash ?? null,
      });
      setOrders((prev) =>
        prev.map((o) => (o.orderId === orderId ? { ...o, merchantPaid } : o)),
      );
    };
    seed(paidAt);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch("/api/orders/merchant-paid", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          console.log(`[merchant-paid] recorded (attempt ${attempt})`);
          void load();
          return;
        }
        console.warn(`[merchant-paid] attempt ${attempt}: status ${res.status}`);
      } catch (e) {
        clearTimeout(timeout);
        console.warn(`[merchant-paid] attempt ${attempt} failed:`, e);
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    // Every attempt failed — revert so the buyer isn't left waiting on a
    // flag that never landed.
    seed(before?.merchantPaid ?? null);
    setError("Couldn't record ‘I’ve paid’ — check your connection and press once more.");
  };

  // Merge optimistic accepts with authoritative on-chain data
  const orderMap = new Map<string, WireOrder>();
  for (const o of orders) orderMap.set(o.orderId, o);
  for (const [id, o] of Object.entries(pendingAccepts)) {
    const existing = orderMap.get(id);
    if (!existing || existing.status === "Placed") orderMap.set(id, o);
  }
  const all = [...orderMap.values()];
  // Filter accepted/paid to orders this merchant accepted (or that don't yet
  // have a merchant assigned).
  // Until we've derived our own pkh, don't render accepted/paid rows —
  // otherwise other merchants' orders would flash in for one tick and
  // then filter out, which reads as the whole section "appearing and
  // disappearing".
  const mine = (o: WireOrder) =>
    !!merchantPkh && (!o.merchant || o.merchant === merchantPkh);
  const placed = all.filter((o) => o.status === "Placed");
  const accepted = all.filter((o) => o.status === "Accepted" && mine(o));
  const paid = all.filter((o) => o.status === "Paid" && mine(o));

  // Clean up optimistic accepts once on-chain confirms
  useEffect(() => {
    const confirmed = new Set(
      orders.filter((o) => o.status !== "Placed").map((o) => o.orderId),
    );
    setPendingAccepts((p) => {
      let changed = false;
      const next: typeof p = {};
      for (const [id, o] of Object.entries(p)) {
        if (confirmed.has(id)) {
          changed = true;
          continue;
        }
        next[id] = o;
      }
      return changed ? next : p;
    });
  }, [orders]);

  // Poke the server-side release for any Paid order past its dispute
  // deadline. The server signs with the admin hot wallet — no merchant
  // wallet popup. Idempotent server-side; throttled to one poke per
  // order per 30s here so polling doesn't spam the lambda.
  useEffect(() => {
    const now = Date.now();
    for (const o of paid) {
      if (now <= o.disputeDeadline + 2_000) continue;
      const last = AUTO_COMPLETE_ATTEMPTED.get(o.orderId) ?? 0;
      if (now - last < 30_000) continue;
      AUTO_COMPLETE_ATTEMPTED.set(o.orderId, now);
      void fetch("/api/orders/auto-complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: o.orderId }),
      })
        .then(async (r) => {
          const j = (await r.json()) as { txHash?: string; error?: string };
          if (j.txHash) {
            console.log(`[merchant] auto-release done tx=${j.txHash.slice(0, 10)}…`);
            // Flip the row to "Released ✓" immediately — polls can lag
            // the registry/chain by up to a minute, and the release is
            // already a fact.
            const txHash = j.txHash;
            const cached = META_CACHE.get(o.orderId);
            META_CACHE.set(o.orderId, {
              paymentAddress: cached?.paymentAddress ?? null,
              payeeName: cached?.payeeName ?? null,
              buyerConfirmed: cached?.buyerConfirmed ?? null,
              merchantPaid: cached?.merchantPaid ?? null,
              placeTxHash: cached?.placeTxHash ?? null,
              acceptTxHash: cached?.acceptTxHash ?? null,
              buyerConfirmedTxHash: cached?.buyerConfirmedTxHash ?? null,
              completeTxHash: txHash,
            });
            setOrders((prev) =>
              prev.map((x) =>
                x.orderId === o.orderId ? { ...x, completeTxHash: txHash } : x,
              ),
            );
            setTimeout(load, 2000);
          } else if (j.error) {
            console.warn("[merchant] auto-release:", j.error);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid.map((o) => o.orderId + ":" + o.disputeDeadline).join(",")]);

  // Earnings roll in from BOTH mid-flight orders (on-chain) and settled
  // orders (registry entries whose UTXO is gone). We poll a per-merchant
  // endpoint that merges the two, keyed by the merchant's pkh.
  const [merchantOrders, setMerchantOrders] = useState<
    Array<{ orderId: string; fiatAmount: string; fiatCurrency: string }>
  >([]);
  useEffect(() => {
    if (!merchantPkh) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await fetch(`/api/orders/merchant-mine?pkh=${merchantPkh}`);
        if (stop || !r.ok) return;
        const d = await r.json();
        if (stop) return;
        setMerchantOrders((prev) => {
          const next = d.orders as typeof prev;
          if (
            prev.length === next.length &&
            prev.every(
              (p, i) =>
                p.orderId === next[i].orderId &&
                p.fiatAmount === next[i].fiatAmount,
            )
          ) {
            return prev;
          }
          return next;
        });
      } catch {
        /* ignore */
      } finally {
        if (!stop) timer = setTimeout(tick, 6000);
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [merchantPkh]);

  const earnings = useMemo(() => {
    let totalFiat = 0;
    for (const o of merchantOrders) totalFiat += Number(o.fiatAmount) / 100;
    return {
      count: merchantOrders.length,
      fiat: totalFiat,
      spread: totalFiat * 0.02,
    };
  }, [merchantOrders]);

  return (
    <main className="flex-1 flex flex-col">
      {/* Nav */}
      <header className="border-b border-[color:var(--border)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight text-lg">
            anyqr
          </Link>
          <nav className="hidden sm:flex items-center gap-1 text-sm">
            <span className="px-3 py-1.5 bg-[color:var(--surface-alt)] rounded">
              Merchant
            </span>
          </nav>
          <span className="pill hidden sm:inline-flex">preprod</span>
        </div>
        <WalletButton />
      </header>

      <div className="flex-1 max-w-3xl w-full mx-auto px-6 py-8">
        {/* RoleGuard guarantees `conn` is set by the time we get here. */}
        <div className="mb-10 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-[color:var(--border-soft)] pb-6">
            <div>
              <div className="eyebrow mb-1">Merchant balance</div>
              <div className="flex items-baseline gap-2">
                <span className="display text-4xl leading-none">
                  {balance ?? "…"}
                </span>
                <span className="text-sm text-[color:var(--text-muted)]">
                  tUSDM
                </span>
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <div className="eyebrow mb-1">Orders</div>
                <div className="font-mono text-[color:var(--text)]">
                  {earnings.count}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Routed</div>
                <div className="font-mono text-[color:var(--text)]">
                  ${(earnings.fiat / FAIR_RATE_INR_PER_USDC).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Earnings 2%</div>
                <div className="font-mono text-[color:var(--accent-strong)]">
                  ${(earnings.spread / FAIR_RATE_INR_PER_USDC).toFixed(2)}
                </div>
              </div>
            </div>
          </div>

        {error && (
          <div className="card mb-4 border-[color:var(--warning)] text-[color:var(--warning)] text-sm break-all">
            {error}
          </div>
        )}

        {awaitingSignature && (
          <div className="card mb-4 text-sm">
            Waiting for your wallet&apos;s signature. If no wallet window
            appeared, click the Lace icon in your Chrome toolbar — the
            request is waiting there.
          </div>
        )}

        <Section title="Waiting for someone to accept" count={placed.length}>
          {placed.length === 0 && <EmptyRow text="Nothing incoming right now." />}
          {placed.map((o) => (
            <OrderRow key={o.orderId} o={o}>
              <button
                onClick={() => act("accept", o)}
                disabled={!!busy[o.orderId] || !conn}
                className="btn btn-primary"
              >
                {busy[o.orderId] ? "Accepting…" : "Accept"}
              </button>
            </OrderRow>
          ))}
        </Section>

        <Section title="Pay the shop now" count={accepted.length}>
          {accepted.length === 0 && (
            <EmptyRow text="Orders you've accepted appear here." />
          )}
          {accepted.map((o) => (
            <PayCard
              key={o.orderId}
              o={o}
              busy={!!busy[o.orderId]}
              onMarkPaid={() => markMerchantPaid(o.orderId)}
            />
          ))}
        </Section>

        <Section title="Buyer confirmed, claim tUSDM" count={paid.length}>
          {paid.length === 0 && (
            <EmptyRow text="After buyer taps 'Yes I received', you can complete." />
          )}
          {paid.map((o) => (
            <OrderRow key={o.orderId} o={o}>
              <CompleteButton o={o} />
            </OrderRow>
          ))}
        </Section>
      </div>
    </main>
  );
}

function MerchantOnboarding() {
  return (
    <div className="mb-8">
      <div className="eyebrow mb-3">Become a merchant</div>
      <h1 className="display text-4xl leading-tight mb-3">
        Earn 2% on every trade you settle
      </h1>
      <p className="text-[color:var(--text-muted)] mb-8 max-w-lg">
        Merchants provide the local cash side of anyqr. You bridge tUSDM buyers
        to the real world by paying their QR codes from your bank account.
      </p>

      <ol className="flex flex-col gap-4 mb-8">
        <Step
          n={1}
          title="Connect your Cardano wallet"
          body="This becomes your merchant identity. Your earnings land here directly."
        />
        <Step
          n={2}
          title="Accept incoming orders"
          body="A buyer somewhere scanned a UPI, PIX or QRIS code. You tap Accept to claim their order."
        />
        <Step
          n={3}
          title="Pay the shop from your bank"
          body="Use your normal banking app to send the fiat. The QR to scan is shown to you here."
        />
        <Step
          n={4}
          title="Claim your tUSDM"
          body="Once the buyer confirms receipt, the escrow releases the tUSDM to your wallet automatically after a 5 minute dispute window."
        />
      </ol>

      <div className="card mb-6">
        <div className="eyebrow mb-2">The economics</div>
        <div className="text-sm text-[color:var(--text-muted)] mb-3">
          Buyer pays a 2% spread on top of the fair tUSDM rate (1 tUSDM ≈ $1
          ≈ ₹97.65). That spread is your profit for fronting the fiat.
        </div>
        <div className="text-sm font-mono">
          Example: buyer scans a $5.12 (₹500) QR
          <br />
          You pay $5.12 (₹500) to the shop from your bank
          <br />
          You receive{" "}
          <span className="text-[color:var(--accent-strong)]">
            5.222 tUSDM
          </span>{" "}
          worth $5.22 ($5.12 + $0.10 spread)
          <br />
          Your profit ≈ $0.10 (₹10) per trade
        </div>
      </div>

      <div className="text-sm text-[color:var(--text-muted)]">
        Connect a wallet in the top right to start.
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <div className="w-8 h-8 shrink-0 rounded-full bg-[color:var(--accent)] border border-[color:var(--border)] flex items-center justify-center font-semibold text-sm">
        {n}
      </div>
      <div className="flex-1">
        <div className="font-medium mb-1">{title}</div>
        <div className="text-sm text-[color:var(--text-muted)]">{body}</div>
      </div>
    </li>
  );
}

function extractErr(err: unknown): string {
  const inner = (err as { cause?: { cause?: { failure?: { cause?: string } } } })
    ?.cause?.cause?.failure?.cause;
  if (typeof inner === "string") return inner;
  const msg = (err as { message?: string })?.message;
  return msg ?? JSON.stringify(err);
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="display text-2xl">{title}</h2>
        <span className="text-xs text-[color:var(--text-muted)]">
          {count} {count === 1 ? "order" : "orders"}
        </span>
      </div>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <li className="card-flat text-sm text-[color:var(--text-muted)]">{text}</li>
  );
}

function OrderRow({ o, children }: { o: WireOrder; children: React.ReactNode }) {
  const usdc = (Number(o.usdcAmount) / 1_000_000).toFixed(3);
  const fiat = (Number(o.fiatAmount) / 100).toFixed(2);
  const ccySymbol =
    ({ INR: "₹", BRL: "R$", IDR: "Rp" } as Record<string, string>)[o.fiatCurrency] ??
    o.fiatCurrency;
  return (
    <li className="card-flat flex items-center gap-4">
      <div className="w-11 h-11 rounded-full bg-[color:var(--accent-soft)] border border-[color:var(--accent)] flex items-center justify-center text-[color:var(--accent-strong)] font-mono text-xs">
        {o.orderId.slice(0, 4)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">
          {ccySymbol}{fiat}{" "}
          <span className="text-[color:var(--text-muted)]">/ {usdc} tUSDM</span>
        </div>
        <div className="text-xs text-[color:var(--text-muted)] font-mono truncate flex items-center gap-2">
          <span>#{o.orderId.slice(0, 8)}</span>
          <TxHashes o={o} />
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  );
}

function TxHashes({ o }: { o: WireOrder }) {
  const items = [
    { tag: "place", hash: o.placeTxHash },
    { tag: "accept", hash: o.acceptTxHash },
    { tag: "paid", hash: o.buyerConfirmedTxHash },
    { tag: "complete", hash: o.completeTxHash },
  ].filter((x) => x.hash);
  if (items.length === 0) return null;
  return (
    <>
      {items.map((x) => (
        <a
          key={x.tag}
          href={SCAN_URL + x.hash}
          target="_blank"
          rel="noopener"
          className="text-[color:var(--text-faint)] hover:text-[color:var(--accent-strong)] underline decoration-dotted"
          title={`${x.tag}: ${x.hash}`}
        >
          {x.tag}↗
        </a>
      ))}
    </>
  );
}

function CompleteButton({ o }: { o: WireOrder }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const ready = now > o.disputeDeadline;
  const secsLeft = Math.max(0, Math.ceil((o.disputeDeadline - now) / 1000));
  const usdc = (Number(o.usdcAmount) / 1_000_000).toFixed(3);
  if (!ready) {
    const mm = Math.floor(secsLeft / 60);
    const ss = (secsLeft % 60).toString().padStart(2, "0");
    return (
      <div className="text-right">
        <div className="text-xs text-[color:var(--text-muted)]">
          Funds release in
        </div>
        <div className="font-mono text-base font-medium">
          {mm}:{ss}
        </div>
        <div className="text-xs text-[color:var(--accent-strong)] mt-0.5">
          +{usdc} tUSDM
        </div>
      </div>
    );
  }
  if (o.completeTxHash) {
    return (
      <div className="text-right">
        <a
          href={SCAN_URL + o.completeTxHash}
          target="_blank"
          rel="noopener"
          className="text-sm font-medium text-[color:var(--accent-strong)] hover:underline"
        >
          Released ✓
        </a>
        <div className="text-xs text-[color:var(--accent-strong)] mt-0.5">
          +{usdc} tUSDM
        </div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <div className="inline-flex items-center gap-2 text-sm text-[color:var(--text-muted)]">
        <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        Releasing…
      </div>
      <div className="text-xs text-[color:var(--accent-strong)] mt-0.5">
        +{usdc} tUSDM
      </div>
    </div>
  );
}

function PayCard({
  o,
  busy,
  onMarkPaid,
}: {
  o: WireOrder;
  busy: boolean;
  onMarkPaid: () => void;
}) {
  const usdc = (Number(o.usdcAmount) / 1_000_000).toFixed(3);
  const fiat = (Number(o.fiatAmount) / 100).toFixed(2);
  const ccySymbol =
    ({ INR: "₹", BRL: "R$", IDR: "Rp" } as Record<string, string>)[o.fiatCurrency] ??
    o.fiatCurrency;
  const upiUri =
    o.paymentAddress != null
      ? `upi://pay?pa=${encodeURIComponent(o.paymentAddress)}${
          o.payeeName ? `&pn=${encodeURIComponent(o.payeeName)}` : ""
        }&am=${fiat}&cu=${o.fiatCurrency}`
      : null;

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!upiUri) return;
    QRCode.toDataURL(upiUri, { width: 220, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(null));
  }, [upiUri]);

  return (
    <li className="card-flat flex flex-col sm:flex-row gap-5 items-start">
      <div className="w-full sm:w-auto flex justify-center">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="UPI QR"
            className="w-56 h-56 rounded-lg border border-[color:var(--border-soft)]"
          />
        ) : (
          <div className="w-56 h-56 rounded-lg border border-dashed border-[color:var(--border-soft)] flex items-center justify-center text-xs text-[color:var(--text-muted)] text-center p-4">
            No QR metadata
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="eyebrow mb-1">Pay this now</div>
        <div className="display text-3xl mb-1">
          {ccySymbol}{fiat}
        </div>
        <div className="text-xs text-[color:var(--text-muted)] mb-3">
          You'll receive {usdc} tUSDM once buyer confirms
        </div>
        {o.paymentAddress && (
          <div className="card-flat mb-3 !p-3">
            <div className="text-[10px] uppercase tracking-wider text-[color:var(--text-muted)] mb-1">
              UPI ID
            </div>
            <div className="font-mono text-sm break-all">{o.paymentAddress}</div>
            {o.payeeName && (
              <div className="text-xs text-[color:var(--text-muted)] mt-1">
                {o.payeeName}
              </div>
            )}
          </div>
        )}
        {o.merchantPaid ? (
          <span className="pill">
            <span className="w-1.5 h-1.5 rounded-full bg-[color:var(--accent)] animate-pulse" />
            waiting for buyer to confirm receipt
          </span>
        ) : (
          <button
            onClick={onMarkPaid}
            disabled={busy}
            className="btn btn-primary w-full sm:w-auto"
          >
            {busy ? (
              <span className="inline-flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Sending…
              </span>
            ) : (
              <>I&apos;ve paid {ccySymbol}{fiat}</>
            )}
          </button>
        )}
      </div>
    </li>
  );
}
