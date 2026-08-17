import type { TxSignBuilder } from "@lucid-evolution/lucid";
import { Result, ResultAsync, okAsync } from "neverthrow";
import type { z, ZodType } from "zod";
import { SdkError } from "../errors.js";
/** Validate params with a zod schema, returning a Result of the parsed output type. */
export declare const parseParams: <S extends ZodType>(schema: S, raw: unknown) => Result<z.infer<S>, SdkError>;
/** Wrap a promise-returning tx builder call with our Result type. */
export declare const fromTx: <T>(fn: () => Promise<T>, code?: "TX_BUILD_FAILED" | "TX_SUBMIT_FAILED") => ResultAsync<T, SdkError>;
/** Sign + submit the prepared tx. */
export declare const submit: (tx: TxSignBuilder) => ResultAsync<{
    txHash: string;
}, SdkError>;
/** Convenience: prepare → sign+submit. */
export declare const executeTx: (prepared: ResultAsync<TxSignBuilder, SdkError>) => ResultAsync<{
    txHash: string;
    tx: TxSignBuilder;
}, SdkError>;
export { okAsync };
//# sourceMappingURL=_prepare.d.ts.map