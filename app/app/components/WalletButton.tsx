"use client";
import { useState } from "react";
import { KNOWN_WALLETS, shortAddr, useWalletConnect } from "../lib/wallet";

/**
 * Mini stylised QR — 3 finder squares + a scatter of data cells. Currentcolor.
 * Shared across headers so the "anyqr" logo box has a visible QR inside it.
 */
export function QrLogo({ className = "w-full h-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M2 2h7v7H2V2zm2 2v3h3V4H4z" />
      <rect x="5" y="5" width="1" height="1" />
      <path d="M15 2h7v7h-7V2zm2 2v3h3V4h-3z" />
      <rect x="18" y="5" width="1" height="1" />
      <path d="M2 15h7v7H2v-7zm2 2v3h3v-3H4z" />
      <rect x="5" y="18" width="1" height="1" />
      <rect x="11" y="2" width="2" height="2" />
      <rect x="11" y="6" width="2" height="2" />
      <rect x="15" y="11" width="2" height="2" />
      <rect x="19" y="11" width="2" height="2" />
      <rect x="11" y="15" width="2" height="2" />
      <rect x="15" y="15" width="2" height="2" />
      <rect x="19" y="19" width="2" height="2" />
      <rect x="11" y="19" width="2" height="2" />
      <rect x="15" y="19" width="2" height="2" />
    </svg>
  );
}

export function WalletButton() {
  const { conn, installed, busy, error, connect, disconnect } = useWalletConnect();
  const [open, setOpen] = useState(false);

  if (conn) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[color:var(--border)] bg-[color:var(--surface)] hover:bg-[color:var(--surface-alt)] text-sm"
        >
          <span className="w-2 h-2 rounded-full bg-[color:var(--accent)]" />
          <span className="font-mono text-xs">{shortAddr(conn.address, 5)}</span>
          <span className="text-[color:var(--text-muted)] text-xs">▾</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2 w-64 card z-40">
            <div className="text-xs text-[color:var(--text-muted)] mb-1">
              Connected via {conn.key}
              {conn.networkId !== 0 && (
                <span className="ml-2 text-[color:var(--warning)]">
                  ⚠ wrong network
                </span>
              )}
            </div>
            <div className="font-mono text-xs break-all mb-3">{conn.address}</div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(conn.address);
              }}
              className="btn btn-ghost w-full text-sm mb-2"
            >
              Copy address
            </button>
            <button
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
              className="btn btn-ghost w-full text-sm"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="btn btn-primary text-sm py-2 px-3"
      >
        {busy ? "Connecting…" : "Connect wallet"}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-72 card z-40">
          <div className="text-sm font-medium mb-3">Choose a wallet</div>
          {installed.length === 0 && (
            <div className="text-xs text-[color:var(--text-muted)] mb-3">
              No Cardano wallets detected. Install one:
              <div className="flex flex-wrap gap-1.5 mt-2">
                {KNOWN_WALLETS.slice(0, 4).map((w) => (
                  <span
                    key={w.key}
                    className="pill !bg-[color:var(--surface)] !text-[color:var(--text-muted)]"
                  >
                    {w.label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <ul className="flex flex-col gap-1">
            {installed.map((w) => (
              <li key={w.key}>
                <button
                  onClick={async () => {
                    try {
                      await connect(w.key);
                      setOpen(false);
                    } catch {
                      /* error shown below */
                    }
                  }}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[color:var(--surface)] text-left"
                >
                  {w.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={w.icon} alt="" className="w-6 h-6 rounded" />
                  ) : (
                    <span className="w-6 h-6 rounded bg-[color:var(--surface-alt)]" />
                  )}
                  <span className="flex-1 text-sm">{w.label}</span>
                  {w.version && (
                    <span className="text-[10px] text-[color:var(--text-faint)] font-mono">
                      v{w.version}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {error && (
            <div className="text-xs text-[color:var(--warning)] mt-2">{error}</div>
          )}
        </div>
      )}
    </div>
  );
}
