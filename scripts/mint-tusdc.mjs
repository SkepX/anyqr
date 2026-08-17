// Mint 1000 tUSDC (1_000_000_000 units at 6dp) to the user wallet using a
// native script that requires the user's payment key signature. The resulting
// policyId + assetName are printed so we can put them in .env.
import { writeFileSync } from "node:fs";
import { paymentCredentialOf, mintingPolicyToId } from "@lucid-evolution/lucid";
import { withWallet, scanTx } from "./lib.mjs";

const lucid = await withWallet("user");
const userAddr = await lucid.wallet().address();
const userPkh = paymentCredentialOf(userAddr).hash;

// Native script: single signature required from the user's payment key.
const policy = {
  type: "Native",
  script: {
    type: "sig",
    keyHash: userPkh,
  },
};

// Lucid Evolution expects a NativeScript object shape.
const nativeScript = {
  type: "Native",
  script: JSON.stringify({ type: "sig", keyHash: userPkh }),
};

// Compute the policy id from CBOR.
const { scriptFromNative } = await import("@lucid-evolution/lucid");
const script = scriptFromNative({ type: "sig", keyHash: userPkh });
const policyId = mintingPolicyToId(script);
const assetName = Buffer.from("tUSDC", "utf8").toString("hex"); // "7455534443"
const unit = policyId + assetName;

console.log("policyId :", policyId);
console.log("assetName:", assetName);
console.log("unit     :", unit);

const AMOUNT = 1_000_000_000n; // 1000 tUSDC @ 6dp
const tx = await lucid
  .newTx()
  .mintAssets({ [unit]: AMOUNT })
  .attach.MintingPolicy(script)
  .complete();
const signed = await tx.sign.withWallet().complete();
const hash = await signed.submit();
console.log("mint tx:", hash);
console.log("scan   :", scanTx(hash));

const out =
  `\n# minted ${AMOUNT} tUSDC to user in tx ${hash}\n` +
  `TUSDC_POLICY_ID=${policyId}\n` +
  `TUSDC_ASSET_NAME=${assetName}\n`;
writeFileSync(new URL("../.env", import.meta.url).pathname, out, {
  flag: "a",
});
console.log("wrote TUSDC_* to .env");
