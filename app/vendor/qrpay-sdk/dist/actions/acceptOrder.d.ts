import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const Params: z.ZodObject<{
    orderId: z.ZodString;
    merchantPublicKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    merchantPublicKey: string;
}, {
    orderId: string;
    merchantPublicKey: string;
}>;
export type AcceptOrderParams = z.input<typeof Params>;
export declare const acceptOrder: (client: QrpayClient) => {
    prepare: (raw: AcceptOrderParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: AcceptOrderParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=acceptOrder.d.ts.map