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
  getApi: () => Promise<Cip30Api | null>;
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

// Cache the enabled CIP-30 api handle per wallet key. Some wallets
// (Lace especially) treat each `enable()` call as a fresh session
// that invalidates prior handles — if two `enable()` calls happen
// close together (e.g. concurrent signings), the older channel dies
// mid-flight and Lucid surfaces "RemoteApiShutdownError". Caching
// the handle guarantees we only ever hold one live session.
const enabledApis = new Map<string, Promise<Cip30Api>>();
function resetEnabledApi(key: string) {
  enabledApis.delete(key);
}

function useWalletConnectInternal(): WalletState {
  const [conn, setConn] = useState<Connection | null>(null);
  const [installed, setInstalled] = useState<DetectedWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  console.log(`[wallet] provider render`, {
    conn: conn ? { key: conn.key, addr: conn.address.slice(0, 12) } : null,
    installedKeys: installed.map((i) => i.key),
    busy,
    restoring,
    error,
  });

  useEffect(() => {
    console.log(`[wallet] detect-effect setup`);
    const scan = () =>
      setInstalled((prev) => {
        const next = detectWallets();
        if (
          prev.length === next.length &&
          prev.every((p, i) => p.key === next[i].key && p.label === next[i].label)
        ) {
          return prev;
        }
        console.log(
          `[wallet] installed changed: [${prev.map((p) => p.key).join(",")}] → [${next.map((p) => p.key).join(",")}]`,
        );
        return next;
      });
    scan();
    const iv = setInterval(scan, 2000);
    return () => {
      console.log(`[wallet] detect-effect teardown`);
      clearInterval(iv);
    };
  }, []);

  // Auto-reconnect on mount if user was connected before.
  // Wallet extensions inject window.cardano asynchronously so we poll for
  // the specific wallet's injection for a short window before giving up.
  useEffect(() => {
    console.log(`[wallet] restore-effect setup`);
    if (typeof window === "undefined") {
      setRestoring(false);
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      console.log(`[wallet] restore: no saved wallet in localStorage`);
      setRestoring(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const parsed = JSON.parse(saved) as { key: string };
        console.log(`[wallet] restore: saved=${parsed.key}, polling for injection`);
        const start = Date.now();
        let inj = readInjected()[parsed.key];
        while (!inj && Date.now() - start < 4000) {
          await new Promise((r) => setTimeout(r, 150));
          if (cancelled) return;
          inj = readInjected()[parsed.key];
        }
        if (!inj) {
          console.warn(`[wallet] restore: ${parsed.key} not injected after 4s`);
          setRestoring(false);
          return;
        }
        console.log(`[wallet] restore: injected after ${Date.now() - start}ms, calling enable`);
        const enablePromise = inj.enable();
        enabledApis.set(parsed.key, enablePromise);
        const api = await enablePromise;
        if (cancelled) return;
        const net = await api.getNetworkId();
        const addr = await getBech32Address(api, net);
        console.log(`[wallet] restore: success key=${parsed.key} net=${net} addr=${addr.slice(0, 12)}`);
        setConn({ key: parsed.key, address: addr, networkId: net });
      } catch (e) {
        console.warn(`[wallet] restore failed`, e);
        localStorage.removeItem(STORAGE_KEY);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      console.log(`[wallet] restore-effect teardown`);
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async (walletKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const inj = readInjected()[walletKey];
      if (!inj) throw new Error(`${walletKey} not installed`);
      // Fresh connect — drop any stale cached api first.
      resetEnabledApi(walletKey);
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
      resetEnabledApi(walletKey);
      setError(String(e instanceof Error ? e.message : e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (conn) resetEnabledApi(conn.key);
    setConn(null);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, [conn]);

  const getApi = useCallback(async (): Promise<Cip30Api | null> => {
    if (!conn) {
      console.log(`[wallet] getApi called with no conn`);
      return null;
    }
    const inj = readInjected()[conn.key];
    if (!inj) {
      console.warn(`[wallet] getApi: ${conn.key} not injected`);
      return null;
    }
    let p = enabledApis.get(conn.key);
    if (!p) {
      console.log(`[wallet] getApi: cache miss, calling enable() for ${conn.key}`);
      p = inj.enable();
      enabledApis.set(conn.key, p);
      p.catch((e) => {
        console.warn(`[wallet] enable() rejected for ${conn.key}`, e);
        resetEnabledApi(conn.key);
      });
    } else {
      console.log(`[wallet] getApi: cache hit for ${conn.key}`);
    }
    return p;
  }, [conn]);

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
