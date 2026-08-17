import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";

export const dynamic = "force-dynamic";

/** Client-side markPaid succeeded — record the tx hash + buyerConfirmed
 *  timestamp so it shows up in Recent + activity feeds. */
export async function POST(req: Request) {
  const { orderId, txHash } = (await req.json()) as {
    orderId: string;
    txHash: string;
  };
  if (!orderId || !txHash)
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  const patched = registry.patch(orderId, {
    buyerConfirmed: Date.now(),
    buyerConfirmedTxHash: txHash,
  });
  if (!patched)
    return NextResponse.json({ error: "unknown order" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
