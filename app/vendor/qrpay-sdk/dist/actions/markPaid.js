import { z } from "zod";
import { beginSpend, escrowValue, inlineDatum, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";
const Params = z.object({
    orderId: z.string(),
    /** Minutes of dispute window before merchant can complete. 10–30 accepted
     *  on-chain; default 15. */
    disputeWindowMin: z.number().int().min(1).max(30).default(15),
});
export const markPaid = (client) => {
    const prepare = (raw) => parseParams(Params, raw).asyncAndThen((p) => client.findOrderById(p.orderId).andThen((order) => fromTx(async () => {
        const signer = await walletPkh(client.cfg.lucid);
        const now = Date.now();
        const newDatum = {
            ...order.datum,
            status: "Paid",
            dispute_deadline: BigInt(now + p.disputeWindowMin * 60_000),
        };
        return beginSpend(client, order, "MarkPaid")
            .pay.ToContract(client.scriptAddress, inlineDatum(newDatum), escrowValue(client, order))
            .addSignerKey(signer)
            .validFrom(now - 60_000)
            .validTo(now + 5 * 60_000)
            .complete();
    })));
    const execute = (raw) => executeTx(prepare(raw));
    return { prepare, execute };
};
//# sourceMappingURL=markPaid.js.map