// Anchor a buyer and a merchant identity on Preprod as CIP-0170
// attestations, then read both back off the chain.
//
// The read-back is the point. Writing metadata proves nothing on its own;
// reconstructing the same record from a block proves the anchor is real.
import {
  createClient,
  anchorIdentity,
  parseIdentityMetadata,
  CIP170_LABEL,
  ANYQR_LABEL,
} from "@qrpay/sdk";
import { loadBlueprint, pickValidator } from "@qrpay/sdk/blueprint";
import { paymentCredentialOf } from "@lucid-evolution/lucid";
import { withWallet, scanTx } from "./lib.mjs";

const KEY = process.env.BLOCKFROST_PROJECT_ID;
const POLICY = process.env.TUSDC_POLICY_ID;
const NAME = process.env.TUSDC_ASSET_NAME;
const bp = loadBlueprint(new URL("../escrow/plutus.json", import.meta.url).pathname);
const validator = pickValidator(bp, "escrow.escrow.spend");

const adminLucid = await withWallet("admin");
const adminPkh = paymentCredentialOf(await adminLucid.wallet().address()).hash;
const mk = (lucid) =>
  createClient({ lucid, validator, usdc: { policyId: POLICY, assetName: NAME }, adminPkh });

const bf = async (path) => {
  for (let i = 0; i < 24; i++) {
    const r = await fetch(`https://cardano-preprod.blockfrost.io/api/v0${path}`, {
      headers: { project_id: KEY },
    });
    if (r.ok) return r.json();
    await new Promise((s) => setTimeout(s, 5_000));
  }
  return null;
};

/** Blockfrost returns [{label, json_metadata}]; we want {label: json}. */
const metadataOf = async (txHash) => {
  const rows = await bf(`/txs/${txHash}/metadata`);
  if (!rows) return null;
  const out = {};
  for (const row of rows) out[String(row.label)] = row.json_metadata;
  return out;
};

let pass = 0, fail = 0;
const check = (name, cond, extra = "") =>
  cond ? (pass++, console.log(`  PASS  ${name}`)) : (fail++, console.log(`  FAIL  ${name} ${extra}`));

async function anchor(walletName, params) {
  const lucid = await withWallet(walletName);
  // Read the confirmed coin set; a cached view here spends phantom inputs.
  const addr = await lucid.wallet().address();
  const utxos = await lucid.utxosAt(addr);
  if (utxos.length) lucid.overrideUTxOs(utxos);

  const r = await anchorIdentity(mk(lucid)).execute(params);
  if (r.isErr()) throw new Error(`${walletName} anchor failed: ${JSON.stringify(r.error)}`);
  console.log(`  [${params.role}] ${r.value.txHash}`);
  console.log(`            ${scanTx(r.value.txHash)}`);
  await lucid.awaitTx(r.value.txHash);
  return { txHash: r.value.txHash, pkh: paymentCredentialOf(addr).hash };
}

console.log("\n=== 1. anchor a buyer ===");
const buyer = await anchor("user", { role: "buyer", displayName: "adnan" });

console.log("\n=== 2. anchor a merchant ===");
const merchant = await anchor("merchant", {
  role: "merchant",
  displayName: "mumbai-desk",
  corridors: [
    { rail: "UPI", currency: "INR" },
    { rail: "PIX", currency: "BRL" },
  ],
  eciesPubkey: "ab".repeat(64),
  claims: [
    { kind: "payment_account", provider: "upi-vpa", identifier: "0x" + "11".repeat(16) },
    { kind: "p2p_history", provider: "binance-p2p", identifier: "0x" + "22".repeat(16) },
  ],
});

console.log("\n=== 3. read both back from chain ===");
for (const [label, who] of [["buyer", buyer], ["merchant", merchant]]) {
  const labels = await metadataOf(who.txHash);
  if (!labels) { check(`${label}: metadata indexed`, false, "not returned by Blockfrost"); continue; }

  check(`${label}: label ${CIP170_LABEL} present`, Boolean(labels[String(CIP170_LABEL)]));
  check(`${label}: label ${ANYQR_LABEL} present`, Boolean(labels[String(ANYQR_LABEL)]));

  const env = labels[String(CIP170_LABEL)];
  check(`${label}: envelope is an ATTEST`, env?.t === "ATTEST", `got ${env?.t}`);
  check(`${label}: envelope carries a digest`, typeof env?.d === "string" && env.d.length > 8);

  const id = parseIdentityMetadata(who.txHash, labels);
  check(`${label}: round-trips through the parser`, id !== null);
  if (!id) continue;
  check(`${label}: role survived`, id.role === label, `got ${id.role}`);
  check(`${label}: pkh matches the signer`, id.pkh === who.pkh, `${id.pkh} vs ${who.pkh}`);
  check(`${label}: aid is marked provisional`, id.provisional === true);
  if (label === "merchant") {
    check("merchant: corridors survived", id.corridors.join(",") === "UPI:INR,PIX:BRL", id.corridors.join(","));
    check("merchant: both claims survived", id.claims.length === 2, `got ${id.claims.length}`);
    check(
      "merchant: claim kinds survived",
      id.claims.map((c) => c.kind).sort().join(",") === "p2p_history,payment_account",
      id.claims.map((c) => c.kind).join(","),
    );
  }
  console.log(`        aid ${id.aid.slice(0, 20)}...  anchored ${new Date(id.anchoredAt).toISOString()}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
