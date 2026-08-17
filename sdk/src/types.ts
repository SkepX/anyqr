import { Data } from "@lucid-evolution/lucid";

/**
 * Escrow order lifecycle. Field ORDER matches Aiken source order — the CBOR
 * layout depends on it. Don't reorder without updating the validator too.
 */

export const StatusSchema = Data.Enum([
  Data.Literal("Placed"),
  Data.Literal("Accepted"),
  Data.Literal("Paid"),
  Data.Literal("Disputed"),
]);
export type Status = Data.Static<typeof StatusSchema>;

export const OrderSchema = Data.Object({
  order_id: Data.Bytes(),
  user: Data.Bytes({ minLength: 28, maxLength: 28 }),
  merchant: Data.Nullable(Data.Bytes({ minLength: 28, maxLength: 28 })),
  merchant_pubkey: Data.Bytes(),
  usdc_policy: Data.Bytes(),
  usdc_name: Data.Bytes(),
  usdc_amount: Data.Integer(),
  fiat_currency: Data.Bytes(),
  fiat_amount: Data.Integer(),
  encrypted_payment_addr: Data.Bytes(),
  status: StatusSchema,
  accept_deadline: Data.Integer(),
  complete_deadline: Data.Integer(),
  dispute_deadline: Data.Integer(),
  admin: Data.Bytes({ minLength: 28, maxLength: 28 }),
});
export type OrderDatum = Data.Static<typeof OrderSchema>;
export const OrderDatum = OrderSchema as unknown as OrderDatum;

/** Redeemer variants — must match Aiken `Action` constructor order. */
export const ActionSchema = Data.Enum([
  Data.Object({
    Accept: Data.Object({
      merchant: Data.Bytes({ minLength: 28, maxLength: 28 }),
      merchant_pubkey: Data.Bytes(),
    }),
  }),
  Data.Object({
    SetPaymentAddr: Data.Object({
      encrypted: Data.Bytes(),
    }),
  }),
  Data.Literal("MarkPaid"),
  Data.Literal("Complete"),
  Data.Literal("CancelUnaccepted"),
  Data.Literal("Refund"),
  Data.Literal("RaiseDispute"),
  Data.Object({
    Resolve: Data.Object({
      to_merchant: Data.Boolean(),
    }),
  }),
]);
export type Action = Data.Static<typeof ActionSchema>;
export const Action = ActionSchema as unknown as Action;
