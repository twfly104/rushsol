import "./globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import { themeScript } from "@/components/ThemeScript";

export const metadata = {
  title: "RushSol — Provably Fair Solana Gaming",
  description: "Coinflip, Crash, and Blackjack on Solana. Provably fair via SHA-256 seed-chain.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Providers>
          <Nav />
          <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>
          <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-10 text-center text-xs" style={{ color: "var(--muted)" }}>
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="chip chip-warning">Devnet only</span>
              <span>·</span>
              <span>No real SOL accepted</span>
              <span>·</span>
              <span>Provably fair via SHA-256</span>
            </div>
            <div>RushSol · A scaffolded UI, not a production gambling service</div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
