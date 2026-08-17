"use client";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** CIP-30 wallets we know how to detect + label. */
export const KNOWN_WALLETS = [
  { key: "lace", label: "Lace" },
  { key: "eternl", label: "Eternl" },
  { key: "nami", label: "Nami" },
  { key: "vespr", label: "Vespr" },
  { key: "typhoncip30", label: "Typhon" },
  { key: "yoroi", label: "Yoroi" },
  { key: "gerowallet", label: "GeroWallet" },
  { key: "nufi", label: "NuFi" },
  { key: "flint", label: "Flint" },
] as const;

export interface DetectedWallet {
  key: string;
  label: string;
  icon?: string;
  version?: string;
}

// Minimal CIP-30 typings for what we actually consume.
interface Cip30Injection {
  apiVersion?: string;
  name?: string;
  icon?: string;
  enable: () => Promise<Cip30Api>;
  isEnabled?: () => Promise<boolean>;
}
export interface Cip30Api {
  getUsedAddresses: () => Promise<string[]>;
  getUnusedAddresses: () => Promise<string[]>;
  getChangeAddress: () => Promise<string>;
  getNetworkId: () => Promise<number>; // 0 = testnet, 1 = mainnet
  getBalance: () => Promise<string>; // hex-encoded cbor
  signTx: (tx: string, partial?: boolean) => Promise<string>;
  submitTx: (tx: string) => Promise<string>;
}

type Cardano = Record<string, Cip30Injection | undefined>;

function readInjected(): Cardano {
  if (typeof window === "undefined") return {};
  return (window as unknown as { cardano?: Cardano }).cardano ?? {};
}

export function detectWallets(): DetectedWallet[] {
  const c = readInjected();
  const found: DetectedWallet[] = [];
  for (const { key, label } of KNOWN_WALLETS) {
    const inj = c[key];
    if (!inj) continue;
    found.push({
      key,
      label: inj.name ?? label,
      icon: inj.icon,
      version: inj.apiVersion,
    });
  }
  return found;
}

const STORAGE_KEY = "qrpay:wallet";

export interface Connection {
  key: string; // wallet key (lace, eternl, ...)
  address: string; // bech32 base or enterprise addr
  networkId: number; // 0 preprod/preview, 1 mainnet
}

interface WalletState {
  conn: Connection | null;
  installed: DetectedWallet[];
  busy: boolean;
  /** True while we're attempting to auto-reconnect from localStorage on mount.
   *  Consumers should show a spinner instead of a "connect" prompt during this. */
  restoring: boolean;
  error: string | null;
  connect: (walletKey: string) => Promise<Connection>;
  disconnect: () => void;
  getApi: (opts?: { fresh?: boolean }) => Promise<Cip30Api | null>;
}

const WalletCtx = createContext<WalletState | null>(null);

/** Global provider — mount once at the app root so every consumer shares
 *  a single connection state. */
export function WalletProvider({ children }: { children: ReactNode }) {
  const value = useWalletConnectInternal();
  return createElement(WalletCtx.Provider, { value }, children);
}

/** Public hook — reads the shared context. Falls back to a fresh internal
 *  instance if the provider isn't mounted (for safety, though the layout
 *  wraps everything). */
export function useWalletConnect(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) {
    // Provider must be mounted — layout wraps everything in WalletProvider.
    // Failing loud here is better than silently spawning per-consumer state
    // (each with its own polling intervals) that would cause render churn.
    throw new Error("useWalletConnect: WalletProvider missing above this tree");
  }
  return ctx;
}

// Cache the enabled api handle per wallet key. Lucid needs a single
// stable api reference throughout a single tx.complete() -> sign -> submit
// flow. Handing it a fresh handle on every call (or a proxy that
// re-enables) breaks Lace, which hangs its second enable() silently.
// getApi() only re-enables after a probe proves the cached channel dead.
const enabledApis = new Map<string, Promise<Cip30Api>>();

// Wallet extensions built on @cardano-sdk/web-extension (Lace, Begin)
// run their API through a message channel to an MV3 service worker.
// Chrome kills that worker after ~30s of inactivity, and the extension
// permanently invalidates every handle handed out before the kill:
// "RemoteApiShutdownError: Remote API with channel 'cardano-wallet-api'
// was shutdown: object can no longer be used". The only remedy is a
// fresh enable().
const DEAD_CHANNEL_RE =
  /shutdown|no longer be used|disconnected port|context invalidated|channel closed/i;

export function isDeadChannelError(e: unknown): boolean {
  const msg = (e as { message?: string })?.message;
  return DEAD_CHANNEL_RE.test(typeof msg === "string" ? msg : String(e));
}

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${what} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Run `fn` while pinging the wallet every 10s. A long tx build (30s+ of
 *  Blockfrost/UPLC work with zero wallet traffic) otherwise lets Chrome
 *  idle-kill the extension's service worker, so the signTx at the end
 *  lands on a dead channel. Each ping resets Chrome's ~30s idle timer. */
export async function withWalletKeepAlive<T>(
  api: Cip30Api,
  fn: () => Promise<T>,
): Promise<T> {
  const iv = setInterval(() => {
    void api.getNetworkId().catch(() => {});
  }, 10_000);
  try {
    return await fn();
  } finally {
    clearInterval(iv);
  }
}

function useWalletConnectInternal(): WalletState {
  const [conn, setConn] = useState<Connection | null>(null);
  const [installed, setInstalled] = useState<DetectedWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);


  useEffect(() => {
    const scan = () =>
      setInstalled((prev) => {
        const next = detectWallets();
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.key === next[i].key && p.label === next[i].label)
        ) {
          return prev;
        }
        return next;
      });
    scan();
    const iv = setInterval(scan, 2000);
    return () => clearInterval(iv);
  }, []);

  // Auto-reconnect on mount if user was connected before.
  // Wallet extensions inject window.cardano asynchronously so we poll for
  // the specific wallet's injection for a short window before giving up.
  useEffect(() => {
    if (typeof window === "undefined") {
      setRestoring(false);
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const parsed = JSON.parse(saved) as { key: string };
        const start = Date.now();
        let inj = readInjected()[parsed.key];
        while (!inj && Date.now() - start < 4000) {
          await new Promise((r) => setTimeout(r, 150));
          if (cancelled) return;
          inj = readInjected()[parsed.key];
        }
        if (!inj) {
          setRestoring(false);
          return;
        }
        const enablePromise = inj.enable();
        enabledApis.set(parsed.key, enablePromise);
        const api = await enablePromise;
        if (cancelled) return;
        const net = await api.getNetworkId();
        const addr = await getBech32Address(api, net);
        setConn({ key: parsed.key, address: addr, networkId: net });
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (walletKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const inj = readInjected()[walletKey];
      if (!inj) throw new Error(`${walletKey} not installed`);
      enabledApis.delete(walletKey);
      const enablePromise = inj.enable();
      enabledApis.set(walletKey, enablePromise);
      const api = await enablePromise;
      const net = await api.getNetworkId();
      const addr = await getBech32Address(api, net);
      const conn = { key: walletKey, address: addr, networkId: net };
      setConn(conn);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
      return conn;
    } catch (e) {
      enabledApis.delete(walletKey);
      setError(String(e instanceof Error ? e.message : e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (conn) enabledApis.delete(conn.key);
    setConn(null);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, [conn]);

  /** Return the CIP-30 api handle for the connected wallet.
   *  Reuses the enable() promise established at connect / restore time —
   *  hand Lucid the SAME api reference for the whole tx flow. Before
   *  returning a cached handle, probe it with a cheap getNetworkId():
   *  the extension's service worker may have idled out since we cached
   *  it, permanently killing the handle's channel. Only then (or when
   *  the caller passes { fresh: true } after a mid-flow death) do we
   *  re-enable for a new channel — the origin is already authorized so
   *  no popup appears. */
  const getApi = useCallback(
    async (opts?: { fresh?: boolean }): Promise<Cip30Api | null> => {
      if (!conn) return null;
      if (opts?.fresh) enabledApis.delete(conn.key);
      const cached = enabledApis.get(conn.key);
      if (cached) {
        try {
          const api = await cached;
          await withDeadline(api.getNetworkId(), 3_000, "wallet probe");
          return api;
        } catch {
          enabledApis.delete(conn.key);
        }
      }
      const inj = readInjected()[conn.key];
      if (!inj) return null;
      // 15s cap so a wedged extension surfaces as an error instead of
      // an infinite spinner (Lace has been seen hanging enable()).
      const p = withDeadline(inj.enable(), 15_000, "wallet enable()");
      enabledApis.set(conn.key, p);
      p.catch(() => enabledApis.delete(conn.key));
      return p;
    },
    [conn],
  );

  return useMemo(
    () => ({ conn, installed, busy, restoring, error, connect, disconnect, getApi }),
    [conn, installed, busy, restoring, error, connect, disconnect, getApi],
  );
}

export function shortAddr(a: string, n = 6): string {
  return a.length <= n * 2 + 3 ? a : `${a.slice(0, n)}…${a.slice(-n)}`;
}

/* ------------------------------------------------------------------ */
/* Per-wallet role: a given wallet is either a User or a Merchant, not
   both at the same time. Stored in localStorage keyed by address. */

export type Role = "user" | "merchant";
const ROLE_STORAGE = "qrpay:role";

interface RoleMap { [address: string]: Role }
function loadRoles(): RoleMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(ROLE_STORAGE) ?? "{}") as RoleMap;
  } catch {
    return {};
  }
}
function saveRoles(m: RoleMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ROLE_STORAGE, JSON.stringify(m));
}

export function useWalletRole(address: string | null | undefined) {
  const [role, setRoleState] = useState<Role | null>(null);
  useEffect(() => {
    if (!address) {
      setRoleState(null);
      return;
    }
    setRoleState(loadRoles()[address] ?? null);
  }, [address]);
  const setRole = useCallback(
    (r: Role) => {
      if (!address) return;
      const map = loadRoles();
      map[address] = r;
      saveRoles(map);
      setRoleState(r);
    },
    [address],
  );
  const clearRole = useCallback(() => {
    if (!address) return;
    const map = loadRoles();
    delete map[address];
    saveRoles(map);
    setRoleState(null);
  }, [address]);
  return { role, setRole, clearRole };
}

/** CIP-30 wallets return addresses as raw hex (CBOR-encoded bytes).
 *  Blockfrost + Lucid want bech32. Convert via Lucid's CML shim. Returns
 *  bech32 already if the wallet gave us one (some wallets do). */
async function getBech32Address(
  api: Cip30Api,
  networkId: number,
): Promise<string> {
  const raw =
    (await api.getUsedAddresses())[0] ?? (await api.getChangeAddress());
  if (raw.startsWith("addr")) return raw;
  // Lazy-load Lucid + CML to keep bundle small if user never connects.
  const { CML } = await import("@lucid-evolution/lucid");
  const addr = CML.Address.from_hex(raw);
  const bech = addr.to_bech32(networkId === 0 ? "addr_test" : "addr");
  return bech;
}
