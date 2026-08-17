import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const Params: z.ZodObject<{
    orderId: z.ZodString;
    /** Minutes of dispute window before merchant can complete. 10–30 accepted
     *  on-chain; default 15. */
    disputeWindowMin: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    disputeWindowMin: number;
}, {
    orderId: string;
    disputeWindowMin?: number | undefined;
}>;
export type MarkPaidParams = z.input<typeof Params>;
export declare const markPaid: (client: QrpayClient) => {
    prepare: (raw: MarkPaidParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: MarkPaidParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=markPaid.d.ts.map