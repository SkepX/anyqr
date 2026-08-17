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
  const fallback = useWalletConnectInternal();
  return ctx ?? fallback;
}

function useWalletConnectInternal(): WalletState {
  const [conn, setConn] = useState<Connection | null>(null);
  const [installed, setInstalled] = useState<DetectedWallet[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Detect on mount + when window.cardano might change (dev)
  useEffect(() => {
    const scan = () => setInstalled(detectWallets());
    scan();
    const iv = setInterval(scan, 2000);
    return () => clearInterval(iv);
  }, []);

  // Auto-reconnect on mount if user was connected before
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    (async () => {
      try {
        const parsed = JSON.parse(saved) as { key: string };
        const inj = readInjected()[parsed.key];
        if (!inj) return;
        const api = await inj.enable();
        const net = await api.getNetworkId();
        const addr = await getBech32Address(api, net);
        setConn({ key: parsed.key, address: addr, networkId: net });
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    })();
  }, []);

  const connect = useCallback(async (walletKey: string) => {
    setBusy(true);
    setError(null);
    try {
      const inj = readInjected()[walletKey];
      if (!inj) throw new Error(`${walletKey} not installed`);
      const api = await inj.enable();
      const net = await api.getNetworkId();
      const addr = await getBech32Address(api, net);
      const conn = { key: walletKey, address: addr, networkId: net };
      setConn(conn);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conn));
      return conn;
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      throw e;
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setConn(null);
    if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
  }, []);

  /** Return a fresh CIP-30 API handle for the currently-connected wallet. */
  const getApi = useCallback(async (): Promise<Cip30Api | null> => {
    if (!conn) return null;
    const inj = readInjected()[conn.key];
    if (!inj) return null;
    return inj.enable();
  }, [conn]);

  return useMemo(
    () => ({ conn, installed, busy, error, connect, disconnect, getApi }),
    [conn, installed, busy, error, connect, disconnect, getApi],
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
