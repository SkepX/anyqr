import { NextResponse } from "next/server";
import { complete } from "@qrpay/sdk";
import { registry } from "../../../lib/registry";
import { withWallet } from "../../../lib/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { orderId } = (await req.json()) as { orderId: string };
  const { client } = await withWallet("merchant");
  const r = await complete(client).execute({ orderId });
  if (r.isErr())
    return NextResponse.json({ error: r.error }, { status: 500 });
  registry.patch(orderId, { completeTxHash: r.value.txHash });
  return NextResponse.json({ txHash: r.value.txHash });
}
