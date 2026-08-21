// End-to-end lifecycle on Preprod, released by a KEYLESS RELAYER.
//
// Proves the security property behind splitting ADMIN_SEED out of the
// release path: the `Complete` branch authorises nobody, so a wallet with
// no relationship to the order — not the buyer, not the merchant, not the
// admin — can push the payout, and the funds still land only at the
// merchant's key. A relayer that leaks costs its float and nothing else.
//
//   user      placeOrder                     -> Placed
//   merchant  acceptOrder                    -> Accepted
//   user      markPaid    (1 min window)     -> Paid
//   ... window closes ...
//   RELAYER   Complete    (fresh wallet)     -> tUSDC to merchant
import { randomBytes } from "node:crypto";
import {
  createClient,
  placeOrder,
  acceptOrder,
  markPaid,
  Action,
} from "@qrpay/sdk";
import { loadBlueprint, pickValidator } from "@qrpay/sdk/blueprint";
import {
  Data,
  generateSeedPhrase,
  paymentCredentialOf,
} from "@lucid-evolution/lucid";
import { withWallet, mkLucid, scanTx } from "./lib.mjs";

const POLICY = process.env.TUSDC_POLICY_ID;
const NAME = process.env.TUSDC_ASSET_NAME;
if (!POLICY || !NAME) throw new Error("TUSDC_POLICY_ID/TUSDC_ASSET_NAME not set");
const UNIT = POLICY + NAME;

const bp = loadBlueprint(new URL("../escrow/plutus.json", import.meta.url).pathname);
const validator = pickValidator(bp, "escrow.escrow.spend");

const userLucid = await withWallet("user");
const merchantLucid = await withWallet("merchant");
const adminLucid = await withWallet("admin");
const adminPkh = paymentCredentialOf(await adminLucid.wallet().address()).hash;

const cfg = (lucid) => ({ lucid, validator, usdc: { policyId: POLICY, assetName: NAME }, adminPkh });
const userClient = createClient(cfg(userLucid));
const merchantClient = createClient(cfg(merchantLucid));

// Lucid caches the wallet's UTxO set; after we fund a wallet mid-script
// that cache is a lie. Re-read the confirmed set from the chain, exactly
// as refreshWalletView does in the app.
const refresh = async (lucid) => {
  const addr = await lucid.wallet().address();
  const utxos = await lucid.utxosAt(addr);
  if (utxos.length) lucid.overrideUTxOs(utxos);
  return utxos;
};
// awaitTx says "in a block"; the address index can still be a minute
// behind that. Poll until the coins are actually visible to coin
// selection, or the next build spends money the indexer hasn't seen.
const waitForAsset = async (lucid, unit, min, label) => {
  for (let i = 0; i < 30; i++) {
    const utxos = await refresh(lucid);
    let have = 0n;
    for (const u of utxos) have += u.assets[unit] ?? 0n;
    if (have >= min) return have;
    if (i === 0) console.log(`  waiting for ${label} to index...`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw new Error(`${label} never appeared in the address index`);
};
const bal = async (lucid) => {
  const utxos = await refresh(lucid);
  let ada = 0n, tok = 0n;
  for (const u of utxos) { ada += u.assets.lovelace ?? 0n; tok += u.assets[UNIT] ?? 0n; }
  return { ada, tok };
};
const step = async (label, p) => {
  const r = await p;
  if (r.isErr()) throw new Error(`${label} failed: ${JSON.stringify(r.error)}`);
  console.log(`  [${label}] ${r.value.txHash}`);
  console.log(`            ${scanTx(r.value.txHash)}`);
  return r.value;
};
const waitStatus = async (client, orderId, want) => {
  for (let i = 0; i < 40; i++) {
    const r = await client.findOrderById(orderId);
    if (r.isOk() && String(r.value.datum.status) === want) return r.value;
    await new Promise((s) => setTimeout(s, 5_000));
  }
  throw new Error(`timed out waiting for ${want}`);
};

// ---- 0. a relayer wallet that has never touched this order -------------
console.log("\n=== 0. provision a fresh relayer ===");
const relayerSeed = generateSeedPhrase();
const relayerLucid = await mkLucid();
relayerLucid.selectWallet.fromSeed(relayerSeed);
const relayerAddr = await relayerLucid.wallet().address();
const relayerPkh = paymentCredentialOf(relayerAddr).hash;
console.log(`  relayer ${relayerAddr.slice(0, 28)}...  pkh ${relayerPkh.slice(0, 16)}...`);

const fundTx = await userLucid.newTx().pay.ToAddress(relayerAddr, { lovelace: 20_000_000n }).complete();
const fundHash = await (await fundTx.sign.withWallet().complete()).submit();
console.log(`  funded 20 tADA: ${fundHash}`);
await userLucid.awaitTx(fundHash);
await refresh(userLucid);
console.log("  confirmed");

// ---- 0b. make sure the buyer holds stablecoin --------------------------
const ORDER_AMT = 20_000n;
const merchantAddr = await merchantLucid.wallet().address();
const merchantPkh = paymentCredentialOf(merchantAddr).hash;
const userAddr = await userLucid.wallet().address();
if ((await bal(userLucid)).tok < ORDER_AMT) {
  console.log("\n=== 0b. fund the buyer with tUSDM ===");
  const t = await merchantLucid
    .newTx()
    .pay.ToAddress(userAddr, { lovelace: 2_000_000n, [UNIT]: ORDER_AMT })
    .complete();
  const h = await (await t.sign.withWallet().complete()).submit();
  console.log(`  sent ${ORDER_AMT} tUSDM: ${h}`);
  await merchantLucid.awaitTx(h);
  await refresh(merchantLucid);
  await waitForAsset(userLucid, UNIT, ORDER_AMT, "buyer tUSDM");
  console.log("  confirmed and indexed");
}

// ---- 1..3 normal lifecycle --------------------------------------------
const orderId = randomBytes(8).toString("hex");
const before = await bal(merchantLucid);
console.log(`\n=== lifecycle, orderId ${orderId} ===`);
console.log(`  merchant before: ${(Number(before.ada) / 1e6).toFixed(2)} tADA, ${before.tok} tUSDC`);

await step("place", placeOrder(userClient).execute({
  orderId, usdcAmount: ORDER_AMT, fiatAmount: 40n, fiatCurrency: "INR",
  acceptDeadline: Date.now() + 30 * 60_000,
  completeDeadline: Date.now() + 60 * 60_000,
}));
await waitStatus(userClient, orderId, "Placed");

// ECIES pubkey the buyer encrypts the shop QR to. Random here: this test
// is about who may release the escrow, not about the payment address.
const merchantPublicKey = randomBytes(64).toString("hex");
await refresh(merchantLucid);
await step("accept", acceptOrder(merchantClient).execute({ orderId, merchantPublicKey }));
await waitStatus(merchantClient, orderId, "Accepted");

await refresh(userLucid);
await step("markPaid", markPaid(userClient).execute({ orderId, disputeWindowMin: 1 }));
const paid = await waitStatus(userClient, orderId, "Paid");

// ---- 4. relayer releases ----------------------------------------------
const deadline = Number(paid.datum.dispute_deadline);
const waitMs = deadline + 3_000 - Date.now();
console.log(`\n=== 4. relayer release (waiting ${Math.max(0, Math.round(waitMs / 1000))}s for dispute window) ===`);
if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

await refresh(relayerLucid);
const fresh = await userClient.findOrderById(orderId);
if (fresh.isErr()) throw new Error("order vanished before release");
const order = fresh.value;

// Exactly what relayCompleteOrder builds: no signer key added, pays the
// merchant's address, validity opens after the dispute deadline.
const relTx = await relayerLucid
  .newTx()
  .collectFrom([order.utxo], Data.to("Complete", Action))
  .attach.SpendingValidator(validator)
  .pay.ToAddress(merchantAddr, { [UNIT]: order.datum.usdc_amount })
  .validFrom(deadline + 1_000)
  .validTo(Date.now() + 5 * 60_000)
  .complete();
const relHash = await (await relTx.sign.withWallet().complete()).submit();
console.log(`  [complete] ${relHash}`);
console.log(`             ${scanTx(relHash)}`);
await relayerLucid.awaitTx(relHash);

// ---- 5. verify ---------------------------------------------------------
console.log("\n=== 5. verify ===");
const after = await bal(merchantLucid);
const gained = after.tok - before.tok;
const gone = (await userClient.findOrderById(orderId)).isErr();
const relAfter = await bal(relayerLucid);

console.log(`  merchant after:  ${(Number(after.ada) / 1e6).toFixed(2)} tADA, ${after.tok} tUSDC  (+${gained})`);
console.log(`  escrow consumed: ${gone}`);
console.log(`  relayer left:    ${(Number(relAfter.ada) / 1e6).toFixed(2)} tADA, ${relAfter.tok} tUSDC`);

const ok = gained === ORDER_AMT && gone && relAfter.tok === 0n
  && relayerPkh !== merchantPkh && relayerPkh !== adminPkh;
console.log(
  ok
    ? "\nPASS  a wallet with no authority released the escrow, and every tUSDC went to the merchant"
    : "\nFAIL  see numbers above",
);
process.exit(ok ? 0 : 1);
