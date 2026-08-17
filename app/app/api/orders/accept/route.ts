import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { acceptOrder } from "@qrpay/sdk";
import { registry } from "../../../lib/registry";
import { withWallet } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId } = (await req.json()) as { orderId: string };
  if (!orderId)
    return NextResponse.json({ error: "orderId required" }, { status: 400 });

  const { client } = await withWallet("merchant");
  // Publish a demo pubkey — a real merchant would use their real ECIES pubkey.
  const merchantPublicKey = randomBytes(64).toString("hex");
  const r = await acceptOrder(client).execute({ orderId, merchantPublicKey });
  if (r.isErr())
    return NextResponse.json({ error: r.error }, { status: 500 });
  registry.patch(orderId, { acceptTxHash: r.value.txHash });
  return NextResponse.json({ txHash: r.value.txHash });
}
