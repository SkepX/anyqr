import { z } from "zod";
import { beginSpend, escrowValue, inlineDatum, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";
const Params = z.object({ orderId: z.string() });
export const raiseDispute = (client) => {
    const prepare = (raw) => parseParams(Params, raw).asyncAndThen((p) => client.findOrderById(p.orderId).andThen((order) => fromTx(async () => {
        const signer = await walletPkh(client.cfg.lucid);
        const newDatum = {
            ...order.datum,
            status: "Disputed",
        };
        return beginSpend(client, order, "RaiseDispute")
            .pay.ToContract(client.scriptAddress, inlineDatum(newDatum), escrowValue(client, order))
            .addSignerKey(signer)
            .complete({ localUPLCEval: false });
    })));
    const execute = (raw) => executeTx(prepare(raw));
    return { prepare, execute };
};
//# sourceMappingURL=raiseDispute.js.map