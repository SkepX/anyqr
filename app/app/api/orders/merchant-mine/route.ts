import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";
import { readOnly, toWireOrder } from "../../../lib/server";

export const dynamic = "force-dynamic";

/** All orders this merchant accepted (or auto-completed), on-chain or
 *  settled via the registry. Used to compute their earnings tally.
 *
 *  Query: ?pkh=<merchant payment key hash hex>
 */
export async function GET(req: Request) {
  const pkh = new URL(req.url).searchParams.get("pkh");
  if (!pkh)
    return NextResponse.json({ error: "pkh required" }, { status: 400 });

  const client = await readOnly();
  const r = await client.listOrders();
  if (r.isErr())
    return NextResponse.json({ error: r.error }, { status: 500 });

  const allMeta = await registry.all();
  const metaById = new Map(allMeta.map((m) => [m.orderId, m]));
  const onChain = r.value
    .filter((o) => o.datum.merchant === pkh)
    .map((o) => {
      const wire = toWireOrder(o);
      const meta = metaById.get(wire.orderId);
      return {
        orderId: wire.orderId,
        status: wire.status,
        fiatAmount: wire.fiatAmount,
        fiatCurrency: wire.fiatCurrency,
        usdcAmount: wire.usdcAmount,
        placeTxHash: meta?.placeTxHash ?? null,
        acceptTxHash: meta?.acceptTxHash ?? null,
        buyerConfirmedTxHash: meta?.buyerConfirmedTxHash ?? null,
        completeTxHash: meta?.completeTxHash ?? null,
      };
    });

  const onChainIds = new Set(onChain.map((o) => o.orderId));

  // Settled: registry has this merchant recorded but the escrow UTXO is
  // gone (completed or refunded).
  const settled = allMeta
    .filter((m) => m.merchantPkh === pkh && !onChainIds.has(m.orderId))
    .map((m) => ({
      orderId: m.orderId,
      status: "Settled",
      fiatAmount: (m.fiatAmount * 100).toString(),
      fiatCurrency: m.fiatCurrency,
      usdcAmount: m.usdcAmount,
      placeTxHash: m.placeTxHash ?? null,
      acceptTxHash: m.acceptTxHash ?? null,
      buyerConfirmedTxHash: m.buyerConfirmedTxHash ?? null,
      completeTxHash: m.completeTxHash ?? null,
    }));

  return NextResponse.json({ orders: [...onChain, ...settled] });
}
