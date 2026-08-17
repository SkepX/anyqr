import { credentialToAddress } from "@lucid-evolution/lucid";
import { errAsync } from "neverthrow";
import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { err } from "../errors.js";
import { beginSpend, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const Params = z.object({
  orderId: z.string(),
  toMerchant: z.boolean(),
});
export type ResolveDisputeParams = z.input<typeof Params>;

export const resolveDispute = (client: QrpayClient) => {
  const prepare = (raw: ResolveDisputeParams) =>
    parseParams(Params, raw).asyncAndThen((p) =>
      client.findOrderById(p.orderId).andThen((order) => {
        const target = p.toMerchant ? order.datum.merchant : order.datum.user;
        if (!target)
          return errAsync(err("VALIDATION_ERROR", "no merchant on this order"));
        return fromTx(async () => {
          const admin = await walletPkh(client.cfg.lucid);
          const targetAddr = credentialToAddress(
            client.cfg.lucid.config().network!,
            { type: "Key", hash: target },
          );
          return beginSpend(client, order, {
            Resolve: { to_merchant: p.toMerchant },
          })
            .pay.ToAddress(targetAddr, {
              [client.usdcUnit]: order.datum.usdc_amount,
            })
            .addSignerKey(admin)
            .complete();
        });
      }),
    );

  const execute = (raw: ResolveDisputeParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
