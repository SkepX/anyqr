import Link from "next/link";

/** Entrance stagger — 80ms steps, matching the 4px rhythm of the layout. */
const stagger = (step: number) => ({ animationDelay: `${step * 80}ms` });

export default function Landing() {
  return (
    <main className="flex-1 flex flex-col lg:h-[100dvh] lg:overflow-hidden">
      <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-[color:var(--border)] shrink-0">
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

      <section className="hero-grid flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-8 lg:py-10">
        <div className="max-w-3xl w-full">
          {/* Routing notice — sits directly above the headline. */}
          <div
            className="callout mb-6 flex items-start gap-3 fade-up"
            style={stagger(0)}
          >
            <span
              className="dot-live mt-[7px] shrink-0"
              style={{ background: "var(--text)" }}
              aria-hidden
            />
            <p className="text-sm leading-relaxed">
              Orders fill on the{" "}
              <span className="font-semibold">Cardano-native book</span> today.
              Global liquidity via{" "}
              <span className="font-semibold">p2p.foundation</span>{" "}
              <span className="opacity-70">($10M+ settled, 1,350+ merchants)</span>{" "}
              integration is coming soon.
            </p>
          </div>

          <h1
            className="display text-[40px] sm:text-[54px] lg:text-[58px] leading-[1.03] tracking-[-0.035em] mb-5 fade-up"
            style={stagger(1)}
          >
            Spend Cardano stablecoins
            <br />
            at any local QR.{" "}
            <span className="text-[color:var(--text-muted)]">10 countries.</span>
          </h1>

          <p
            className="text-[color:var(--text-muted)] text-base sm:text-lg leading-relaxed max-w-xl mb-8 fade-up"
            style={stagger(2)}
          >
            A single Aiken contract escrows your tUSDM while a peer-to-peer
            merchant network pays the shop in local cash. Non-custodial,
            on-chain, settled in about a minute.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
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
                body="Accept orders, pay the shop from your bank, and claim tUSDM plus a 2% spread on every trade."
                cta="Open merchant desk"
              />
            </div>
          </div>

          <div
            className="strip grid-cols-1 sm:grid-cols-3 fade-up"
            style={stagger(5)}
          >
            <Stat label="Settlement" value="~60 sec" />
            <Stat label="Merchant spread" value="2%" />
            <Stat label="Custody" value="Yours" />
          </div>
        </div>
      </section>

      <footer className="border-t border-[color:var(--border-soft)] px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--text-muted)] shrink-0">
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
    <div className="px-5 py-3">
      <div className="eyebrow mb-0.5">{label}</div>
      <div className="display text-xl leading-tight">{value}</div>
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
      className="group flex h-full flex-col p-5 rounded-lg border relative z-10
                 transition-[box-shadow,transform] duration-150 ease-out
                 hover:shadow-[4px_4px_0_0_var(--border)] hover:-translate-y-0.5
                 focus-visible:shadow-[4px_4px_0_0_var(--border)]"
    >
      <div className={`eyebrow mb-2 ${primary ? "opacity-70" : ""}`}>{badge}</div>
      <div className="display text-2xl sm:text-[28px] mb-2 leading-tight">
        {title}
      </div>
      <p
        className={`text-sm leading-relaxed mb-4 ${
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
