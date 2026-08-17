import { Data } from "@lucid-evolution/lucid";
/**
 * Escrow order lifecycle. Field ORDER matches Aiken source order — the CBOR
 * layout depends on it. Don't reorder without updating the validator too.
 */
export declare const StatusSchema: import("@lucid-evolution/lucid").TUnion<(import("@lucid-evolution/lucid").TLiteral<"Placed"> | import("@lucid-evolution/lucid").TLiteral<"Accepted"> | import("@lucid-evolution/lucid").TLiteral<"Paid"> | import("@lucid-evolution/lucid").TLiteral<"Disputed">)[]>;
export type Status = Data.Static<typeof StatusSchema>;
export declare const OrderSchema: import("@lucid-evolution/lucid").TObject<{
    order_id: import("@lucid-evolution/lucid").TUnsafe<string>;
    user: import("@lucid-evolution/lucid").TUnsafe<string>;
    merchant: import("@lucid-evolution/lucid").TUnsafe<string | null>;
    merchant_pubkey: import("@lucid-evolution/lucid").TUnsafe<string>;
    usdc_policy: import("@lucid-evolution/lucid").TUnsafe<string>;
    usdc_name: import("@lucid-evolution/lucid").TUnsafe<string>;
    usdc_amount: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    fiat_currency: import("@lucid-evolution/lucid").TUnsafe<string>;
    fiat_amount: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    encrypted_payment_addr: import("@lucid-evolution/lucid").TUnsafe<string>;
    status: import("@lucid-evolution/lucid").TUnion<(import("@lucid-evolution/lucid").TLiteral<"Placed"> | import("@lucid-evolution/lucid").TLiteral<"Accepted"> | import("@lucid-evolution/lucid").TLiteral<"Paid"> | import("@lucid-evolution/lucid").TLiteral<"Disputed">)[]>;
    accept_deadline: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    complete_deadline: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    dispute_deadline: import("@lucid-evolution/lucid").TUnsafe<bigint>;
    admin: import("@lucid-evolution/lucid").TUnsafe<string>;
}>;
export type OrderDatum = Data.Static<typeof OrderSchema>;
export declare const OrderDatum: OrderDatum;
/** Redeemer variants — must match Aiken `Action` constructor order. */
export declare const ActionSchema: import("@lucid-evolution/lucid").TUnion<(import("@lucid-evolution/lucid").TObject<{
    Accept: import("@lucid-evolution/lucid").TObject<{
        merchant: import("@lucid-evolution/lucid").TUnsafe<string>;
        merchant_pubkey: import("@lucid-evolution/lucid").TUnsafe<string>;
    }>;
}> | import("@lucid-evolution/lucid").TObject<{
    SetPaymentAddr: import("@lucid-evolution/lucid").TObject<{
        encrypted: import("@lucid-evolution/lucid").TUnsafe<string>;
    }>;
}> | import("@lucid-evolution/lucid").TLiteral<"MarkPaid"> | import("@lucid-evolution/lucid").TLiteral<"Complete"> | import("@lucid-evolution/lucid").TLiteral<"CancelUnaccepted"> | import("@lucid-evolution/lucid").TLiteral<"Refund"> | import("@lucid-evolution/lucid").TLiteral<"RaiseDispute"> | import("@lucid-evolution/lucid").TObject<{
    Resolve: import("@lucid-evolution/lucid").TObject<{
        to_merchant: import("@lucid-evolution/lucid").TUnsafe<boolean>;
    }>;
}>)[]>;
export type Action = Data.Static<typeof ActionSchema>;
export declare const Action: Action;
//# sourceMappingURL=types.d.ts.map