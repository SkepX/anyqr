import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";
import { adminCompleteOrder } from "../../../lib/server";

export const dynamic = "force-dynamic";
// Tx build + UPLC eval + submit can take ~10s server-side.
export const maxDuration = 60;

/**
 * Trigger the automatic escrow release for a Paid order past its dispute
 * deadline. Idempotent: merchant and buyer tabs both poke this on every
 * poll once the countdown ends; the first attempt wins, the rest see the
 * guard or the recorded completeTxHash. No wallet signature involved —
 * the admin hot wallet signs server-side.
 */
export async function POST(req: Request) {
  const { orderId } = (await req.json()) as { orderId?: string };
  if (!orderId)
    return NextResponse.json({ error: "missing orderId" }, { status: 400 });

  const meta = await registry.get(orderId);
  if (!meta)
    return NextResponse.json({ error: "unknown order" }, { status: 404 });
  if (meta.completeTxHash)
    return NextResponse.json({ ok: true, txHash: meta.completeTxHash });
  if (!meta.merchantAddress)
    return NextResponse.json(
      { error: "no merchantAddress recorded for this order" },
      { status: 409 },
    );
  // Dedup: another lambda may already be mid-release. Stale guards (a
  // crashed attempt) expire after 90s so release can't get stuck.
  if (meta.completingAt && Date.now() - meta.completingAt < 90_000)
    return NextResponse.json({ ok: true, pending: true });

  await registry.patch(orderId, { completingAt: Date.now() });
  try {
    const txHash = await adminCompleteOrder(orderId, meta.merchantAddress);
    await registry.patch(orderId, { completeTxHash: txHash });
    return NextResponse.json({ ok: true, txHash });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    // A concurrent release winning the race shows up as spent inputs —
    // report pending; the winner records the hash.
    if (/BadInputsUTxO|not found on-chain|not in Paid state/i.test(msg))
      return NextResponse.json({ ok: true, pending: true });
    await registry.patch(orderId, { completingAt: 0 });
    console.error("[auto-complete]", orderId, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
