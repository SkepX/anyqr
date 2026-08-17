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

/* ---------------- append-only event primitives ----------------------- */
/* Read-modify-write of a shared file loses updates: two lambdas patch
 * the same order within the CDN's staleness window and the later write
 * erases the earlier one's fields (observed: merchant identity vanished
 * from completed orders, freezing the earnings tally). Every patch is
 * now its OWN immutable file — `qrpay-orders/{id}/{ts}-{rand}.json` —
 * and reads merge all of them chronologically. Concurrent writes can no
 * longer erase anything. A `null` field value means "clear this key".
 * Legacy single-file and per-order-blob formats remain read-only bases. */

// Blob URLs are CDN-cached; a ts param forces a fresh read.
async function fetchJson(url: string): Promise<unknown | null> {
  const r = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) return null;
  return r.json();
}

type MetaEvent = Partial<Record<keyof OrderMeta, unknown>> & { orderId: string };

function mergeEvent(base: Partial<OrderMeta>, ev: MetaEvent): Partial<OrderMeta> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(ev)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out as Partial<OrderMeta>;
}

async function writeEvent(orderId: string, ev: Partial<OrderMeta>): Promise<void> {
  const name = `${PREFIX}${orderId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json`;
  await put(name, JSON.stringify({ ...ev, orderId }), {
    access: "public",
    allowOverwrite: false,
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

/** Read the v2 single-blob base for an order (read-only legacy). */
async function readOrderBlob(orderId: string): Promise<OrderMeta | null> {
  try {
    const info = await head(`${PREFIX}${orderId}.json`);
    return ((await fetchJson(info.url)) as OrderMeta) ?? null;
  } catch {
    return null; // BlobNotFound and friends
  }
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
    // v2 bases: qrpay-orders/{id}.json — apply before events.
    const bases = blobs.filter((b) => /^qrpay-orders\/[^/]+\.json$/.test(b.pathname));
    // v3 events: qrpay-orders/{id}/{ts}-{rand}.json — chronological by name.
    const events = blobs
      .filter((b) => /^qrpay-orders\/[^/]+\/.+\.json$/.test(b.pathname))
      .sort((a, b) => a.pathname.localeCompare(b.pathname));
    const baseMetas = await Promise.all(
      bases.map(async (b) => (await fetchJson(b.url)) as OrderMeta | null),
    );
    for (const m of baseMetas) if (m?.orderId) store.set(m.orderId, m);
    const evs = await Promise.all(
      events.map(async (b) => (await fetchJson(b.url)) as MetaEvent | null),
    );
    for (const ev of evs) {
      if (!ev?.orderId) continue;
      store.set(
        ev.orderId,
        mergeEvent(store.get(ev.orderId) ?? {}, ev) as OrderMeta,
      );
    }
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
    await writeEvent(m.orderId, m);
    rememberLocally(m);
  },

  async get(orderId: string): Promise<OrderMeta | null> {
    if (!useBlob) return loadFromFile().get(orderId) ?? null;
    // Base (legacy formats), then replay this order's events.
    let acc: Partial<OrderMeta> | null =
      (await readOrderBlob(orderId)) ?? (await readLegacy()).get(orderId) ?? null;
    try {
      const { blobs } = await list({ prefix: `${PREFIX}${orderId}/` });
      blobs.sort((a, b) => a.pathname.localeCompare(b.pathname));
      for (const b of blobs) {
        const ev = (await fetchJson(b.url)) as MetaEvent | null;
        if (ev?.orderId) acc = mergeEvent(acc ?? {}, ev);
      }
    } catch {}
    return acc && acc.orderId ? (acc as OrderMeta) : null;
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
    await writeEvent(orderId, patch); // its own immutable file — no clobber
    const next = mergeEvent(cur, { ...patch, orderId }) as OrderMeta;
    rememberLocally(next);
    return next;
  },
};
