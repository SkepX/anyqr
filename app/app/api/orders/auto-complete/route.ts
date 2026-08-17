import { NextResponse } from "next/server";
import { registry } from "../../../lib/registry";
import { adminCompleteOrder, serverConfig } from "../../../lib/server";

/** When a duplicate release attempt is told "inputs already spent", the
 *  escrow WAS released — by some other attempt whose hash we may have
 *  lost. Recover it from the chain: find which recent script-address tx
 *  consumed the markPaid escrow output. Returns null while the spender
 *  is still un-indexed (mempool) — a later poke picks it up. */
const BF_BASE = "https://cardano-preprod.blockfrost.io/api/v0";
const bfHeaders = () => ({ project_id: process.env.BLOCKFROST_PROJECT_ID ?? "" });
const bfJson = (path: string) =>
  fetch(`${BF_BASE}${path}`, { headers: bfHeaders() }).then((r) =>
    r.ok ? r.json() : null,
  );

/** Find the tx that consumed `parentTx`'s output at the script address. */
async function findSpenderOfScriptOutput(parentTx: string): Promise<string | null> {
  const scriptAddress = serverConfig().scriptAddress;
  const pu = await bfJson(`/txs/${parentTx}/utxos`);
  if (!pu) return null;
  const idx = (
    pu.outputs as Array<{ address: string; output_index: number }>
  ).find((o) => o.address === scriptAddress)?.output_index;
  if (idx === undefined) return null;
  const txs = await bfJson(
    `/addresses/${scriptAddress}/transactions?order=desc&count=20`,
  );
  if (!txs) return null;
  for (const t of txs as Array<{ tx_hash: string }>) {
    if (t.tx_hash === parentTx) continue;
    const u = await bfJson(`/txs/${t.tx_hash}/utxos`);
    if (!u) continue;
    const spends = (
      u.inputs as Array<{ tx_hash: string; output_index: number }>
    ).some((i) => i.tx_hash === parentTx && i.output_index === idx);
    if (spends) return t.tx_hash;
  }
  return null;
}

async function findEscrowSpender(orderId: string): Promise<string | null> {
  const meta = await registry.get(orderId);
  if (!meta?.buyerConfirmedTxHash) return null;
  return findSpenderOfScriptOutput(meta.buyerConfirmedTxHash);
}

/** The accept record (acceptTxHash + merchantAddress) can be lost to a
 *  clobbered registry write. Both are recoverable from the chain: the
 *  accept tx is whatever spent the place output, and its non-script
 *  inputs are the merchant's wallet. adminCompleteOrder independently
 *  verifies the address against the on-chain datum's merchant pkh. */
async function recoverMerchantAddress(meta: {
  placeTxHash?: string;
  acceptTxHash?: string;
}): Promise<{ merchantAddress: string; acceptTxHash: string } | null> {
  const acceptTx =
    meta.acceptTxHash ??
    (meta.placeTxHash
      ? await findSpenderOfScriptOutput(meta.placeTxHash)
      : null);
  if (!acceptTx) return null;
  const u = await bfJson(`/txs/${acceptTx}/utxos`);
  if (!u) return null;
  const scriptAddress = serverConfig().scriptAddress;
  const merchantAddress = (
    u.inputs as Array<{ address: string; collateral?: boolean }>
  ).find((i) => i.address !== scriptAddress)?.address;
  return merchantAddress ? { merchantAddress, acceptTxHash: acceptTx } : null;
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
  let merchantAddress = meta.merchantAddress ?? null;
  if (!merchantAddress) {
    // Accept record lost — recover from the chain and backfill.
    const rec = await recoverMerchantAddress(meta).catch(() => null);
    if (rec) {
      merchantAddress = rec.merchantAddress;
      await registry.patch(orderId, {
        merchantAddress: rec.merchantAddress,
        acceptTxHash: rec.acceptTxHash,
      });
    }
  }
  if (!merchantAddress)
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
    const txHash = await adminCompleteOrder(orderId, merchantAddress);
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
