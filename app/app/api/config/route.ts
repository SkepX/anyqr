import { NextResponse } from "next/server";
import { serverConfig } from "../../lib/server";

export const dynamic = "force-dynamic";

/** Everything a client-side qrpay SDK instance needs to build txs. */
export async function GET() {
  return NextResponse.json(serverConfig());
}
