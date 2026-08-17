import type { TxSignBuilder } from "@lucid-evolution/lucid";
import { Result, ResultAsync, ok, err as nerr, okAsync } from "neverthrow";
import type { z, ZodType } from "zod";
import { err, SdkError } from "../errors.js";

/** Validate params with a zod schema, returning a Result of the parsed output type. */
export const parseParams = <S extends ZodType>(
  schema: S,
  raw: unknown,
): Result<z.infer<S>, SdkError> => {
  const r = schema.safeParse(raw);
  return r.success
    ? ok(r.data)
    : nerr(err("VALIDATION_ERROR", r.error.message, r.error));
};

/** Wrap a promise-returning tx builder call with our Result type. */
export const fromTx = <T>(
  fn: () => Promise<T>,
  code: "TX_BUILD_FAILED" | "TX_SUBMIT_FAILED" = "TX_BUILD_FAILED",
): ResultAsync<T, SdkError> =>
  ResultAsync.fromPromise(fn(), (e) => err(code, String(e), e));

/** Sign + submit the prepared tx. */
export const submit = (
  tx: TxSignBuilder,
): ResultAsync<{ txHash: string }, SdkError> =>
  fromTx(async () => {
    const signed = await tx.sign.withWallet().complete();
    const hash = await signed.submit();
    return { txHash: hash };
  }, "TX_SUBMIT_FAILED");

/** Convenience: prepare → sign+submit. */
export const executeTx = (
  prepared: ResultAsync<TxSignBuilder, SdkError>,
): ResultAsync<{ txHash: string; tx: TxSignBuilder }, SdkError> =>
  prepared.andThen((tx) =>
    submit(tx).map((r) => ({ txHash: r.txHash, tx })),
  );

export { okAsync };
