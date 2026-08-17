/** Discriminated error type — every SDK method returns Result<T, SdkError>. */
export type SdkErrorCode =
  | "VALIDATION_ERROR"
  | "ORDER_NOT_FOUND"
  | "MALFORMED_DATUM"
  | "UTXO_NOT_FOUND"
  | "PROVIDER_ERROR"
  | "TX_BUILD_FAILED"
  | "TX_SUBMIT_FAILED"
  | "WALLET_ERROR";

export class SdkError extends Error {
  constructor(
    public code: SdkErrorCode,
    message: string,
    public cause?: unknown,
  ) {
    super(message);
    this.name = "SdkError";
  }
}

export const err = (
  code: SdkErrorCode,
  message: string,
  cause?: unknown,
): SdkError => new SdkError(code, message, cause);
