import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { readOnly } from "../../../lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Relay a signed transaction to the chain from the server's network
 * path. Browser sessions can get sticky-routed to a stale Blockfrost
 * submit backend (observed minutes behind its own query API), and the
 * wallet's backend rides the same infrastructure — the lambda's egress
 * reliably reaches healthy nodes. Submitting a signed tx is safe to
 * proxy: the signature fixes its content, anyone may broadcast it.
 */
export async function POST(req: Request) {
  const { cbor } = (await req.json()) as { cbor?: string };
  if (!cbor || !/^[0-9a-f]+$/i.test(cbor))
    return NextResponse.json({ error: "cbor (hex) required" }, { status: 400 });
  try {
    const client = await readOnly();
    const provider = client.cfg.lucid.config().provider;
    if (!provider) throw new Error("no provider configured");
    const txHash = await provider.submitTx(cbor);
    return NextResponse.json({ txHash });
  } catch (e) {
    // Pass the node's message through verbatim — the client's retry
    // matchers key off its wording.
    const msg = String(e instanceof Error ? e.message : e);
    // Capture the exact rejected bytes for offline diagnosis (testnet
    // debug aid; a signed tx is public material by nature).
    try {
      await put(
        `debug/rejected-${Date.now()}.json`,
        JSON.stringify({ msg: msg.slice(0, 1500), cbor }),
        {
          access: "public",
          addRandomSuffix: false,
          contentType: "application/json",
          cacheControlMaxAge: 60,
        },
      );
    } catch {}
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
