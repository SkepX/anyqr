import { z } from "zod";
import { beginSpend, walletPkh } from "./_common.js";
import { executeTx, fromTx, parseParams } from "./_prepare.js";
const Params = z.object({ orderId: z.string() });
export const cancelUnaccepted = (client) => {
    const prepare = (raw) => parseParams(Params, raw).asyncAndThen((p) => client.findOrderById(p.orderId).andThen((order) => fromTx(async () => {
        const user = await walletPkh(client.cfg.lucid);
        const userAddr = await client.cfg.lucid.wallet().address();
        return beginSpend(client, order, "CancelUnaccepted")
            .pay.ToAddress(userAddr, {
            [client.usdcUnit]: order.datum.usdc_amount,
        })
            .addSignerKey(user)
            .complete({ setCollateral: 2_000_000n });
    })));
    const execute = (raw) => executeTx(prepare(raw));
    return { prepare, execute };
};
//# sourceMappingURL=cancelUnaccepted.js.map