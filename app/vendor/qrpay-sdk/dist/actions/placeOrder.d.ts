import { z } from "zod";
import type { QrpayClient } from "../client.js";
declare const ParamsSchema: z.ZodObject<{
    /** Client-generated unique id — hex, ≤ 64 chars. Recommend random 16 bytes. */
    orderId: z.ZodString;
    /** USDC (6dp) locked into escrow. */
    usdcAmount: z.ZodBigInt;
    /** Fiat amount in smallest unit (paise). */
    fiatAmount: z.ZodBigInt;
    /** ISO/informal ccy code, e.g. "INR". */
    fiatCurrency: z.ZodString;
    /** Minutes from now until user can cancel a still-unaccepted order. */
    acceptWindowMin: z.ZodDefault<z.ZodNumber>;
    /** Minutes from now after which user can force-refund. */
    completeWindowMin: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    orderId: string;
    usdcAmount: bigint;
    fiatAmount: bigint;
    fiatCurrency: string;
    acceptWindowMin: number;
    completeWindowMin: number;
}, {
    orderId: string;
    usdcAmount: bigint;
    fiatAmount: bigint;
    fiatCurrency: string;
    acceptWindowMin?: number | undefined;
    completeWindowMin?: number | undefined;
}>;
export type PlaceOrderParams = z.input<typeof ParamsSchema>;
export declare const placeOrder: (client: QrpayClient) => {
    prepare: (raw: PlaceOrderParams) => import("neverthrow").ResultAsync<import("@lucid-evolution/lucid").TxSignBuilder, import("../errors.js").SdkError>;
    execute: (raw: PlaceOrderParams) => import("neverthrow").ResultAsync<{
        txHash: string;
        tx: import("@lucid-evolution/lucid").TxSignBuilder;
    }, import("../errors.js").SdkError>;
};
export {};
//# sourceMappingURL=placeOrder.d.ts.map