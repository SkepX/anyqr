import { Data, validatorToAddress, validatorToScriptHash, } from "@lucid-evolution/lucid";
import { ResultAsync, okAsync, errAsync } from "neverthrow";
import { err } from "./errors.js";
import { OrderDatum } from "./types.js";
export function createClient(cfg) {
    const scriptAddress = validatorToAddress(cfg.lucid.config().network, cfg.validator);
    const scriptHash = validatorToScriptHash(cfg.validator);
    const usdcUnit = cfg.usdc.policyId + cfg.usdc.assetName;
    const decodeDatum = (raw) => {
        try {
            return Data.from(raw, OrderDatum);
        }
        catch {
            return null;
        }
    };
    const listOrders = () => ResultAsync.fromPromise(cfg.lucid.utxosAt(scriptAddress), (e) => err("PROVIDER_ERROR", "utxosAt failed", e)).map((utxos) => utxos
        .map((utxo) => {
        const raw = utxo.datum ?? undefined;
        if (!raw)
            return null;
        const datum = decodeDatum(raw);
        if (!datum)
            return null;
        return { utxo, datum };
    })
        .filter((x) => x !== null));
    /** Blockfrost's UTxO index can lag a block behind on-chain state. If two
     *  UTxOs share the same orderId (transient state during a state
     *  transition), we prefer the one whose status is furthest along. */
    const statusRank = {
        Placed: 0,
        Accepted: 1,
        Paid: 2,
        Disputed: 3,
    };
    const findOrderById = (orderId) => listOrders().andThen((all) => {
        const matches = all.filter((o) => o.datum.order_id === orderId);
        if (matches.length === 0)
            return errAsync(err("ORDER_NOT_FOUND", `no order with id ${orderId}`));
        matches.sort((a, b) => (statusRank[b.datum.status] ?? 0) -
            (statusRank[a.datum.status] ?? 0));
        return okAsync(matches[0]);
    });
    /** Poll until an order reaches an expected status (or list of statuses).
     *  Necessary between state transitions because indexers lag block inclusion
     *  by several seconds. */
    const waitForStatus = async (orderId, expected, { timeoutMs = 120_000, intervalMs = 3_000 } = {}) => {
        const targets = new Set(Array.isArray(expected) ? expected : [expected]);
        const start = Date.now();
        let last = null;
        while (Date.now() - start < timeoutMs) {
            const r = await findOrderById(orderId);
            if (r.isOk()) {
                last = r.value;
                if (targets.has(r.value.datum.status))
                    return r.value;
            }
            await new Promise((res) => setTimeout(res, intervalMs));
        }
        throw new Error(`waitForStatus: order ${orderId} did not reach ${[...targets].join("|")} in ${timeoutMs}ms; last=${last?.datum.status ?? "not_found"}`);
    };
    return {
        cfg,
        scriptAddress,
        scriptHash,
        usdcUnit,
        decodeDatum,
        listOrders,
        findOrderById,
        waitForStatus,
    };
}
//# sourceMappingURL=client.js.map