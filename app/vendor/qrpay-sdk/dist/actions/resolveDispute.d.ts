import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const Params: z.ZodObject<{
    orderId: z.ZodString;
    toMerchant: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    toMerchant: boolean;
}, {
    orderId: string;
    toMerchant: boolean;
}>;
export type ResolveDisputeParams = z.input<typeof Params>;
export declare const resolveDispute: (client: QrpayClient) => {
    prepare: (raw: ResolveDisputeParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: ResolveDisputeParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=resolveDispute.d.ts.map