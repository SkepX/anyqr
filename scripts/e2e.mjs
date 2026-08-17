// End-to-end lifecycle test on Cardano Preprod.
//
//   user   placeOrder  (locks 10 tUSDC)              -> Placed
//   merchant  acceptOrder  (claims order)            -> Accepted
//   user   markPaid  (dispute window 1 min)          -> Paid
//   ... wait for dispute window to close ...
//   merchant  complete  (claims tUSDC)               -> gone
//
// Between steps we POLL for the expected status via SDK waitForStatus so we
// don't race the Blockfrost indexer.
import { randomBytes } from "node:crypto";
import {
  createClient,
  placeOrder,
  acceptOrder,
  markPaid,
  complete,
} from "@qrpay/sdk";
import { loadBlueprint, pickValidator } from "@qrpay/sdk/blueprint";
import { paymentCredentialOf } from "@lucid-evolution/lucid";
import { withWallet, scanTx } from "./lib.mjs";

const POLICY = process.env.TUSDC_POLICY_ID;
const NAME = process.env.TUSDC_ASSET_NAME;
if (!POLICY || !NAME) throw new Error("TUSDC_POLICY_ID/TUSDC_ASSET_NAME not set");

const BLUEPRINT = new URL("../escrow/plutus.json", import.meta.url).pathname;
const bp = loadBlueprint(BLUEPRINT);
const validator = pickValidator(bp, "escrow.escrow.spend");

const adminLucid = await withWallet("admin");
const adminPkh = paymentCredentialOf(await adminLucid.wallet().address()).hash;

const orderId = randomBytes(8).toString("hex");
console.log(`\n=== E2E lifecycle, orderId = ${orderId} ===\n`);

const cfg = (lucid) => ({
  lucid,
  validator,
  usdc: { policyId: POLICY, assetName: NAME },
  adminPkh,
});

async function step(label, promise) {
  const r = await promise;
  if (r.isErr()) throw new Error(`${label} failed: ${JSON.stringify(r.error)}`);
  console.log(`[${label}] ok: ${r.value.txHash}`);
  console.log(`      ${scanTx(r.value.txHash)}`);
  return r.value;
}

// --- 1. USER placeOrder --------------------------------------------------
const userLucid = await withWallet("user");
const userClient = createClient(cfg(userLucid));
console.log("script address:", userClient.scriptAddress);

await step(
  "user placeOrder",
  placeOrder(userClient).execute({
    orderId,
    usdcAmount: 10_000_000n,
    fiatAmount: 850_00n,
    fiatCurrency: "INR",
    acceptWindowMin: 10,
    completeWindowMin: 30,
  }),
);
await userClient.waitForStatus(orderId, "Placed");
console.log("  -> Placed confirmed on chain\n");

// --- 2. MERCHANT acceptOrder --------------------------------------------
const merchantLucid = await withWallet("merchant");
const merchantClient = createClient(cfg(merchantLucid));
const merchantPubkey = randomBytes(64).toString("hex");
await step(
  "merchant acceptOrder",
  acceptOrder(merchantClient).execute({ orderId, merchantPublicKey: merchantPubkey }),
);
await merchantClient.waitForStatus(orderId, "Accepted");
console.log("  -> Accepted confirmed on chain\n");

// --- 3. USER markPaid ---------------------------------------------------
const userLucid2 = await withWallet("user");
const userClient2 = createClient(cfg(userLucid2));
await step(
  "user markPaid",
  markPaid(userClient2).execute({ orderId, disputeWindowMin: 1 }),
);
const paid = await userClient2.waitForStatus(orderId, "Paid");
console.log("  -> Paid confirmed on chain\n");

// --- 4. wait for dispute window ------------------------------------------
const disputeEnd = Number(paid.datum.dispute_deadline);
const waitMs = Math.max(0, disputeEnd - Date.now()) + 15_000;
console.log(`waiting ${Math.round(waitMs / 1000)}s for dispute window to close...`);
await new Promise((r) => setTimeout(r, waitMs));

// --- 5. MERCHANT complete ------------------------------------------------
const merchantLucid2 = await withWallet("merchant");
const merchantClient2 = createClient(cfg(merchantLucid2));
await step("merchant complete", complete(merchantClient2).execute({ orderId }));

console.log("\n=== lifecycle complete ===");
