import Link from "next/link";

export default function Landing() {
  return (
    <main className="flex-1 flex flex-col relative">
      <header className="flex items-center justify-between px-6 py-5 border-b border-[color:var(--border)]">
        <div className="flex items-center gap-3">
          <span className="font-semibold tracking-tight text-lg">anyqr</span>
          <span className="pill">preprod</span>
        </div>
      </header>

      <section className="hero-grid flex-1 flex flex-col items-center justify-center px-6 py-20 relative">
        <div className="max-w-3xl w-full">
          <h1 className="display text-[48px] sm:text-[64px] leading-[1] tracking-[-0.035em] mb-6">
            Spend Cardano stablecoins
            <br />
            at any local QR.{" "}
            <span className="text-[color:var(--text-muted)]">
              10 countries.
            </span>
          </h1>

          <p className="text-[color:var(--text-muted)] text-lg max-w-xl mb-12">
            A single Aiken contract on Cardano escrows your tUSDM while a
            peer to peer merchant network pays the shop in local cash.
            Fully decentralised. Non custodial. Your keys, your funds.
          </p>

          {/* Role picker */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
            <RoleCard
              href="/start"
              badge="For anyone with a wallet"
              title="I want to pay"
              body="Scan any UPI, PIX or QRIS code and pay from your tUSDM. Merchants handle the local cash on your behalf."
              cta="Start paying"
              primary
            />
            <RoleCard
              href="/merchant"
              badge="For local liquidity providers"
              title="I want to earn"
              body="Accept incoming orders, pay the shop from your bank, and claim tUSDM plus a 2% spread on every trade."
              cta="Open merchant desk"
            />
          </div>

          <div className="grid grid-cols-3 gap-6 max-w-lg">
            <Stat label="Chain" value="Cardano" />
            <Stat label="Asset" value="tUSDM" />
            <Stat label="Rails" value="10" />
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--border-soft)] px-6 py-4 flex items-center justify-between text-xs text-[color:var(--text-muted)]">
        <span>
          Escrow{" "}
          <code className="font-mono text-[color:var(--text)]">
            escrow.escrow.spend
          </code>
        </span>
        <span>Preprod testnet</span>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="display text-2xl">{value}</div>
    </div>
  );
}

function RoleCard(props: {
  href: string;
  badge: string;
  title: string;
  body: string;
  cta: string;
  primary?: boolean;
}) {
  const { href, badge, title, body, cta, primary } = props;
  return (
    <Link
      href={href}
      style={{
        background: primary ? "var(--accent)" : "var(--surface)",
        borderColor: "var(--border)",
      }}
      className="group block p-6 rounded-lg border transition-all hover:shadow-[3px_3px_0_0_var(--border)] relative z-10"
    >
      <div
        className={`eyebrow mb-3 ${primary ? "opacity-70" : ""}`}
      >
        {badge}
      </div>
      <div className="display text-3xl mb-3">{title}</div>
      <p
        className={`text-sm mb-5 ${
          primary ? "text-[color:var(--accent-ink)]/80" : "text-[color:var(--text-muted)]"
        }`}
      >
        {body}
      </p>
      <span className="inline-flex items-center gap-1 text-sm font-medium">
        {cta}
        <span className="group-hover:translate-x-0.5 transition-transform">
          →
        </span>
      </span>
    </Link>
  );
}
