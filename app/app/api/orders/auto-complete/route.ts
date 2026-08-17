import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";
import { adminCompleteOrder, serverConfig } from "../../../lib/server";

/** When a duplicate release attempt is told "inputs already spent", the
 *  escrow WAS released — by some other attempt whose hash we may have
 *  lost. Recover it from the chain: find which recent script-address tx
 *  consumed the markPaid escrow output. Returns null while the spender
 *  is still un-indexed (mempool) — a later poke picks it up. */
async function findEscrowSpender(orderId: string): Promise<string | null> {
  const meta = await registry.get(orderId);
  const paidTx = meta?.buyerConfirmedTxHash;
  if (!paidTx) return null;
  const key = process.env.BLOCKFROST_PROJECT_ID;
  if (!key) return null;
  const base = "https://cardano-preprod.blockfrost.io/api/v0";
  const headers = { project_id: key };
  const scriptAddress = serverConfig().scriptAddress;
  const pu = await fetch(`${base}/txs/${paidTx}/utxos`, { headers }).then(
    (r) => (r.ok ? r.json() : null),
  );
  if (!pu) return null;
  const escrowIdx = (
    pu.outputs as Array<{ address: string; output_index: number }>
  ).find((o) => o.address === scriptAddress)?.output_index;
  if (escrowIdx === undefined) return null;
  const txs = await fetch(
    `${base}/addresses/${scriptAddress}/transactions?order=desc&count=20`,
    { headers },
  ).then((r) => (r.ok ? r.json() : null));
  if (!txs) return null;
  for (const t of txs as Array<{ tx_hash: string }>) {
    if (t.tx_hash === paidTx) continue;
    const u = await fetch(`${base}/txs/${t.tx_hash}/utxos`, { headers }).then(
      (r) => (r.ok ? r.json() : null),
    );
    if (!u) continue;
    const spends = (
      u.inputs as Array<{ tx_hash: string; output_index: number }>
    ).some((i) => i.tx_hash === paidTx && i.output_index === escrowIdx);
    if (spends) return t.tx_hash;
  }
  return null;
}

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
    // A concurrent release winning the race shows up as spent /
    // already-included inputs, or as the order having left the script.
    // Either way the escrow WAS released — recover the actual spender
    // tx from the chain and record it so the UI can flip to Released.
    if (
      /already been included|All inputs are spent|BadInputsUTxO|not found on-chain|not in Paid state/i.test(
        msg,
      )
    ) {
      const spender = await findEscrowSpender(orderId).catch(() => null);
      if (spender) {
        await registry.patch(orderId, { completeTxHash: spender });
        return NextResponse.json({ ok: true, txHash: spender });
      }
      return NextResponse.json({ ok: true, pending: true });
    }
    await registry.patch(orderId, { completingAt: 0 });
    console.error("[auto-complete]", orderId, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
