import { z } from "zod";
import type { QrpayClient } from "../client.js";
import { OrderDatum } from "../types.js";
import { beginSpend, escrowValue, inlineDatum, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";

const Params = z.object({
  orderId: z.string(),
  merchantPublicKey: z.string().regex(/^[0-9a-f]+$/i),
});
export type AcceptOrderParams = z.input<typeof Params>;

export const acceptOrder = (client: QrpayClient) => {
  const prepare = (raw: AcceptOrderParams) =>
    parseParams(Params, raw).asyncAndThen((p) =>
      client.findOrderById(p.orderId).andThen((order) =>
        fromTx(async () => {
          const merchant = await walletPkh(client.cfg.lucid);
          const newDatum: typeof OrderDatum = {
            ...order.datum,
            merchant,
            merchant_pubkey: p.merchantPublicKey,
            status: "Accepted",
          };
          return beginSpend(client, order, {
            Accept: { merchant, merchant_pubkey: p.merchantPublicKey },
          })
            .pay.ToContract(
              client.scriptAddress,
              inlineDatum(newDatum),
              escrowValue(client, order),
            )
            .addSignerKey(merchant)
            .validFrom(Date.now() - 60_000)
            .validTo(Number(order.datum.accept_deadline) - 1000)
            .complete();
        }),
      ),
    );

  const execute = (raw: AcceptOrderParams) => executeTx(prepare(raw));
  return { prepare, execute };
};
