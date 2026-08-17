"use client";
import Link from "next/link";
import { useEffect } from "react";
import { WalletButton } from "./WalletButton";
import { type Role, useWalletConnect, useWalletRole } from "../lib/wallet";

/** Wraps a page: enforces that the connected wallet is playing `expects` role.
 *  If wallet has no role yet, auto-assigns it. If wallet has the OTHER role,
 *  shows a redirect prompt. If no wallet, shows a connect prompt. */
export function RoleGuard({
  expects,
  children,
  connectPrompt,
}: {
  expects: Role;
  children: React.ReactNode;
  /** Custom pre-connect UI. Falls back to a generic prompt if omitted. */
  connectPrompt?: React.ReactNode;
}) {
  const { conn, restoring } = useWalletConnect();
  const { role, setRole, clearRole } = useWalletRole(conn?.address);

  console.log(`[roleguard] render expects=${expects}`, {
    conn: !!conn,
    restoring,
    role,
    addr: conn?.address?.slice(0, 12),
  });

  // Auto-assign role on first connect if none set.
  useEffect(() => {
    if (conn && role === null) {
      console.log(`[roleguard] auto-assign role=${expects}`);
      setRole(expects);
    }
  }, [conn, role, expects, setRole]);

  // While auto-reconnect is in flight, don't render the onboarding — it
  // would flash the user out of a valid session for a second.
  if (restoring) {
    console.log(`[roleguard] branch: restoring spinner`);
    return (
      <main className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 flex items-center justify-center px-6">
          <span className="inline-block w-6 h-6 rounded-full border-2 border-[color:var(--accent)] border-t-transparent animate-spin" />
        </div>
      </main>
    );
  }

  if (!conn) {
    console.log(`[roleguard] branch: connect-prompt (no conn)`);
    return (
      <main className="flex-1 flex flex-col">
        <TopBar />
        <div className="flex-1 flex items-center justify-center px-6 py-10">
          <div className="max-w-2xl w-full">
            {connectPrompt ?? <DefaultConnectPrompt expects={expects} />}
          </div>
        </div>
      </main>
    );
  }

  if (role && role !== expects) {
    console.log(`[roleguard] branch: MISMATCH — role=${role} expects=${expects}`);
    return (
      <MismatchPrompt
        expects={expects}
        current={role}
        onSwitch={() => setRole(expects)}
        onClear={clearRole}
      />
    );
  }

  console.log(`[roleguard] branch: children (role=${role})`);
  return <>{children}</>;
}

function DefaultConnectPrompt({ expects }: { expects: Role }) {
  return (
    <>
      <div className="eyebrow mb-3">
        {expects === "user" ? "For anyone with a wallet" : "For liquidity providers"}
      </div>
      <h1 className="display text-4xl leading-tight mb-3">
        Connect a wallet to {expects === "user" ? "start paying" : "start earning"}
      </h1>
      <p className="text-sm text-[color:var(--text-muted)] mb-6">
        Pick any Cardano wallet on the top right. This wallet becomes your{" "}
        {expects} identity for anyqr.
      </p>
      <Link href="/" className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text)]">
        ← Back to landing
      </Link>
    </>
  );
}

function MismatchPrompt({
  expects,
  current,
  onSwitch,
  onClear,
}: {
  expects: Role;
  current: Role;
  onSwitch: () => void;
  onClear: () => void;
}) {
  const otherHref = current === "user" ? "/home" : "/merchant";
  return (
    <main className="flex-1 flex flex-col">
      <TopBar />
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-md w-full">
          <div className="eyebrow mb-3">Wrong role</div>
          <h1 className="display text-3xl leading-tight mb-3">
            This wallet is registered as a {current}
          </h1>
          <p className="text-sm text-[color:var(--text-muted)] mb-6">
            A wallet can be a user or a merchant, not both. Head to the{" "}
            {current} dashboard, or switch this wallet to {expects}.
          </p>
          <div className="flex flex-col gap-2">
            <Link href={otherHref} className="btn btn-primary w-full py-3">
              Open {current} dashboard
            </Link>
            <button onClick={onSwitch} className="btn btn-ghost w-full py-3">
              Switch this wallet to {expects}
            </button>
            <button
              onClick={onClear}
              className="text-xs text-[color:var(--text-faint)] hover:text-[color:var(--text-muted)] mt-2"
            >
              Reset role for this wallet
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function TopBar() {
  return (
    <header className="border-b border-[color:var(--border)] px-6 py-4 flex items-center justify-between">
      <Link href="/" className="font-semibold tracking-tight text-lg">
        anyqr
      </Link>
      <WalletButton />
    </header>
  );
}
