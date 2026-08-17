import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { OrderDatum } from "../types.js";
import { beginSpend, escrowValue, inlineDatum, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const Params = z.object({ orderId: z.string() });
export type RaiseDisputeParams = z.input<typeof Params>;

export const raiseDispute = (client: QrpayClient) => {
  const prepare = (raw: RaiseDisputeParams) =>
    parseParams(Params, raw).asyncAndThen((p) =>
      client.findOrderById(p.orderId).andThen((order) =>
        fromTx(async () => {
          const signer = await walletPkh(client.cfg.lucid);
          const newDatum: typeof OrderDatum = {
            ...order.datum,
            status: "Disputed",
          };
          return beginSpend(client, order, "RaiseDispute")
            .pay.ToContract(
              client.scriptAddress,
              inlineDatum(newDatum),
              escrowValue(client, order),
            )
            .addSignerKey(signer)
            .complete();
        }),
      ),
    );

  const execute = (raw: RaiseDisputeParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
