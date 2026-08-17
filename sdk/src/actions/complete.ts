import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { beginSpend, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const Params = z.object({ orderId: z.string() });
export type CompleteParams = z.input<typeof Params>;

export const complete = (client: QrpayClient) => {
  const prepare = (raw: CompleteParams) =>
    parseParams(Params, raw).asyncAndThen((p) =>
      client.findOrderById(p.orderId).andThen((order) =>
        fromTx(async () => {
          const merchant = await walletPkh(client.cfg.lucid);
          const merchantAddr = await client.cfg.lucid.wallet().address();
          const now = Date.now();
          return beginSpend(client, order, "Complete")
            .pay.ToAddress(merchantAddr, {
              [client.usdcUnit]: order.datum.usdc_amount,
            })
            .addSignerKey(merchant)
            .validFrom(Number(order.datum.dispute_deadline) + 1000)
            .validTo(now + 5 * 60_000)
            .complete();
        }),
      ),
    );

  const execute = (raw: CompleteParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
