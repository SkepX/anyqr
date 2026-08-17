import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const Params: z.ZodObject<{
    orderId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId: string;
}, {
    orderId: string;
}>;
export type RefundParams = z.input<typeof Params>;
export declare const refund: (client: QrpayClient) => {
    prepare: (raw: RefundParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: RefundParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=refund.d.ts.map