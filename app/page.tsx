import Link from "next/link";

const games = [
  {
    href: "/coinflip",
    title: "Coinflip",
    subtitle: "50/50 minus house edge",
    desc: "Heads or tails, provably fair. 2% edge, fully transparent seed-chain.",
    accent: "var(--accent)",
    icon: "🪙",
  },
  {
    href: "/crash",
    title: "Crash",
    subtitle: "Cash out before the line breaks",
    desc: "Exponential curve, crash point derived from SHA-256 before the round.",
    accent: "var(--warning)",
    icon: "📈",
  },
  {
    href: "/blackjack",
    title: "Blackjack",
    subtitle: "Dealer stands on 17",
    desc: "Standard 21 with full deck replay — every card draw is reproducible.",
    accent: "var(--accent2)",
    icon: "🂡",
  },
];

export default function Home() {
  return (
    <div className="space-y-12 animate-fade-in">
      {/* HERO */}
      <section className="relative overflow-hidden rounded-2xl panel p-8 sm:p-12">
        <div className="absolute inset-0 shimmer-bg opacity-30 pointer-events-none" />
        <div className="relative max-w-3xl">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <span className="chip chip-accent">Provably Fair</span>
            <span className="chip chip-warning">Devnet Only</span>
            <span className="chip chip-purple">SHA-256 Seed-Chain</span>
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-tight mb-3">
            <span className="gradient-text">RushSol</span> — Solana gaming,
            <br className="hidden sm:block" /> the way it should be.
          </h1>
          <p className="text-base sm:text-lg mb-6" style={{ color: "var(--muted)" }}>
            Three provably-fair games. Every roll, every card, every crash
            point can be verified independently by you, the player. No
            backend trust required — only SHA-256.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/crash" className="btn btn-primary px-6 py-3">
              Play Crash →
            </Link>
            <Link href="/verify" className="btn btn-ghost px-6 py-3">
              Verify a round
            </Link>
          </div>
        </div>
      </section>

      {/* STATS STRIP */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="House edge" value="1% – 5%" sub="configurable per game" />
        <Stat label="Rounds/sec" value="client-side" sub="math runs in your browser" />
        <Stat label="Verification" value="100%" sub="paste seeds, recompute" />
        <Stat label="Real money" value="none" sub="devnet only — for now" />
      </section>

      {/* GAMES */}
      <section id="games" className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-bold">Pick a game</h2>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            All games use the same SHA-256 seed-chain.
          </span>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          {games.map((g) => (
            <Link
              key={g.href}
              href={g.href}
              className="group panel p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-soft animate-slide-up"
            >
              <div className="flex items-center justify-between mb-4">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{
                    background: `color-mix(in srgb, ${g.accent} 15%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${g.accent} 30%, transparent)`,
                  }}
                >
                  {g.icon}
                </div>
                <span
                  className="text-xs font-mono opacity-0 group-hover:opacity-100 transition"
                  style={{ color: g.accent }}
                >
                  Play →
                </span>
              </div>
              <h3 className="font-display font-semibold text-lg mb-1">{g.title}</h3>
              <div className="text-xs uppercase tracking-wider mb-2" style={{ color: g.accent }}>
                {g.subtitle}
              </div>
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {g.desc}
              </p>
            </Link>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="panel p-6 sm:p-8 space-y-4">
        <h2 className="font-display text-xl font-bold">How provably fair works here</h2>
        <div className="grid sm:grid-cols-3 gap-6">
          <Step n="1" title="Server commits" body="We generate a server seed, publish SHA-256(server seed) — the commitment." />
          <Step n="2" title="You commit too" body="Your client seed is hashed before the round resolves. Neither side can adapt to the other." />
          <Step n="3" title="Outcome derives" body="HMAC-SHA-256(server seed, client seed || nonce) → game outcome. Anyone can recompute it." />
        </div>
        <Link href="/verify" className="btn btn-ghost px-4 py-2 text-sm inline-flex">
          Open the audit tool →
        </Link>
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel p-4">
      <div className="stat-label">{label}</div>
      <div className="font-display font-bold text-2xl mt-1" style={{ color: "var(--accent)" }}>
        {value}
      </div>
      <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
        {sub}
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="relative pl-12">
      <div
        className="absolute left-0 top-0 w-8 h-8 rounded-lg flex items-center justify-center font-display font-bold"
        style={{
          background: "color-mix(in srgb, var(--accent) 15%, transparent)",
          color: "var(--accent)",
          border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
        }}
      >
        {n}
      </div>
      <div className="font-semibold mb-1">{title}</div>
      <div className="text-sm" style={{ color: "var(--muted)" }}>
        {body}
      </div>
    </div>
  );
}