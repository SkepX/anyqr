/** Discriminated error type — every SDK method returns Result<T, SdkError>. */
export type SdkErrorCode = "VALIDATION_ERROR" | "ORDER_NOT_FOUND" | "MALFORMED_DATUM" | "UTXO_NOT_FOUND" | "PROVIDER_ERROR" | "TX_BUILD_FAILED" | "TX_SUBMIT_FAILED" | "WALLET_ERROR";
export declare class SdkError extends Error {
    code: SdkErrorCode;
    cause?: unknown | undefined;
    constructor(code: SdkErrorCode, message: string, cause?: unknown | undefined);
}
export declare const err: (code: SdkErrorCode, message: string, cause?: unknown) => SdkError;
//# sourceMappingURL=errors.d.ts.map