import "server-only";
import { put, head } from "@vercel/blob";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Off-chain order metadata (paymentAddress, txHashes, buyerConfirmed…),
 * keyed by orderId. Backed by Vercel Blob so writes propagate across
 * lambda instances — the previous file-based approach lived per-lambda
 * and caused paymentAddress to blink to null for merchants whose polls
 * bounced to a "cold" lambda without the meta.
 *
 * If BLOB_READ_WRITE_TOKEN isn't set (local dev / preview without a
 * Blob store) we fall back to the in-repo JSON file so nothing breaks.
 */

export interface OrderMeta {
  orderId: string;
  paymentAddress: string;
  payeeName: string | null;
  fiatAmount: number;
  fiatCurrency: string;
  usdcAmount: string;
  placedAt: number;
  userPkh?: string;
  placeTxHash?: string;
  acceptTxHash?: string;
  merchantPkh?: string;
  /** Merchant's full bech32 address — recorded at accept so the server
   *  can release escrow to it without the merchant signing. */
  merchantAddress?: string;
  /** Set while the server-side release is being attempted (dedup guard). */
  completingAt?: number;
  buyerConfirmedTxHash?: string;
  completeTxHash?: string;
  buyerConfirmed?: number;
  merchantPaid?: number;
}

const BLOB_KEY = "qrpay-registry.json";
const FALLBACK_FILE = join(process.cwd(), "..", ".qrpay-registry.json");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

// Short-lived in-memory cache to keep merchant polling (every 4s per
// tab, ~1 read per poll) from hammering the Blob endpoint. Writes
// invalidate immediately so we always read our own writes.
const CACHE_TTL_MS = 1500;
let cachedStore: Map<string, OrderMeta> | null = null;
let cachedAt = 0;

function loadFromFile(): Map<string, OrderMeta> {
  if (!existsSync(FALLBACK_FILE)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(FALLBACK_FILE, "utf8")) as OrderMeta[];
    return new Map(raw.map((m) => [m.orderId, m]));
  } catch {
    return new Map();
  }
}
function saveToFile(store: Map<string, OrderMeta>) {
  try {
    writeFileSync(FALLBACK_FILE, JSON.stringify([...store.values()], null, 2));
  } catch {
    /* ignore */
  }
}

async function loadFromBlob(): Promise<Map<string, OrderMeta>> {
  try {
    const info = await head(BLOB_KEY);
    const r = await fetch(info.url, { cache: "no-store" });
    if (!r.ok) throw new Error(`blob fetch ${r.status}`);
    const arr = (await r.json()) as OrderMeta[];
    return new Map(arr.map((m) => [m.orderId, m]));
  } catch (e) {
    // First-run: Blob returns 404 for head() when key doesn't exist yet.
    // Any other failure — return the last-known cache or an empty map.
    if ((e as { name?: string })?.name !== "BlobNotFoundError")
      console.warn("[registry] loadFromBlob failed:", e);
    return cachedStore ?? new Map();
  }
}

async function saveToBlob(store: Map<string, OrderMeta>) {
  await put(BLOB_KEY, JSON.stringify([...store.values()]), {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

async function load(): Promise<Map<string, OrderMeta>> {
  if (!useBlob) return loadFromFile();
  if (cachedStore && Date.now() - cachedAt < CACHE_TTL_MS) return cachedStore;
  cachedStore = await loadFromBlob();
  cachedAt = Date.now();
  return cachedStore;
}

async function save(store: Map<string, OrderMeta>) {
  if (!useBlob) {
    saveToFile(store);
    return;
  }
  await saveToBlob(store);
  cachedStore = store;
  cachedAt = Date.now();
}

export const registry = {
  async put(m: OrderMeta) {
    const store = await load();
    store.set(m.orderId, m);
    await save(store);
  },
  async get(orderId: string): Promise<OrderMeta | null> {
    const store = await load();
    return store.get(orderId) ?? null;
  },
  async all(): Promise<OrderMeta[]> {
    const store = await load();
    return [...store.values()];
  },
  async patch(orderId: string, patch: Partial<OrderMeta>) {
    const store = await load();
    const cur = store.get(orderId);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    store.set(orderId, next);
    await save(store);
    return next;
  },
};
