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
  const allMeta = await registry.all();
  const metaById = new Map(allMeta.map((m) => [m.orderId, m]));
  const orders = r.value
    .map((o) => {
      const wire = toWireOrder(o);
      if (wire.status === "Placed" && wire.acceptDeadline < now) return null;
      const meta = metaById.get(wire.orderId);
      // Any on-chain UTXO without a Blob meta entry is a pre-Blob
      // leftover — buyers now register into Blob before placeOrder,
      // and Blockfrost's ~10s indexing lag guarantees meta lands
      // before the merchant ever sees the UTXO. Without meta the
      // merchant has no paymentAddress and can't act, so skip it.
      if (!meta) return null;
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
