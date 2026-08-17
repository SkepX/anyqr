import { z } from "zod";
import { beginSpend, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";
const Params = z.object({ orderId: z.string() });
export const refund = (client) => {
    const prepare = (raw) => parseParams(Params, raw).asyncAndThen((p) => client.findOrderById(p.orderId).andThen((order) => fromTx(async () => {
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
            .complete({ setCollateral: 2_000_000n });
    })));
    const execute = (raw) => executeTx(prepare(raw));
    return { prepare, execute };
};
//# sourceMappingURL=refund.js.map