import { Data, paymentCredentialOf } from "@lucid-evolution/lucid";
import { OrderDatum, Action } from "../types.js";
/** Compute my wallet's payment key hash. */
export const walletPkh = async (lucid) => {
    const addr = await lucid.wallet().address();
    return paymentCredentialOf(addr).hash;
};
/** Build the base of a script-spending tx: collect the escrow UTXO with a
 *  redeemer and attach the validator. */
export const beginSpend = (client, order, redeemer) => client.cfg.lucid
    .newTx()
    .collectFrom([order.utxo], Data.to(redeemer, Action))
    .attach.SpendingValidator(client.cfg.validator);
/** Continue-output value = the same locked USDC amount. */
export const escrowValue = (client, order) => ({
    [client.usdcUnit]: order.datum.usdc_amount,
});
/** Encode a new datum as inline. */
export const inlineDatum = (order) => ({
    kind: "inline",
    value: Data.to(order, OrderDatum),
});
//# sourceMappingURL=_common.js.map