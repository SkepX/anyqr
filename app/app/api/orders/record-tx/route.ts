import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";

export const dynamic = "force-dynamic";

/**
 * Record a signed tx hash on the registry entry for a given order.
 * Used after a wallet-signed action succeeds client-side.
 *
 * kind: "place" | "accept" | "markPaid" | "complete"
 */
export async function POST(req: Request) {
  const { orderId, kind, txHash, merchantPkh, merchantAddress } =
    (await req.json()) as {
      orderId: string;
      kind: "place" | "accept" | "markPaid" | "complete";
      txHash: string;
      merchantPkh?: string;
      merchantAddress?: string;
    };
  if (!orderId || !kind || !txHash)
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (kind === "place") patch.placeTxHash = txHash;
  if (kind === "accept") {
    patch.acceptTxHash = txHash;
    if (merchantPkh) patch.merchantPkh = merchantPkh;
    if (merchantAddress) patch.merchantAddress = merchantAddress;
  }
  if (kind === "markPaid") {
    patch.buyerConfirmedTxHash = txHash;
    patch.buyerConfirmed = Date.now();
  }
  if (kind === "complete") patch.completeTxHash = txHash;
  const patched = await registry.patch(orderId, patch);
  if (!patched)
    return NextResponse.json({ error: "unknown order" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
