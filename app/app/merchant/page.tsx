"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { WalletButton } from "../components/WalletButton";
import { RoleGuard } from "../components/RoleGuard";
import { buildClient } from "../lib/client-sdk";
import { useWalletConnect } from "../lib/wallet";
import type { WireOrder } from "../lib/wire";

const SCAN_URL = "https://preprod.cardanoscan.io/transaction/";
const FAIR_RATE_INR_PER_USDC = 97.65; // "fair" reference rate

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
  const [pendingAccepts, setPendingAccepts] = useState<Record<string, WireOrder>>({});
  const [autoCompleted, setAutoCompleted] = useState<Set<string>>(new Set());

  // Derive merchant pkh from connected wallet
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

  // Fetch this wallet's tUSDM balance
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
    const res = await fetch("/api/orders/list", { cache: "no-store" });
    if (!res.ok) return;
    const { orders } = (await res.json()) as { orders: WireOrder[] };
    setOrders(orders);
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 2000);
    return () => clearInterval(iv);
  }, [load]);

  // Sign accept/complete client-side with connected wallet
  const act = async (kind: "accept" | "complete", order: WireOrder) => {
    if (!conn) {
      setError("Connect a wallet to act as merchant.");
      return;
    }
    setBusy((b) => ({ ...b, [order.orderId]: true }));
    setError(null);
    if (kind === "accept") {
      setPendingAccepts((p) => ({
        ...p,
        [order.orderId]: { ...order, status: "Accepted" },
      }));
    }
    try {
      const api = await getApi();
      if (!api) throw new Error("Wallet unavailable");
      const client = await buildClient(api);
      let txHash: string;
      if (kind === "accept") {
        // Fake merchant ECIES pubkey for demo — real flow would generate keypair.
        const randomBytes = new Uint8Array(64);
        crypto.getRandomValues(randomBytes);
        const merchantPublicKey = [...randomBytes]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const { acceptOrder } = await import("@qrpay/sdk");
        const r = await acceptOrder(client).execute({
          orderId: order.orderId,
          merchantPublicKey,
        });
        if (r.isErr()) throw new Error(extractErr(r.error));
        txHash = r.value.txHash;
      } else {
        const { complete } = await import("@qrpay/sdk");
        const r = await complete(client).execute({ orderId: order.orderId });
        if (r.isErr()) throw new Error(extractErr(r.error));
        txHash = r.value.txHash;
      }
      // Record the hash so home/recent and merchant desk can show it.
      await fetch("/api/orders/record-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.orderId,
          kind,
          txHash,
          ...(kind === "accept" && merchantPkh ? { merchantPkh } : {}),
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
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy((b) => ({ ...b, [order.orderId]: false }));
    }
  };

  const markMerchantPaid = async (orderId: string) => {
    setBusy((b) => ({ ...b, [orderId]: true }));
    setError(null);
    try {
      const res = await fetch("/api/orders/merchant-paid", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) throw new Error(`merchant-paid failed: ${res.status}`);
      setOrders((prev) =>
        prev.map((o) =>
          o.orderId === orderId ? { ...o, merchantPaid: Date.now() } : o,
        ),
      );
      void load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy((b) => ({ ...b, [orderId]: false }));
    }
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
  const mine = (o: WireOrder) =>
    !merchantPkh || !o.merchant || o.merchant === merchantPkh;
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

  // Auto-fire complete on any Paid order past its dispute deadline
  useEffect(() => {
    const now = Date.now();
    for (const o of paid) {
      if (autoCompleted.has(o.orderId)) continue;
      if (now <= o.disputeDeadline) continue;
      setAutoCompleted((s) => new Set(s).add(o.orderId));
      void act("complete", o);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paid.map((o) => o.orderId + ":" + o.disputeDeadline).join(",")]);

  // Earnings = 2% of the fiat value of orders this merchant has claimed OR
  // is currently mid-cycle on. Sum in INR.
  const earnings = useMemo(() => {
    const mineOrders = orders.filter((o) => o.merchant === merchantPkh);
    let totalFiat = 0;
    for (const o of mineOrders) {
      totalFiat += Number(o.fiatAmount) / 100; // paise -> rupees
    }
    return {
      count: mineOrders.length,
      fiat: totalFiat,
      // 2% of the fiat sums as spread earnings (fiat units)
      spread: totalFiat * 0.02,
    };
  }, [orders, merchantPkh]);

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
              <CompleteButton
                o={o}
                busy={!!busy[o.orderId]}
                onClick={() => act("complete", o)}
              />
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

function CompleteButton({
  o,
  busy,
  onClick,
}: {
  o: WireOrder;
  busy: boolean;
  onClick: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);
  const ready = now > o.disputeDeadline;
  const secsLeft = Math.max(0, Math.ceil((o.disputeDeadline - now) / 1000));
  if (!ready) {
    const mm = Math.floor(secsLeft / 60);
    const ss = (secsLeft % 60).toString().padStart(2, "0");
    return (
      <span className="pill">
        auto-claim in {mm}:{ss}
      </span>
    );
  }
  return (
    <button onClick={onClick} disabled={busy} className="btn btn-primary">
      <span className="inline-flex items-center gap-2">
        <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-black border-t-transparent animate-spin" />
        Auto-claiming…
      </span>
    </button>
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
