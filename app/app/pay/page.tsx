"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { COUNTRIES } from "../lib/countries";
import { buildClient } from "../lib/client-sdk";
import { useWalletConnect } from "../lib/wallet";
import { WalletButton } from "../components/WalletButton";

function randomOrderId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Fair rate: 1 tUSDM = ₹97.65. Buyer pays with a 2% spread that becomes the
// merchant's earnings. Effective rate = 0.012 * 1.02 = 0.01224 tUSDM/INR.
const FAIR_RATE_USDC_PER_INR = 1 / 97.65;
const MERCHANT_SPREAD = 0.02;
const RATE_USDC_PER_INR = FAIR_RATE_USDC_PER_INR * (1 + MERCHANT_SPREAD);
const SCAN_URL = "https://preprod.cardanoscan.io/transaction/";

type Status =
  | "review"
  | "placing"
  | "placed"
  | "accepted"
  | "merchant_paid"
  | "confirming"
  | "paid"
  | "completed"
  | "error";

function PayInner() {
  const router = useRouter();
  const params = useSearchParams();
  const pa = params.get("pa") ?? "";
  const pn = params.get("pn") ?? "Merchant";
  const amStr = params.get("am") ?? "";
  const ccyCode = params.get("ccy") ?? "INR";
  const ccy = COUNTRIES.find((c) => c.code === ccyCode) ?? COUNTRIES[0];

  const { conn, getApi } = useWalletConnect();
  const [amount, setAmount] = useState(amStr);
  const [status, setStatus] = useState<Status>("review");
  const [orderId, setOrderId] = useState<string | null>(null);
  const [placeTx, setPlaceTx] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seenOnChain, setSeenOnChain] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);

  // Restore in-flight order across page reloads / HMR — but only if the saved
  // status is genuinely mid-flight. Anything past markPaid (paid/completed)
  // is treated as a finished flow and cleared so a fresh scan starts fresh.
  const sessionKey = `qrpay:pay:${pa}`;
  const inFlightStatuses = new Set<Status>([
    "placing",
    "placed",
    "accepted",
    "merchant_paid",
    "confirming",
  ]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = sessionStorage.getItem(sessionKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        orderId?: string;
        placeTx?: string;
        status?: Status;
        savedAt?: number;
      };
      // Drop sessions older than 10 minutes (stale/dead).
      const stale =
        parsed.savedAt && Date.now() - parsed.savedAt > 10 * 60_000;
      if (stale || !parsed.status || !inFlightStatuses.has(parsed.status)) {
        sessionStorage.removeItem(sessionKey);
        return;
      }
      if (parsed.orderId) {
        setOrderId(parsed.orderId);
        setPlaceTx(parsed.placeTx ?? null);
        setStatus(parsed.status);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!orderId) return;
    if (status === "completed" || status === "paid") {
      sessionStorage.removeItem(sessionKey);
      return;
    }
    sessionStorage.setItem(
      sessionKey,
      JSON.stringify({ orderId, placeTx, status, savedAt: Date.now() }),
    );
  }, [orderId, placeTx, status, sessionKey]);

  // Read connected wallet's tUSDM balance via Blockfrost.
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
    const iv = setInterval(tick, 10_000);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [conn]);

  const fiatAmt = Number(amount) || 0;
  const usdcAmt = useMemo(
    () => (fiatAmt * RATE_USDC_PER_INR).toFixed(3),
    [fiatAmt],
  );

  const pay = async () => {
    setStatus("placing");
    setError(null);
    try {
      if (!conn) throw new Error("Connect a wallet first");
      const api = await getApi();
      if (!api) throw new Error("Wallet unavailable");
      const usdcUnits = BigInt(Math.round(fiatAmt * RATE_USDC_PER_INR * 1_000_000));
      const fiatUnits = Math.round(fiatAmt * 100);

      const { placeOrder } = await import("@qrpay/sdk");
      const client = await buildClient(api);
      const newOrderId = randomOrderId();
      const r = await placeOrder(client).execute({
        orderId: newOrderId,
        usdcAmount: usdcUnits,
        fiatAmount: BigInt(fiatUnits),
        fiatCurrency: ccyCode,
        acceptWindowMin: 10,
        completeWindowMin: 30,
      });
      if (r.isErr()) throw new Error(JSON.stringify(r.error));

      // record off-chain metadata so the merchant can render the QR + so
      // /api/orders/mine can list this order for the buyer's Recent view.
      const { paymentCredentialOf } = await import("@lucid-evolution/lucid");
      const userPkh = paymentCredentialOf(conn.address).hash;
      await fetch("/api/orders/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: newOrderId,
          paymentAddress: pa,
          payeeName: pn,
          fiatAmount: fiatAmt,
          fiatCurrency: ccyCode,
          usdcAmount: usdcUnits.toString(),
          userPkh,
          placeTxHash: r.value.txHash,
        }),
      });

      setOrderId(newOrderId);
      setPlaceTx(r.value.txHash);
      setStatus("placed");
    } catch (e: unknown) {
      setStatus("error");
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  useEffect(() => {
    if (!orderId) return;
    if (status === "completed" || status === "error") return;
    let missCount = 0;
    const iv = setInterval(async () => {
      const res = await fetch("/api/orders/list");
      if (!res.ok) return;
      const { orders } = (await res.json()) as {
        orders: Array<{
          orderId: string;
          status: string;
          merchantPaid?: number | null;
        }>;
      };
      const me = orders.find((o) => o.orderId === orderId);
      if (!me) {
        if (!seenOnChain) return;
        // Don't jump to completed on a single miss — Blockfrost's indexer
        // often lags a beat behind block inclusion between state transitions.
        // Require 3 consecutive misses AND a registry-confirmed complete tx.
        missCount += 1;
        if (missCount < 3) return;
        try {
          const r = await fetch(
            `/api/orders/mine?address=${encodeURIComponent(conn?.address ?? "")}`,
          );
          if (!r.ok) return;
          const { orders: mine } = (await r.json()) as {
            orders: Array<{ orderId: string; status: string; completeTxHash?: string | null }>;
          };
          const settled = mine.find(
            (o) => o.orderId === orderId && (o.status === "Settled" || o.completeTxHash),
          );
          if (settled) {
            setStatus("completed");
            clearInterval(iv);
          }
        } catch {}
        return;
      }
      missCount = 0;
      if (!seenOnChain) setSeenOnChain(true);
      if (me.status === "Accepted" && status === "placed") setStatus("accepted");
      if (me.status === "Accepted" && me.merchantPaid && status === "accepted") {
        setStatus("merchant_paid");
      }
      if (
        me.status === "Paid" &&
        (status === "merchant_paid" || status === "accepted" || status === "confirming")
      ) {
        setStatus("paid");
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [orderId, status, seenOnChain]);

  const confirmReceived = async () => {
    console.log("[markPaid] click received, orderId =", orderId, "conn =", conn);
    if (!orderId) {
      setError("No active order in this session. Reload and start a new order.");
      return;
    }
    setStatus("confirming");
    setError(null);
    try {
      const api = await getApi();
      if (!api) throw new Error("Wallet unavailable. Reconnect and try again.");
      const net = await api.getNetworkId();
      if (net !== 0)
        throw new Error("Your wallet is on Mainnet. Switch to Preprod and retry.");

      console.log("[markPaid] building client…");
      const { markPaid } = await import("@qrpay/sdk");
      const client = await buildClient(api);
      console.log("[markPaid] submitting for order", orderId);
      const r = await markPaid(client).execute({
        orderId,
        disputeWindowMin: 5,
      });
      if (r.isErr()) {
        console.error("[markPaid] SDK error", r.error);
        const inner =
          (r.error?.cause as { cause?: { cause?: { failure?: { cause?: string } } } })
            ?.cause?.cause?.failure?.cause ?? r.error?.message ?? "unknown";
        throw new Error(String(inner));
      }
      console.log("[markPaid] tx", r.value.txHash);
      // Record client-side tx hash on the server registry.
      void fetch("/api/orders/mark-paid-tx", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, txHash: r.value.txHash }),
      });
      setStatus("paid");
    } catch (e) {
      console.error("[markPaid] failed", e);
      setStatus("merchant_paid");
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  return (
    <main className="flex-1 flex flex-col items-center px-5 py-8">
      <div className="max-w-sm w-full">
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={() => router.back()}
            className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)]"
          >
            ← Back
          </button>
          <WalletButton />
        </div>

        {status === "review" ? (
          <Review
            payee={pn}
            payeeAddr={pa}
            amount={amount}
            setAmount={setAmount}
            fiatAmt={fiatAmt}
            usdcAmt={usdcAmt}
            ccySymbol={ccy.symbol}
            balance={balance}
            connected={!!conn}
            onPay={pay}
          />
        ) : (
          <PayStatus
            status={status}
            payee={pn}
            payeeAddr={pa}
            fiatAmt={fiatAmt}
            ccySymbol={ccy.symbol}
            usdcAmt={usdcAmt}
            balance={balance}
            placeTx={placeTx}
            error={error}
            onConfirmReceived={confirmReceived}
            onDone={() => router.push(`/home?ccy=${ccyCode}`)}
          />
        )}
      </div>
    </main>
  );
}

function Review(props: {
  payee: string;
  payeeAddr: string;
  amount: string;
  setAmount: (v: string) => void;
  fiatAmt: number;
  usdcAmt: string;
  ccySymbol: string;
  balance: string | null;
  connected: boolean;
  onPay: () => void;
}) {
  const { payee, payeeAddr, amount, setAmount, fiatAmt, usdcAmt, ccySymbol, balance, connected, onPay } = props;
  const insufficient = balance != null && Number(usdcAmt) > Number(balance);
  return (
    <>
      <div className="mb-8">
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-muted)] mb-2">
          Paying
        </div>
        <div className="display text-3xl leading-tight">{payee}</div>
        <div className="text-xs font-mono text-[color:var(--text-muted)] mt-1">
          {payeeAddr}
        </div>
      </div>

      <div className="mb-6">
        <label className="eyebrow block mb-2">Amount</label>
        <div className="amount-field">
          <span className="prefix">{ccySymbol}</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-xs font-mono">
          <span className="text-[color:var(--text-muted)]">
            = {usdcAmt} tUSDM
          </span>
          {balance != null && (
            <span
              className={
                insufficient
                  ? "text-[color:var(--warning)]"
                  : "text-[color:var(--text-faint)]"
              }
            >
              balance {balance}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onPay}
        disabled={!fiatAmt || fiatAmt <= 0 || insufficient || !connected}
        className="btn btn-primary w-full py-4 text-base"
      >
        {!connected
          ? "Connect wallet to pay"
          : insufficient
            ? "Not enough tUSDM"
            : `Pay ${ccySymbol}${fiatAmt.toFixed(2)}`}
      </button>
    </>
  );
}

function PayStatus(props: {
  status: Status;
  payee: string;
  payeeAddr: string;
  fiatAmt: number;
  ccySymbol: string;
  usdcAmt: string;
  balance: string | null;
  placeTx: string | null;
  error: string | null;
  onConfirmReceived: () => void;
  onDone: () => void;
}) {
  const {
    status,
    payee,
    payeeAddr,
    fiatAmt,
    ccySymbol,
    usdcAmt,
    balance,
    placeTx,
    error,
    onConfirmReceived,
    onDone,
  } = props;

  const meta: {
    icon: React.ReactNode;
    title: string;
    sub: string;
  } = (() => {
    switch (status) {
      case "placing":
        return { icon: <Spinner />, title: "Locking tUSDM", sub: "Signing on Cardano…" };
      case "placed":
        return {
          icon: <Spinner />,
          title: "Waiting for a merchant",
          sub: "A liquidity partner will pick this up in a few seconds.",
        };
      case "accepted":
        return {
          icon: <Spinner />,
          title: "Merchant accepted",
          sub: `Paying ${ccySymbol}${fiatAmt.toFixed(2)} to ${payee} from their bank now.`,
        };
      case "merchant_paid":
        return {
          icon: <Bell />,
          title: `Did ${ccySymbol}${fiatAmt.toFixed(2)} land?`,
          sub: `Merchant says they sent it to ${payeeAddr}. Check your PhonePe.`,
        };
      case "confirming":
        return { icon: <Spinner />, title: "Recording confirmation", sub: "" };
      case "paid":
        return {
          icon: <Hourglass />,
          title: "Confirmed",
          sub: "Merchant claims tUSDM after the 5-minute dispute window.",
        };
      case "completed":
        return { icon: <Check />, title: "Payment complete", sub: "tUSDM released to the merchant." };
      case "error":
        return { icon: <Warn />, title: "Something went wrong", sub: error ?? "" };
      default:
        return { icon: null, title: "", sub: "" };
    }
  })();

  return (
    <>
      <div className="mb-8">
        <div className="text-xs uppercase tracking-wider text-[color:var(--text-muted)] mb-2">
          Paying {payee}
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="display text-3xl leading-tight">
            {ccySymbol}
            {fiatAmt.toFixed(2)}
          </span>
          <span className="font-mono text-sm text-[color:var(--text-muted)]">
            {usdcAmt} tUSDM
          </span>
        </div>
        {balance != null && (
          <div className="mt-1 font-mono text-xs text-[color:var(--text-faint)]">
            balance {balance} tUSDM
          </div>
        )}
      </div>

      <div className="flex items-start gap-4 mb-8">
        <div className="shrink-0 mt-1">{meta.icon}</div>
        <div className="flex-1">
          <div className="display text-2xl leading-tight">{meta.title}</div>
          {meta.sub && (
            <div className="text-sm text-[color:var(--text-muted)] mt-1">{meta.sub}</div>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded border border-[color:var(--warning)] bg-[color:var(--warning)]/10 text-sm text-[color:var(--warning)] break-all">
          {error}
        </div>
      )}

      {status === "merchant_paid" && (
        <div className="flex flex-col gap-2 mb-6">
          <button
            type="button"
            onClick={() => {
              console.log("[button] Yes received clicked");
              onConfirmReceived();
            }}
            className="btn btn-primary py-4 text-base"
          >
            Yes, received
          </button>
          <button className="btn btn-ghost py-4 text-base text-sm" disabled>
            No, dispute (soon)
          </button>
        </div>
      )}

      {status === "completed" && (
        <button onClick={onDone} className="btn btn-primary w-full py-4 mb-6">
          Back home
        </button>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-[color:var(--text-muted)]">
        {placeTx && (
          <a
            href={SCAN_URL + placeTx}
            target="_blank"
            rel="noopener"
            className="hover:text-[color:var(--accent-strong)]"
          >
            place ↗
          </a>
        )}
        {(status === "paid" || status === "completed") && (
          <span className="text-[color:var(--text-faint)]">
            markPaid signed ✓
          </span>
        )}
      </div>
    </>
  );
}

// --- tiny icon set -------------------------------------------------------

function Spinner() {
  return (
    <span className="block w-6 h-6 rounded-full border-2 border-[color:var(--accent)] border-t-transparent animate-spin" />
  );
}
function Check() {
  return (
    <span className="w-6 h-6 rounded-full bg-[color:var(--accent)] text-white flex items-center justify-center text-sm">
      ✓
    </span>
  );
}
function Bell() {
  return (
    <span className="w-6 h-6 rounded-full bg-[color:var(--accent-soft)] border border-[color:var(--accent)] flex items-center justify-center text-xs text-[color:var(--accent-strong)]">
      ●
    </span>
  );
}
function Hourglass() {
  return (
    <span className="w-6 h-6 rounded-full border border-[color:var(--border-soft)] flex items-center justify-center text-xs text-[color:var(--text-muted)]">
      ⌛
    </span>
  );
}
function Warn() {
  return (
    <span className="w-6 h-6 rounded-full bg-[color:var(--warning)] text-white flex items-center justify-center text-xs">
      !
    </span>
  );
}

export default function PayPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Loading…</div>}>
      <PayInner />
    </Suspense>
  );
}
