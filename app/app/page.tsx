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
          <div className="callout mb-7 fade-up" style={stagger(0)}>
            <p className="text-sm leading-relaxed text-[color:var(--text-muted)]">
              <span className="text-[color:var(--text)]">
                Orders fill on the Cardano-native book today.
              </span>{" "}
              Global liquidity via{" "}
              <span className="text-[color:var(--text)] font-medium">
                p2p.foundation
              </span>{" "}
              ($10M+ settled, 1,350+ merchants) coming soon.
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
            An Aiken contract escrows your tUSDM while local merchants pay the
            shop in cash. Non-custodial, on-chain, about a minute end to end.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="fade-up" style={stagger(3)}>
              <RoleCard
                href="/start"
                badge="For anyone with a wallet"
                title="I want to pay"
                body="Scan any UPI, PIX or QRIS code and pay from your tUSDM."
                cta="Start paying"
                primary
              />
            </div>
            <div className="fade-up" style={stagger(4)}>
              <RoleCard
                href="/merchant"
                badge="For local liquidity providers"
                title="I want to earn"
                body="Pay the shop from your bank, claim tUSDM plus a 2% spread."
                cta="Open merchant desk"
              />
            </div>
          </div>

          <div
            className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-[color:var(--text-muted)] fade-up"
            style={stagger(5)}
          >
            <span>
              <span className="text-[color:var(--text)] font-medium">~60 sec</span>{" "}
              settlement
            </span>
            <span aria-hidden className="text-[color:var(--text-faint)]">·</span>
            <span>
              <span className="text-[color:var(--text)] font-medium">2%</span>{" "}
              merchant spread
            </span>
            <span aria-hidden className="text-[color:var(--text-faint)]">·</span>
            <span>
              <span className="text-[color:var(--text)] font-medium">
                Non-custodial
              </span>{" "}
              throughout
            </span>
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
