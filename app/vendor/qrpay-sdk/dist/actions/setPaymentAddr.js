import { z } from "zod";
import { beginSpend, escrowValue, inlineDatum, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";
const Params = z.object({
    orderId: z.string(),
    /** ECIES ciphertext of the payment address (hex). */
    encrypted: z.string().regex(/^[0-9a-f]+$/i),
});
export const setPaymentAddr = (client) => {
    const prepare = (raw) => parseParams(Params, raw).asyncAndThen((p) => client.findOrderById(p.orderId).andThen((order) => fromTx(async () => {
        const userPkh = await walletPkh(client.cfg.lucid);
        const newDatum = {
            ...order.datum,
            encrypted_payment_addr: p.encrypted,
        };
        return beginSpend(client, order, {
            SetPaymentAddr: { encrypted: p.encrypted },
        })
            .pay.ToContract(client.scriptAddress, inlineDatum(newDatum), escrowValue(client, order))
            .addSignerKey(userPkh)
            .complete({ localUPLCEval: false });
    })));
    const execute = (raw) => executeTx(prepare(raw));
    return { prepare, execute };
};
//# sourceMappingURL=setPaymentAddr.js.map