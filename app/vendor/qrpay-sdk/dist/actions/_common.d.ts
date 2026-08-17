import type { LucidEvolution, TxBuilder } from "@lucid-evolution/lucid";
import type { QrpayClient, StoredOrder } from "../client.js";
import { OrderDatum, Action } from "../types.js";
/** Compute my wallet's payment key hash. */
export declare const walletPkh: (lucid: LucidEvolution) => Promise<string>;
/** Build the base of a script-spending tx: collect the escrow UTXO with a
 *  redeemer and attach the validator. */
export declare const beginSpend: (client: QrpayClient, order: StoredOrder, redeemer: typeof Action) => TxBuilder;
/** Continue-output value = the same locked USDC amount. */
export declare const escrowValue: (client: QrpayClient, order: StoredOrder) => {
    [x: string]: bigint;
};
/** Encode a new datum as inline. */
export declare const inlineDatum: (order: typeof OrderDatum) => {
    kind: "inline";
    value: string;
};
//# sourceMappingURL=_common.d.ts.map