import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Blockfrost,
  Data,
  Lucid,
  paymentCredentialOf,
  validatorToAddress,
  type LucidEvolution,
} from "@lucid-evolution/lucid";
import {
  Action,
  createClient,
  type QrpayClient,
} from "@qrpay/sdk";
import { loadBlueprint, pickValidator } from "@qrpay/sdk/blueprint";
import type { WireOrder } from "./wire";

const blueprint = loadBlueprint(blueprintPath());
const validator = pickValidator(blueprint, "escrow.escrow.spend");

function blueprintPath(): string {
  // Try the bundled copy first (Vercel / production), then fall back to
  // the sibling escrow project (local dev).
  const bundled = join(process.cwd(), "plutus.json");
  try {
    readFileSync(bundled);
    return bundled;
  } catch {
    return join(process.cwd(), "..", "escrow", "plutus.json");
  }
}

function assertEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
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

function adminPkh(): string {
  return paymentCredentialOf(assertEnv("ADMIN_ADDRESS")).hash;
}

/**
 * Read only qrpay client. No wallet is selected — used for querying escrow
 * UTXOs and reading rates. All state-changing actions happen client-side
 * via CIP-30 signing.
 */
export async function readOnly(): Promise<QrpayClient> {
  const lucid = await mkLucid();
  return createClient({
    lucid,
    validator,
    usdc: {
      policyId: assertEnv("TUSDC_POLICY_ID"),
      assetName: assertEnv("TUSDC_ASSET_NAME"),
    },
    adminPkh: adminPkh(),
  });
}

/** Expose the compiled validator + policy config to the browser SDK. */
export function serverConfig() {
  return {
    validator: { type: validator.type, script: validator.script },
    usdc: {
      policyId: assertEnv("TUSDC_POLICY_ID"),
      assetName: assertEnv("TUSDC_ASSET_NAME"),
    },
    adminPkh: adminPkh(),
    scriptAddress: validatorToAddress("Preprod", validator),
    network: "Preprod" as const,
  };
}

/**
 * Server-side escrow release: after the dispute window, spend the Paid
 * escrow UTxO and pay the USDC to the merchant's address, signed by the
 * admin hot wallet (fees + collateral come from it). The validator's
 * Complete branch requires no merchant signature — only that the funds
 * land at the merchant's payment key after the deadline — which is what
 * makes the release fully automatic (no wallet popup).
 */
export async function adminCompleteOrder(
  orderId: string,
  merchantAddress: string,
): Promise<string> {
  const seed = assertEnv("ADMIN_SEED");
  const client = await readOnly();
  const lucid = client.cfg.lucid;
  lucid.selectWallet.fromSeed(seed);

  const r = await client.findOrderById(orderId);
  if (r.isErr()) throw new Error(`order not found on-chain: ${orderId}`);
  const order = r.value;
  if (order.datum.status !== "Paid")
    throw new Error(`order not in Paid state: ${String(order.datum.status)}`);
  const deadline = Number(order.datum.dispute_deadline);
  // The release tx's validity starts at deadline+1s; submitting the
  // moment the countdown ends can be one slot too early for the node
  // (OutsideValidityIntervalUTxO). Wait out the last few seconds here
  // instead of failing and retrying 20s later.
  const waitMs = deadline + 3_000 - Date.now();
  if (waitMs > 20_000) throw new Error("dispute window still open");
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
  const merchantPkh = order.datum.merchant;
  if (!merchantPkh || paymentCredentialOf(merchantAddress).hash !== merchantPkh)
    throw new Error("merchantAddress does not match the order's merchant");

  const tx = await lucid
    .newTx()
    .collectFrom([order.utxo], Data.to("Complete", Action))
    .attach.SpendingValidator(client.cfg.validator)
    .pay.ToAddress(merchantAddress, {
      [client.usdcUnit]: order.datum.usdc_amount,
    })
    .validFrom(deadline + 1_000)
    .validTo(Date.now() + 5 * 60_000)
    .complete();
  const signed = await tx.sign.withWallet().complete();
  return await signed.submit();
}

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
