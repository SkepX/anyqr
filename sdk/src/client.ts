import type { LucidEvolution, Script, SpendingValidator, UTxO } from "@lucid-evolution/lucid";
import {
  Data,
  credentialToAddress,
  validatorToAddress,
  validatorToScriptHash,
} from "@lucid-evolution/lucid";
import { ResultAsync, okAsync, errAsync } from "neverthrow";
import { err, SdkError } from "./errors.js";
import { OrderDatum } from "./types.js";

export interface QrpayConfig {
  /** Attached Lucid instance (wallet may or may not be selected). */
  lucid: LucidEvolution;
  /** Escrow spending validator compiled from Aiken. */
  validator: SpendingValidator & Script;
  /** USDC (or test-USDC) asset — hex policy + hex asset name. */
  usdc: { policyId: string; assetName: string };
  /** Admin pkh that resolves disputes. */
  adminPkh: string;
}

/** Decorated order returned from reads. */
export interface StoredOrder {
  utxo: UTxO;
  datum: typeof OrderDatum;
}

export function createClient(cfg: QrpayConfig) {
  const scriptAddress = validatorToAddress(cfg.lucid.config().network!, cfg.validator);
  const scriptHash = validatorToScriptHash(cfg.validator);
  const usdcUnit = cfg.usdc.policyId + cfg.usdc.assetName;

  const decodeDatum = (raw: string): typeof OrderDatum | null => {
    try {
      return Data.from(raw, OrderDatum);
    } catch {
      return null;
    }
  };

  const listOrders = (): ResultAsync<StoredOrder[], SdkError> =>
    ResultAsync.fromPromise(
      cfg.lucid.utxosAt(scriptAddress),
      (e) => err("PROVIDER_ERROR", "utxosAt failed", e),
    ).map((utxos) =>
      utxos
        .map((utxo) => {
          const raw = utxo.datum ?? undefined;
          if (!raw) return null;
          const datum = decodeDatum(raw);
          if (!datum) return null;
          return { utxo, datum };
        })
        .filter((x): x is StoredOrder => x !== null),
    );

  /** Blockfrost's UTxO index can lag a block behind on-chain state. If two
   *  UTxOs share the same orderId (transient state during a state
   *  transition), we prefer the one whose status is furthest along. */
  const statusRank: Record<string, number> = {
    Placed: 0,
    Accepted: 1,
    Paid: 2,
    Disputed: 3,
  };

  const findOrderById = (
    orderId: string,
  ): ResultAsync<StoredOrder, SdkError> =>
    listOrders().andThen((all) => {
      const matches = all.filter((o) => o.datum.order_id === orderId);
      if (matches.length === 0)
        return errAsync(err("ORDER_NOT_FOUND", `no order with id ${orderId}`));
      matches.sort(
        (a, b) =>
          (statusRank[b.datum.status as string] ?? 0) -
          (statusRank[a.datum.status as string] ?? 0),
      );
      return okAsync(matches[0]!);
    });

  /** Poll until an order reaches an expected status (or list of statuses).
   *  Necessary between state transitions because indexers lag block inclusion
   *  by several seconds. */
  const waitForStatus = async (
    orderId: string,
    expected: string | readonly string[],
    { timeoutMs = 120_000, intervalMs = 3_000 } = {},
  ): Promise<StoredOrder> => {
    const targets = new Set<string>(
      Array.isArray(expected) ? expected : [expected],
    );
    const start = Date.now();
    let last: StoredOrder | null = null;
    while (Date.now() - start < timeoutMs) {
      const r = await findOrderById(orderId);
      if (r.isOk()) {
        last = r.value;
        if (targets.has(r.value.datum.status as string)) return r.value;
      }
      await new Promise((res) => setTimeout(res, intervalMs));
    }
    throw new Error(
      `waitForStatus: order ${orderId} did not reach ${[...targets].join("|")} in ${timeoutMs}ms; last=${last?.datum.status ?? "not_found"}`,
    );
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

export type QrpayClient = ReturnType<typeof createClient>;
