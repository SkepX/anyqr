"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { COUNTRIES } from "../lib/countries";
import { WalletButton } from "../components/WalletButton";
import { RoleGuard } from "../components/RoleGuard";
import { useWalletConnect } from "../lib/wallet";

function HomeInner() {
  const params = useSearchParams();
  const ccyCode = params.get("ccy") ?? "INR";
  const ccy = COUNTRIES.find((c) => c.code === ccyCode) ?? COUNTRIES[0];
  const { conn } = useWalletConnect();
  const [tusdc, setTusdc] = useState<string | null>(null);
  const rate = 97.65;

  // Only fetch balance when a CIP-30 wallet is connected. Reads the
  // connected wallet's own address via Blockfrost, not the server pool.
  useEffect(() => {
    if (!conn) {
      setTusdc(null);
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
          setTusdc(
            asset
              ? (Number(asset.quantity) / 1_000_000).toFixed(3)
              : "0.000",
          );
        })
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 10_000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [conn]);

  const usdcNum = Number(tusdc ?? "0");
  const inrValue = (usdcNum * rate).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return (
    <main className="flex-1 flex flex-col">
      {/* Nav */}
      <header className="border-b border-[color:var(--border)] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-baseline gap-2">
            <Link
              href="/"
              className="font-semibold tracking-tight text-lg"
            >
              anyqr
            </Link>
            <span className="text-xs text-[color:var(--text-muted)] whitespace-nowrap">
              By SyncAI.network
            </span>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            <NavTab href="/home" active>
              Wallet
            </NavTab>
            <NavTab href={`/scan?ccy=${ccy.code}`}>Scan</NavTab>
          </nav>
          <span className="pill hidden sm:inline-flex">preprod</span>
        </div>
        <WalletButton />
      </header>

      <div className="flex-1 max-w-lg w-full mx-auto px-6 py-10">
        {/* Balance */}
        <div className="mb-10">
          <div className="eyebrow mb-2">Balance</div>
          {conn ? (
            <>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="display text-6xl leading-none">
                  {tusdc ?? "…"}
                </span>
                <span className="text-lg text-[color:var(--text-muted)]">
                  tUSDM
                </span>
              </div>
              <div className="mt-2 text-sm font-mono text-[color:var(--text-muted)]">
                ≈ {ccy.symbol}
                {inrValue}
                <span className="text-[color:var(--text-faint)] ml-2">
                  @ {ccy.symbol}
                  {rate.toFixed(2)}
                </span>
              </div>
            </>
          ) : (
            <div>
              <div className="display text-4xl text-[color:var(--text-faint)] leading-none mb-3">
                tUSDM
              </div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Connect a Cardano wallet to see your balance.
              </div>
            </div>
          )}
        </div>

        {/* Primary action */}
        <Link
          href={`/scan?ccy=${ccy.code}`}
          className="group block card mb-3 hover:shadow-[3px_3px_0_0_var(--border)] transition-shadow"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="display text-2xl leading-tight">Scan any QR</div>
              <div className="text-xs text-[color:var(--text-muted)] mt-1">
                Pay in local cash from your tUSDM
              </div>
            </div>
            <div className="shrink-0 w-14 h-14 border border-[color:var(--border)] rounded flex items-center justify-center bg-[color:var(--accent)] group-hover:bg-[color:var(--accent-hover)] transition-colors">
              <QrGlyph />
            </div>
          </div>
        </Link>

        <div className="mb-10" />

        {/* Recent (only heading if empty; no dashed box) */}
        <div className="eyebrow mb-3">Recent</div>
        <RecentOrders address={conn?.address ?? null} ccySymbol={ccy.symbol} />
      </div>
    </main>
  );
}

function NavTab({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 text-sm rounded transition-colors ${
        active
          ? "bg-[color:var(--surface-alt)] text-[color:var(--text)]"
          : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
      }`}
    >
      {children}
    </Link>
  );
}

const SCAN_URL = "https://preprod.cardanoscan.io/transaction/";

type RecentOrder = {
  orderId: string;
  status: "Placed" | "Accepted" | "Paid" | "Disputed" | "Settled";
  fiatAmount: string;
  fiatCurrency: string;
  usdcAmount: string;
  paymentAddress: string | null;
  payeeName: string | null;
  placedAt: number | null;
  txHash?: string | null; // current UTXO's tx (fallback for old orders)
  placeTxHash?: string | null;
  acceptTxHash?: string | null;
  buyerConfirmedTxHash?: string | null;
  completeTxHash?: string | null;
};

function RecentOrders({
  address,
  ccySymbol,
}: {
  address: string | null;
  ccySymbol: string;
}) {
  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  useEffect(() => {
    if (!address) {
      setOrders(null);
      return;
    }
    let live = true;
    const tick = () =>
      fetch(`/api/orders/mine?address=${encodeURIComponent(address)}`, {
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!live || !d) return;
          setOrders(d.orders as RecentOrder[]);
        })
        .catch(() => {});
    tick();
    const iv = setInterval(tick, 3000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [address]);

  if (!address)
    return (
      <div className="text-sm text-[color:var(--text-muted)]">
        Connect a wallet to see your orders.
      </div>
    );
  if (orders === null)
    return (
      <div className="text-sm text-[color:var(--text-faint)]">Loading…</div>
    );
  if (orders.length === 0)
    return (
      <div className="text-sm text-[color:var(--text-muted)]">
        No payments yet. Scan a QR to make your first.
      </div>
    );

  return (
    <ul className="flex flex-col divide-y divide-[color:var(--border-soft)]">
      {orders.map((o) => {
        const usdc = (Number(o.usdcAmount) / 1_000_000).toFixed(3);
        const fiat = (Number(o.fiatAmount) / 100).toFixed(2);
        const ccy = o.fiatCurrency === "INR" ? ccySymbol : o.fiatCurrency;
        const settled = o.status === "Settled";
        return (
          <li key={o.orderId} className="flex items-center gap-3 py-3">
            <span
              className={`w-2 h-2 rounded-full ${
                settled
                  ? "bg-[color:var(--text-faint)]"
                  : "bg-[color:var(--accent)]"
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">
                {o.payeeName ?? o.paymentAddress ?? "Order"}
              </div>
              <div className="text-xs text-[color:var(--text-muted)] font-mono flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>#{o.orderId.slice(0, 8)}</span>
                <span className="text-[color:var(--text-faint)]">·</span>
                <span
                  className={
                    settled
                      ? "text-[color:var(--text-muted)]"
                      : "text-[color:var(--accent-strong)]"
                  }
                >
                  {o.status.toLowerCase()}
                </span>
                {(() => {
                  const items = [
                    { tag: "place", hash: o.placeTxHash },
                    { tag: "accept", hash: o.acceptTxHash },
                    { tag: "paid", hash: o.buyerConfirmedTxHash },
                    { tag: "complete", hash: o.completeTxHash },
                  ].filter((x) => x.hash);
                  // Fallback: if no per-step hash is known, at least show the
                  // current on-chain UTXO's tx so old orders aren't blank.
                  if (items.length === 0 && o.txHash) {
                    items.push({ tag: "on-chain", hash: o.txHash });
                  }
                  return items;
                })().map((x) => (
                    <a
                      key={x.tag}
                      href={SCAN_URL + x.hash}
                      target="_blank"
                      rel="noopener"
                      title={x.hash!}
                      className="text-[color:var(--text-faint)] hover:text-[color:var(--accent-strong)] underline decoration-dotted"
                    >
                      {x.tag}↗
                    </a>
                  ))}
              </div>
            </div>
            <div className="text-right font-mono">
              <div className="text-sm">
                {ccy}
                {fiat}
              </div>
              <div className="text-xs text-[color:var(--text-muted)]">
                {usdc} tUSDM
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** A tiny stylised QR — 3 finder squares + a few data dots. Currentcolor. */
function QrGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
      {/* top-left finder */}
      <path d="M2 2h7v7H2V2zm2 2v3h3V4H4z" />
      <rect x="5" y="5" width="1" height="1" />
      {/* top-right finder */}
      <path d="M15 2h7v7h-7V2zm2 2v3h3V4h-3z" />
      <rect x="18" y="5" width="1" height="1" />
      {/* bottom-left finder */}
      <path d="M2 15h7v7H2v-7zm2 2v3h3v-3H4z" />
      <rect x="5" y="18" width="1" height="1" />
      {/* data cells */}
      <rect x="11" y="2" width="2" height="2" />
      <rect x="11" y="6" width="2" height="2" />
      <rect x="15" y="11" width="2" height="2" />
      <rect x="19" y="11" width="2" height="2" />
      <rect x="11" y="15" width="2" height="2" />
      <rect x="15" y="15" width="2" height="2" />
      <rect x="19" y="19" width="2" height="2" />
      <rect x="11" y="19" width="2" height="2" />
      <rect x="15" y="19" width="2" height="2" />
    </svg>
  );
}

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center text-[color:var(--text-muted)]">
          Loading…
        </div>
      }
    >
      <RoleGuard expects="user">
        <HomeInner />
      </RoleGuard>
    </Suspense>
  );
}
