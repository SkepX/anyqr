// Send tUSDC from the demo user wallet to any address.
// Usage: node send-tusdc.mjs <address> <amount>
import { withWallet, scanTx } from "./lib.mjs";

const addr = process.argv[2];
const amountStr = process.argv[3];
if (!addr || !amountStr) {
  console.error("usage: node send-tusdc.mjs <address> <amount>");
  process.exit(1);
}

const POLICY = process.env.TUSDC_POLICY_ID;
const NAME = process.env.TUSDC_ASSET_NAME;
if (!POLICY || !NAME) throw new Error("TUSDC_POLICY_ID/TUSDC_ASSET_NAME not set");
const unit = POLICY + NAME;

const units = BigInt(Math.round(Number(amountStr) * 1_000_000));

const lucid = await withWallet("user");
const tx = await lucid.newTx().pay.ToAddress(addr, { [unit]: units }).complete();
const signed = await tx.sign.withWallet().complete();
const hash = await signed.submit();
console.log(`sent ${amountStr} tUSDC to ${addr}`);
console.log(`tx: ${hash}`);
console.log(`scan: ${scanTx(hash)}`);
