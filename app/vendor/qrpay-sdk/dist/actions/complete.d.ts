import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const Params: z.ZodObject<{
    orderId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId: string;
}, {
    orderId: string;
}>;
export type CompleteParams = z.input<typeof Params>;
export declare const complete: (client: QrpayClient) => {
    prepare: (raw: CompleteParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: CompleteParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=complete.d.ts.map