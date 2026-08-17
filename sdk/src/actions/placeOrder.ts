import { Data, paymentCredentialOf } from "@lucid-evolution/lucid";
import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { OrderDatum } from "../types.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const ParamsSchema = z.object({
  /** Client-generated unique id — hex, ≤ 64 chars. Recommend random 16 bytes. */
  orderId: z.string().regex(/^[0-9a-f]+$/i).min(4).max(64),
  /** USDC (6dp) locked into escrow. */
  usdcAmount: z.bigint().positive(),
  /** Fiat amount in smallest unit (paise). */
  fiatAmount: z.bigint().positive(),
  /** ISO/informal ccy code, e.g. "INR". */
  fiatCurrency: z.string().min(2).max(6),
  /** Minutes from now until user can cancel a still-unaccepted order. */
  acceptWindowMin: z.number().int().positive().default(5),
  /** Minutes from now after which user can force-refund. */
  completeWindowMin: z.number().int().positive().default(30),
});

export type PlaceOrderParams = z.input<typeof ParamsSchema>;

export const placeOrder = (client: QrpayClient) => {
  const prepare = (raw: PlaceOrderParams) =>
    parseParams(ParamsSchema, raw).asyncAndThen((p) =>
      fromTx(async () => {
        const lucid = client.cfg.lucid;
        const walletAddr = await lucid.wallet().address();
        const userPkh = paymentCredentialOf(walletAddr).hash;
        const now = Date.now();

        const datum: typeof OrderDatum = {
          order_id: p.orderId.toLowerCase(),
          user: userPkh,
          merchant: null,
          merchant_pubkey: "",
          usdc_policy: client.cfg.usdc.policyId,
          usdc_name: client.cfg.usdc.assetName,
          usdc_amount: p.usdcAmount,
          fiat_currency: Buffer.from(p.fiatCurrency, "utf8").toString("hex"),
          fiat_amount: p.fiatAmount,
          encrypted_payment_addr: "",
          status: "Placed",
          accept_deadline: BigInt(now + p.acceptWindowMin * 60_000),
          complete_deadline: BigInt(now + p.completeWindowMin * 60_000),
          dispute_deadline: 0n,
          admin: client.cfg.adminPkh,
        };

        return lucid
          .newTx()
          .pay.ToContract(
            client.scriptAddress,
            { kind: "inline", value: Data.to(datum, OrderDatum) },
            { [client.usdcUnit]: p.usdcAmount },
          )
          .complete();
      }),
    );

  const execute = (raw: PlaceOrderParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
