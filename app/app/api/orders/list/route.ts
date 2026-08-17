import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";
import { readOnly, toWireOrder } from "../../../lib/server";

export const dynamic = "force-dynamic";

/**
 * List escrow UTXOs merged with off-chain metadata from the registry.
 *
 * Query params:
 *   ?all=1  — include orders without registry metadata (leftover UTXOs from
 *             previous test runs / different app installs). Default: false.
 */
export async function GET(req: Request) {
  const includeAll = new URL(req.url).searchParams.get("all") === "1";
  const client = await readOnly();
  const r = await client.listOrders();
  if (r.isErr())
    return NextResponse.json({ error: r.error }, { status: 500 });
  const orders = r.value
    .map((o) => {
      const wire = toWireOrder(o);
      const meta = registry.get(wire.orderId);
      if (!meta && !includeAll) return null;
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
