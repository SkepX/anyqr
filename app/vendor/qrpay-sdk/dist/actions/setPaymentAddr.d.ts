import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const Params: z.ZodObject<{
    orderId: z.ZodString;
    /** ECIES ciphertext of the payment address (hex). */
    encrypted: z.ZodString;
}, "strip", z.ZodTypeAny, {
    encrypted: string;
    orderId: string;
}, {
    encrypted: string;
    orderId: string;
}>;
export type SetPaymentAddrParams = z.input<typeof Params>;
export declare const setPaymentAddr: (client: QrpayClient) => {
    prepare: (raw: SetPaymentAddrParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: SetPaymentAddrParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=setPaymentAddr.d.ts.map