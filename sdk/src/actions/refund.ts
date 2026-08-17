import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { beginSpend, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const Params = z.object({ orderId: z.string() });
export type RefundParams = z.input<typeof Params>;

export const refund = (client: QrpayClient) => {
  const prepare = (raw: RefundParams) =>
    parseParams(Params, raw).asyncAndThen((p) =>
      client.findOrderById(p.orderId).andThen((order) =>
        fromTx(async () => {
          const user = await walletPkh(client.cfg.lucid);
          const userAddr = await client.cfg.lucid.wallet().address();
          const now = Date.now();
          return beginSpend(client, order, "Refund")
            .pay.ToAddress(userAddr, {
              [client.usdcUnit]: order.datum.usdc_amount,
            })
            .addSignerKey(user)
            .validFrom(Number(order.datum.complete_deadline) + 1000)
            .validTo(now + 5 * 60_000)
            .complete();
        }),
      ),
    );

  const execute = (raw: RefundParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
