import { ResultAsync, ok, err as nerr, okAsync } from "neverthrow";
import { err } from "../errors.js";
/** Validate params with a zod schema, returning a Result of the parsed output type. */
export const parseParams = (schema, raw) => {
    const r = schema.safeParse(raw);
    return r.success
        ? ok(r.data)
        : nerr(err("VALIDATION_ERROR", r.error.message, r.error));
};
/** Wrap a promise-returning tx builder call with our Result type. */
export const fromTx = (fn, code = "TX_BUILD_FAILED") => ResultAsync.fromPromise(fn(), (e) => err(code, String(e), e));
/** Sign + submit the prepared tx. */
export const submit = (tx) => fromTx(async () => {
    const signed = await tx.sign.withWallet().complete();
    const hash = await signed.submit();
    return { txHash: hash };
}, "TX_SUBMIT_FAILED");
/** Convenience: prepare → sign+submit. */
export const executeTx = (prepared) => prepared.andThen((tx) => submit(tx).map((r) => ({ txHash: r.txHash, tx })));
export { okAsync };
//# sourceMappingURL=_prepare.js.map