// Send tADA from the demo user wallet to any address.
// Usage: node send-ada.mjs <address> <amount>
import { withWallet, scanTx } from "./lib.mjs";

const addr = process.argv[2];
const amountStr = process.argv[3];
if (!addr || !amountStr) {
  console.error("usage: node send-ada.mjs <address> <amount>");
  process.exit(1);
}
const lovelace = BigInt(Math.round(Number(amountStr) * 1_000_000));

const lucid = await withWallet("user");
const tx = await lucid.newTx().pay.ToAddress(addr, { lovelace }).complete();
const signed = await tx.sign.withWallet().complete();
const hash = await signed.submit();
console.log(`sent ${amountStr} tADA to ${addr}`);
console.log(`tx: ${hash}`);
console.log(`scan: ${scanTx(hash)}`);
