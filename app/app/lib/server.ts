import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Blockfrost,
  Lucid,
  paymentCredentialOf,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import { createClient, type QrpayClient } from "@qrpay/sdk";
import { loadBlueprint, pickValidator } from "@qrpay/sdk/blueprint";

const WALLET_DIR = join(process.cwd(), "..", ".wallets");
const BLUEPRINT_PATH = join(process.cwd(), "..", "escrow", "plutus.json");

const blueprint = loadBlueprint(BLUEPRINT_PATH);
const validator = pickValidator(blueprint, "escrow.escrow.spend");

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

function loadSeed(name: string): string {
  return readFileSync(join(WALLET_DIR, `${name}.seed`), "utf8").trim();
}

async function mkLucid(): Promise<LucidEvolution> {
  return await Lucid(
    new Blockfrost(
      "https://cardano-preprod.blockfrost.io/api/v0",
      assertEnv("BLOCKFROST_PROJECT_ID"),
    ),
    "Preprod",
  );
}

/** Full client with a wallet selected. Use for any tx-producing action. */
export async function withWallet(name: "user" | "merchant" | "admin"): Promise<{
  lucid: LucidEvolution;
  client: QrpayClient;
  address: string;
  pkh: string;
}> {
  const lucid = await mkLucid();
  lucid.selectWallet.fromSeed(loadSeed(name));
  const address = await lucid.wallet().address();
  const pkh = paymentCredentialOf(address).hash;
  const adminAddr = await (async () => {
    const l = await mkLucid();
    l.selectWallet.fromSeed(loadSeed("admin"));
    return l.wallet().address();
  })();
  const client = createClient({
    lucid,
    validator,
    usdc: {
      policyId: assertEnv("TUSDC_POLICY_ID"),
      assetName: assertEnv("TUSDC_ASSET_NAME"),
    },
    adminPkh: paymentCredentialOf(adminAddr).hash,
  });
  return { lucid, client, address, pkh };
}

/** Read-only client (no wallet). Fine for listing orders. */
export async function readOnly(): Promise<QrpayClient> {
  const lucid = await mkLucid();
  // Load admin just so we know the adminPkh; no wallet is actually selected
  // for reads, but createClient wants a lucid with wallet — use user for
  // convenience, no signing will occur.
  lucid.selectWallet.fromSeed(loadSeed("user"));
  const adminSeedLucid = await mkLucid();
  adminSeedLucid.selectWallet.fromSeed(loadSeed("admin"));
  const adminPkh = paymentCredentialOf(await adminSeedLucid.wallet().address())
    .hash;
  return createClient({
    lucid,
    validator,
    usdc: {
      policyId: assertEnv("TUSDC_POLICY_ID"),
      assetName: assertEnv("TUSDC_ASSET_NAME"),
    },
    adminPkh,
  });
}

/** Serializable projection of a StoredOrder for API responses. */
import type { WireOrder } from "./wire";

export function toWireOrder(o: {
  utxo: { txHash: string; outputIndex: number };
  datum: {
    order_id: string;
    user: string;
    merchant: string | null;
    merchant_pubkey: string;
    usdc_amount: bigint;
    fiat_currency: string;
    fiat_amount: bigint;
    encrypted_payment_addr: string;
    status: string;
    accept_deadline: bigint;
    complete_deadline: bigint;
    dispute_deadline: bigint;
  };
}): WireOrder {
  return {
    orderId: o.datum.order_id,
    txHash: o.utxo.txHash,
    outputIndex: o.utxo.outputIndex,
    user: o.datum.user,
    merchant: o.datum.merchant,
    merchantPubkey: o.datum.merchant_pubkey,
    usdcAmount: o.datum.usdc_amount.toString(),
    fiatCurrency: Buffer.from(o.datum.fiat_currency, "hex").toString("utf8"),
    fiatAmount: o.datum.fiat_amount.toString(),
    encryptedPaymentAddr: o.datum.encrypted_payment_addr,
    status: o.datum.status as WireOrder["status"],
    acceptDeadline: Number(o.datum.accept_deadline),
    completeDeadline: Number(o.datum.complete_deadline),
    disputeDeadline: Number(o.datum.dispute_deadline),
  };
}
