import { z } from "zod";
import { beginSpend, escrowValue, inlineDatum, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";
const Params = z.object({
    orderId: z.string(),
    merchantPublicKey: z.string().regex(/^[0-9a-f]+$/i),
});
export const acceptOrder = (client) => {
    const prepare = (raw) => parseParams(Params, raw).asyncAndThen((p) => client.findOrderById(p.orderId).andThen((order) => fromTx(async () => {
        const merchant = await walletPkh(client.cfg.lucid);
        const newDatum = {
            ...order.datum,
            merchant,
            merchant_pubkey: p.merchantPublicKey,
            status: "Accepted",
        };
        return beginSpend(client, order, {
            Accept: { merchant, merchant_pubkey: p.merchantPublicKey },
        })
            .pay.ToContract(client.scriptAddress, inlineDatum(newDatum), escrowValue(client, order))
            .addSignerKey(merchant)
            .validFrom(Date.now() - 60_000)
            .validTo(Number(order.datum.accept_deadline) - 1000)
            .complete({ setCollateral: 2_000_000n });
    })));
    const execute = (raw) => executeTx(prepare(raw));
    return { prepare, execute };
};
//# sourceMappingURL=acceptOrder.js.map