import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { beginSpend, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const Params = z.object({ orderId: z.string() });
export type CancelParams = z.input<typeof Params>;

export const cancelUnaccepted = (client: QrpayClient) => {
  const prepare = (raw: CancelParams) =>
    parseParams(Params, raw).asyncAndThen((p) =>
      client.findOrderById(p.orderId).andThen((order) =>
        fromTx(async () => {
          const user = await walletPkh(client.cfg.lucid);
          const userAddr = await client.cfg.lucid.wallet().address();
          return beginSpend(client, order, "CancelUnaccepted")
            .pay.ToAddress(userAddr, {
              [client.usdcUnit]: order.datum.usdc_amount,
            })
            .addSignerKey(user)
            .complete();
        }),
      ),
    );

  const execute = (raw: CancelParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
