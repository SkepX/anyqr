import { NextResponse } from "next/server";
import { paymentCredentialOf } from "@lucid-evolution/lucid";
import { registry } from "../../../lib/registry";
import { readOnly, toWireOrder } from "../../../lib/server";

export const dynamic = "force-dynamic";

/**
 * List orders belonging to a given wallet address.
 *
 * Query: ?address=addr_test1...
 *
 * Merges on-chain state (Placed / Accepted / Paid / Disputed) with off-chain
 * registry metadata. For orders no longer on chain (completed or cancelled),
 * we fall back to the registry entry alone and mark status = "settled".
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address)
    return NextResponse.json({ error: "address required" }, { status: 400 });
  const pkh = paymentCredentialOf(address).hash;

  const client = await readOnly();
  const r = await client.listOrders();
  if (r.isErr())
    return NextResponse.json({ error: r.error }, { status: 500 });

  const onChain = r.value.filter((o) => o.datum.user === pkh);
  const onChainIds = new Set(onChain.map((o) => o.datum.order_id));

  const active = onChain.map((o) => {
    const wire = toWireOrder(o);
    const meta = registry.get(wire.orderId);
    return {
      ...wire,
      paymentAddress: meta?.paymentAddress ?? null,
      payeeName: meta?.payeeName ?? null,
      buyerConfirmed: meta?.buyerConfirmed ?? null,
      merchantPaid: meta?.merchantPaid ?? null,
      placedAt: meta?.placedAt ?? null,
      placeTxHash: meta?.placeTxHash ?? null,
      acceptTxHash: meta?.acceptTxHash ?? null,
      buyerConfirmedTxHash: meta?.buyerConfirmedTxHash ?? null,
      completeTxHash: meta?.completeTxHash ?? null,
    };
  });

  // Registry-only orders belonging to this pkh that no longer have a UTXO
  // on chain -> "settled" (either completed by merchant or cancelled).
  const settled = registry
    .all()
    .filter((m) => m.userPkh === pkh && !onChainIds.has(m.orderId))
    .map((m) => ({
      orderId: m.orderId,
      status: "Settled" as const,
      fiatCurrency: m.fiatCurrency,
      fiatAmount: (m.fiatAmount * 100).toString(),
      usdcAmount: m.usdcAmount,
      paymentAddress: m.paymentAddress,
      payeeName: m.payeeName,
      placedAt: m.placedAt,
      placeTxHash: m.placeTxHash ?? null,
      acceptTxHash: m.acceptTxHash ?? null,
      buyerConfirmedTxHash: m.buyerConfirmedTxHash ?? null,
      completeTxHash: m.completeTxHash ?? null,
    }));

  const all = [
    ...active.map((o) => ({ ...o, kind: "active" as const })),
    ...settled.map((o) => ({ ...o, kind: "settled" as const })),
  ].sort((a, b) => (b.placedAt ?? 0) - (a.placedAt ?? 0));

  return NextResponse.json({ orders: all });
}
