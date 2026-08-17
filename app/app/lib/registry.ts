import "server-only";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * On-disk registry of off-chain order metadata (payment address, payee name,
 * buyer confirmation). Keyed by orderId. Persisted to `.qrpay-registry.json`
 * at the project root so dev-server HMR doesn't nuke it.
 */

export interface OrderMeta {
  orderId: string;
  paymentAddress: string;
  payeeName: string | null;
  fiatAmount: number;
  fiatCurrency: string;
  usdcAmount: string;
  placedAt: number;
  /** Buyer's payment key hash (hex, 28 bytes). Set at registration so we can
   *  filter "my orders" by wallet without reading each datum. */
  userPkh?: string;
  /** placeOrder tx hash — kept so we can list completed orders too. */
  placeTxHash?: string;
  /** acceptOrder tx hash — set when merchant accepts. */
  acceptTxHash?: string;
  /** Merchant's payment key hash — set when they accept. */
  merchantPkh?: string;
  /** markPaid tx hash — set when buyer confirms receipt. */
  buyerConfirmedTxHash?: string;
  /** complete tx hash — set when merchant claims USDC. */
  completeTxHash?: string;
  buyerConfirmed?: number;
  // Merchant off-chain "I've sent the fiat" flag. Purely off-chain — a
  // signal to the buyer that the merchant just tapped Pay in their bank app.
  merchantPaid?: number;
}

const FILE = join(process.cwd(), "..", ".qrpay-registry.json");

function load(): Map<string, OrderMeta> {
  if (!existsSync(FILE)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as OrderMeta[];
    return new Map(raw.map((m) => [m.orderId, m]));
  } catch {
    return new Map();
  }
}

function save(store: Map<string, OrderMeta>) {
  try {
    writeFileSync(FILE, JSON.stringify([...store.values()], null, 2));
  } catch {
    /* ignore */
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __qrpayRegistry: Map<string, OrderMeta> | undefined;
}
const store = globalThis.__qrpayRegistry ?? load();
globalThis.__qrpayRegistry = store;

export const registry = {
  put(m: OrderMeta) {
    store.set(m.orderId, m);
    save(store);
  },
  get(orderId: string): OrderMeta | null {
    return store.get(orderId) ?? null;
  },
  all(): OrderMeta[] {
    return [...store.values()];
  },
  patch(orderId: string, patch: Partial<OrderMeta>) {
    const cur = store.get(orderId);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    store.set(orderId, next);
    save(store);
    return next;
  },
};
