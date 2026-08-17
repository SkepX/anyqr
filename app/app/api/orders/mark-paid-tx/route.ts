import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";

export const dynamic = "force-dynamic";

/** Record the buyer's confirmation.
 *
 *  Three phases so the merchant's screen flips at the moment of the
 *  buyer's TAP instead of ~10s later when the tx pipeline finishes:
 *  - { confirming: true }  — optimistic, at tap; sets buyerConfirmed
 *  - { txHash }            — the markPaid tx landed; records the hash
 *  - { revert: true }      — the tx failed/was cancelled; clears the
 *                            optimistic flag unless a hash exists. */
export async function POST(req: Request) {
  const { orderId, txHash, confirming, revert } = (await req.json()) as {
    orderId: string;
    txHash?: string;
    confirming?: boolean;
    revert?: boolean;
  };
  if (!orderId || (!txHash && !confirming && !revert))
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  if (revert) {
    const cur = await registry.get(orderId);
    if (cur && !cur.buyerConfirmedTxHash && cur.buyerConfirmed)
      // null = clear-this-field in the event log.
      await registry.patch(orderId, {
        buyerConfirmed: null,
      } as unknown as Partial<import("../../../lib/registry").OrderMeta>);
    return NextResponse.json({ ok: true });
  }
  const patched = await registry.patch(
    orderId,
    txHash
      ? { buyerConfirmed: Date.now(), buyerConfirmedTxHash: txHash }
      : { buyerConfirmed: Date.now() },
  );
  if (!patched)
    return NextResponse.json({ error: "unknown order" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
