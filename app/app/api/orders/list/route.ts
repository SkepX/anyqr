import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";
import { readOnly, toWireOrder } from "../../../lib/server";

export const dynamic = "force-dynamic";

/**
 * List escrow UTXOs merged with off-chain metadata from the registry.
 *
 * NOTE: On Vercel, each lambda instance holds its own copy of the file-
 * based registry. If order A was placed on lambda-1 but this request lands
 * on lambda-2, meta will be missing there. Previously we filtered those
 * out, which caused the merchant page to see the order appear and
 * disappear across polls. We now always return on-chain UTXOs — meta
 * fields will be null when unavailable, and the client caches the last
 * seen meta per orderId to smooth over cross-lambda variance.
 */
export async function GET() {
  const client = await readOnly();
  const r = await client.listOrders();
  if (r.isErr())
    return NextResponse.json({ error: r.error }, { status: 500 });
  const now = Date.now();
  const orders = r.value
    .map((o) => {
      const wire = toWireOrder(o);
      // Hide stale Placed orders whose accept window has expired.
      // They're stuck on-chain until the original buyer signs
      // CancelUnaccepted, which we can't do for them — so we just
      // stop showing them in the merchant queue.
      if (wire.status === "Placed" && wire.acceptDeadline < now) return null;
      const meta = registry.get(wire.orderId);
      return {
        ...wire,
        paymentAddress: meta?.paymentAddress ?? null,
        payeeName: meta?.payeeName ?? null,
        buyerConfirmed: meta?.buyerConfirmed ?? null,
        merchantPaid: meta?.merchantPaid ?? null,
        placeTxHash: meta?.placeTxHash ?? null,
        acceptTxHash: meta?.acceptTxHash ?? null,
        buyerConfirmedTxHash: meta?.buyerConfirmedTxHash ?? null,
        completeTxHash: meta?.completeTxHash ?? null,
      };
    })
    .filter((o) => o !== null);
  return NextResponse.json({ orders });
}
