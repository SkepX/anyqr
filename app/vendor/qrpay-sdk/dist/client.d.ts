import type { LucidEvolution, Script, SpendingValidator, UTxO } from "@lucid-evolution/lucid";
import { ResultAsync } from "neverthrow";
import { SdkError } from "./errors.js";
import { OrderDatum } from "./types.js";
export interface QrpayConfig {
    /** Attached Lucid instance (wallet may or may not be selected). */
    lucid: LucidEvolution;
    /** Escrow spending validator compiled from Aiken. */
    validator: SpendingValidator & Script;
    /** USDC (or test-USDC) asset — hex policy + hex asset name. */
    usdc: {
        policyId: string;
        assetName: string;
    };
    /** Admin pkh that resolves disputes. */
    adminPkh: string;
}
/** Decorated order returned from reads. */
export interface StoredOrder {
    utxo: UTxO;
    datum: typeof OrderDatum;
}
export declare function createClient(cfg: QrpayConfig): {
    cfg: QrpayConfig;
    scriptAddress: string;
    scriptHash: string;
    usdcUnit: string;
    decodeDatum: (raw: string) => typeof OrderDatum | null;
    listOrders: () => ResultAsync<StoredOrder[], SdkError>;
    findOrderById: (orderId: string) => ResultAsync<StoredOrder, SdkError>;
    waitForStatus: (orderId: string, expected: string | readonly string[], { timeoutMs, intervalMs }?: {
        timeoutMs?: number | undefined;
        intervalMs?: number | undefined;
    }) => Promise<StoredOrder>;
};
export type QrpayClient = ReturnType<typeof createClient>;
//# sourceMappingURL=client.d.ts.map