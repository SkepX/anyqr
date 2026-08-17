import { Data, paymentCredentialOf } from "@lucid-evolution/lucid";
import type { LucidEvolution, TxBuilder } from "@lucid-evolution/lucid";
import type { QrpayClient, StoredOrder } from "../client.js";
import { OrderDatum, Action } from "../types.js";

/** Compute my wallet's payment key hash. */
export const walletPkh = async (lucid: LucidEvolution): Promise<string> => {
  const addr = await lucid.wallet().address();
  return paymentCredentialOf(addr).hash;
};

/** Build the base of a script-spending tx: collect the escrow UTXO with a
 *  redeemer and attach the validator. */
export const beginSpend = (
  client: QrpayClient,
  order: StoredOrder,
  redeemer: typeof Action,
): TxBuilder =>
  client.cfg.lucid
    .newTx()
    .collectFrom([order.utxo], Data.to(redeemer, Action))
    .attach.SpendingValidator(client.cfg.validator);

/** Continue-output value = the same locked USDC amount. */
export const escrowValue = (client: QrpayClient, order: StoredOrder) => ({
  [client.usdcUnit]: order.datum.usdc_amount,
});

/** Encode a new datum as inline. */
export const inlineDatum = (order: typeof OrderDatum) => ({
  kind: "inline" as const,
  value: Data.to(order, OrderDatum),
});
