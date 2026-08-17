import "server-only";
import { put, head, list } from "@vercel/blob";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Off-chain order metadata (paymentAddress, txHashes, buyerConfirmed…),
 * keyed by orderId.
 *
 * ONE BLOB PER ORDER. The previous single-JSON-array design did whole-
 * file read-modify-write from concurrent lambdas, and racing writes to
 * DIFFERENT orders silently erased each other's fields (an "I've paid"
 * write clobbered the accept record of the same order written moments
 * earlier by another lambda). Per-order files make cross-order writes
 * independent; same-order writes are rare and near-sequential.
 *
 * If BLOB_READ_WRITE_TOKEN isn't set (local dev / preview without a
 * Blob store) we fall back to an in-repo JSON file so nothing breaks.
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

const PREFIX = "qrpay-orders/";
const LEGACY_KEY = "qrpay-registry.json";
const FALLBACK_FILE = join(process.cwd(), "..", ".qrpay-registry.json");
const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

/* ---------------- local-file fallback (dev without Blob) ------------- */

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

/* ---------------- per-order blob primitives -------------------------- */

// Blob URLs are CDN-cached; a ts param forces a fresh read.
async function fetchJson(url: string): Promise<unknown | null> {
  const r = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

async function readOrderBlob(orderId: string): Promise<OrderMeta | null> {
  try {
    const info = await head(`${PREFIX}${orderId}.json`);
    return ((await fetchJson(info.url)) as OrderMeta) ?? null;
  } catch {
    return null; // BlobNotFound and friends
  }
}

async function writeOrderBlob(m: OrderMeta): Promise<void> {
  await put(`${PREFIX}${m.orderId}.json`, JSON.stringify(m), {
    access: "public",
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60, // minimum allowed — keep CDN staleness short
  });
}

/** One-shot legacy read: entries from the old single-array blob that
 *  don't have a per-order file yet. Never written back. */
async function readLegacy(): Promise<Map<string, OrderMeta>> {
  try {
    const info = await head(LEGACY_KEY);
    const arr = (await fetchJson(info.url)) as OrderMeta[] | null;
    return new Map((arr ?? []).map((m) => [m.orderId, m]));
  } catch {
    return new Map();
  }
}

/* ---------------- read cache (list+fetch fan-out is pricey) ---------- */

const CACHE_TTL_MS = 2000;
let cachedAll: Map<string, OrderMeta> | null = null;
let cachedAt = 0;

async function loadAll(): Promise<Map<string, OrderMeta>> {
  if (cachedAll && Date.now() - cachedAt < CACHE_TTL_MS) return cachedAll;
  const store = await readLegacy();
  try {
    const { blobs } = await list({ prefix: PREFIX });
    const metas = await Promise.all(
      blobs.map(async (b) => (await fetchJson(b.url)) as OrderMeta | null),
    );
    for (const m of metas) if (m?.orderId) store.set(m.orderId, m); // per-order wins
  } catch (e) {
    console.warn("[registry] list failed:", e);
    if (cachedAll) return cachedAll;
  }
  cachedAll = store;
  cachedAt = Date.now();
  return store;
}

function rememberLocally(m: OrderMeta) {
  if (cachedAll) cachedAll.set(m.orderId, m);
}

/* ---------------- public API (unchanged surface) --------------------- */

export const registry = {
  async put(m: OrderMeta) {
    if (!useBlob) {
      const store = loadFromFile();
      store.set(m.orderId, m);
      saveToFile(store);
      return;
    }
    await writeOrderBlob(m);
    rememberLocally(m);
  },

  async get(orderId: string): Promise<OrderMeta | null> {
    if (!useBlob) return loadFromFile().get(orderId) ?? null;
    const own = await readOrderBlob(orderId);
    if (own) return own;
    return (await readLegacy()).get(orderId) ?? null;
  },

  async all(): Promise<OrderMeta[]> {
    if (!useBlob) return [...loadFromFile().values()];
    return [...(await loadAll()).values()];
  },

  async patch(orderId: string, patch: Partial<OrderMeta>) {
    if (!useBlob) {
      const store = loadFromFile();
      const cur = store.get(orderId);
      if (!cur) return null;
      const next = { ...cur, ...patch };
      store.set(orderId, next);
      saveToFile(store);
      return next;
    }
    const cur = await this.get(orderId);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    await writeOrderBlob(next); // touches ONLY this order's file
    rememberLocally(next);
    return next;
  },
};
