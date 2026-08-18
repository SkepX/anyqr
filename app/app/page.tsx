import Link from "next/link";

/** Entrance stagger — every delay lands on the 4px-grid rhythm of 80ms. */
const stagger = (step: number) => ({ animationDelay: `${step * 80}ms` });

export default function Landing() {
  return (
    <main className="flex-1 flex flex-col relative">
      {/* Routing bar — the headline claim, on top of everything. */}
      <div className="w-full bg-[color:var(--text)] text-[color:var(--bg)] px-6 py-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs sm:text-[13px] leading-snug text-center">
        <span className="inline-flex items-center gap-1.5 font-medium shrink-0">
          <span
            className="dot-live"
            style={{ background: "var(--accent)" }}
            aria-hidden
          />
          Coming soon
        </span>
        <span className="opacity-90">
          Orders route to both the Cardano-native order book and global liquidity
          via <span className="font-medium">p2p.foundation</span> — whichever
          settles first.
        </span>
        <span className="font-mono opacity-70 whitespace-nowrap">
          $10M+ settled · 1,350+ merchants
        </span>
      </div>

      <header className="flex items-center justify-between gap-4 px-6 py-5 border-b border-[color:var(--border)]">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold tracking-tight text-lg">anyqr</span>
          <span className="text-xs text-[color:var(--text-muted)] whitespace-nowrap">
            By SyncAI.network
          </span>
        </div>
        <span className="pill">
          <span className="dot-live" aria-hidden />
          Live on preprod
        </span>
      </header>

      <section className="hero-grid flex-1 flex flex-col items-center justify-center px-6 py-16 sm:py-24">
        <div className="max-w-3xl w-full">
          <div className="eyebrow mb-4 fade-up" style={stagger(0)}>
            Cardano · UPI · PIX · QRIS
          </div>

          <h1
            className="display text-[44px] sm:text-[64px] leading-[1.02] tracking-[-0.035em] mb-6 fade-up"
            style={stagger(1)}
          >
            Spend Cardano stablecoins
            <br />
            at any local QR.{" "}
            <span className="text-[color:var(--text-muted)]">10 countries.</span>
          </h1>

          <p
            className="text-[color:var(--text-muted)] text-lg leading-relaxed max-w-xl mb-12 fade-up"
            style={stagger(2)}
          >
            A single Aiken contract escrows your tUSDM while a peer-to-peer
            merchant network pays the shop in local cash. Non-custodial, on-chain,
            settled in about a minute.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="fade-up" style={stagger(3)}>
              <RoleCard
                href="/start"
                badge="For anyone with a wallet"
                title="I want to pay"
                body="Scan any UPI, PIX or QRIS code and pay from your tUSDM. A merchant sends the local cash on your behalf."
                cta="Start paying"
                primary
              />
            </div>
            <div className="fade-up" style={stagger(4)}>
              <RoleCard
                href="/merchant"
                badge="For local liquidity providers"
                title="I want to earn"
                body="Accept incoming orders, pay the shop from your bank, and claim tUSDM plus a 2% spread on every trade."
                cta="Open merchant desk"
              />
            </div>
          </div>

          <div
            className="strip grid-cols-1 sm:grid-cols-3 mb-8 fade-up"
            style={stagger(5)}
          >
            <Stat label="Settlement" value="~60 sec" />
            <Stat label="Merchant spread" value="2%" />
            <Stat label="Custody" value="Yours" />
          </div>

          <div
            className="card-flat flex flex-col sm:flex-row sm:items-center gap-4 justify-between fade-up"
            style={stagger(6)}
          >
            <div className="flex items-start gap-3">
              <span className="pill shrink-0">
                <span className="dot-live dot-soon" aria-hidden />
                Coming soon
              </span>
              <div>
                <div className="font-medium">Dual-routed liquidity</div>
                <p className="text-sm text-[color:var(--text-muted)] mt-1 max-w-md">
                  Every order goes to the Cardano-native order book and the
                  p2p.foundation network at once — whichever fills first settles
                  the payment, so you get local speed with global depth behind
                  it.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-[color:var(--text-faint)] whitespace-nowrap">
              $10M+ settled · 1,350+ merchants
            </span>
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--border-soft)] px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--text-muted)]">
        <span>
          Escrow{" "}
          <code className="font-mono text-[color:var(--text)]">
            escrow.escrow.spend
          </code>
        </span>
        <span>Preprod testnet · By SyncAI.network</span>
      </footer>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4">
      <div className="eyebrow mb-1">{label}</div>
      <div className="display text-2xl leading-tight">{value}</div>
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
      className="group flex h-full flex-col p-6 rounded-lg border relative z-10
                 transition-[box-shadow,transform] duration-150 ease-out
                 hover:shadow-[4px_4px_0_0_var(--border)] hover:-translate-y-0.5
                 focus-visible:shadow-[4px_4px_0_0_var(--border)]"
    >
      <div className={`eyebrow mb-3 ${primary ? "opacity-70" : ""}`}>{badge}</div>
      <div className="display text-3xl mb-3 leading-tight">{title}</div>
      <p
        className={`text-sm leading-relaxed mb-6 ${
          primary
            ? "text-[color:var(--accent-ink)]/80"
            : "text-[color:var(--text-muted)]"
        }`}
      >
        {body}
      </p>
      <span className="mt-auto inline-flex items-center gap-1.5 text-sm font-medium">
        {cta}
        <span className="transition-transform duration-150 ease-out group-hover:translate-x-1">
          →
        </span>
      </span>
    </Link>
  );
}
