import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";

export const dynamic = "force-dynamic";

/**
 * Merchant signals "I've sent the fiat" off-chain. This is a purely off-chain
 * flag — no tx submitted. It flips the buyer's UI from a spinner to a
 * "Did you receive it? [Yes/No]" prompt.
 */
export async function POST(req: Request) {
  const { orderId } = (await req.json()) as { orderId: string };
  if (!orderId)
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  // The order may have been registered on another lambda moments ago —
  // retry once after a beat instead of bouncing the merchant's click.
  let r = await registry.patch(orderId, { merchantPaid: Date.now() });
  if (!r) {
    await new Promise((res) => setTimeout(res, 1_500));
    r = await registry.patch(orderId, { merchantPaid: Date.now() });
  }
  if (!r) return NextResponse.json({ error: "unknown order" }, { status: 404 });
  return NextResponse.json({ ok: true, merchantPaid: r.merchantPaid });
}
