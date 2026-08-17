import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json();
  const {
    orderId,
    paymentAddress,
    payeeName,
    fiatAmount,
    fiatCurrency,
    usdcAmount,
    userPkh,
    placeTxHash,
  } = body as {
    orderId: string;
    paymentAddress: string;
    payeeName?: string;
    fiatAmount: number;
    fiatCurrency: string;
    usdcAmount: string;
    userPkh?: string;
    placeTxHash?: string;
  };
  if (!orderId || !paymentAddress)
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  registry.put({
    orderId,
    paymentAddress,
    payeeName: payeeName ?? null,
    fiatAmount,
    fiatCurrency,
    usdcAmount,
    placedAt: Date.now(),
    userPkh,
    placeTxHash,
  });
  return NextResponse.json({ ok: true });
}
