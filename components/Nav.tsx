"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useMockBalance } from "./MockBalanceProvider";
import { useTheme } from "./ThemeProvider";

const links = [
  { href: "/", label: "Home" },
  { href: "/coinflip", label: "Coinflip" },
  { href: "/crash", label: "Crash" },
  { href: "/blackjack", label: "Blackjack" },
  { href: "/verify", label: "Verify" },
];

export function Nav() {
  const pathname = usePathname();
  const { balance, reset } = useMockBalance();
  const { theme, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <header
      className="sticky top-0 z-20 border-b glass"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Logo />
          <span className="font-display font-bold text-lg gradient-text hidden sm:inline">RushSol</span>
        </Link>
        <span className="chip chip-warning hidden sm:inline-flex">Devnet</span>

        <nav className="flex gap-1 sm:gap-2 flex-1 overflow-x-auto">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className="px-3 py-1.5 rounded-md text-sm font-medium transition whitespace-nowrap"
                style={{
                  background: active ? "color-mix(in srgb, var(--accent) 15%, transparent)" : "transparent",
                  color: active ? "var(--accent)" : "var(--muted)",
                }}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-lg panel-2"
            title="Mock balance — resets on refresh"
          >
            <span className="text-xs uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Mock
            </span>
            <span className="font-mono font-semibold" style={{ color: "var(--accent)" }}>
              {balance.toFixed(2)} SOL
            </span>
            <button
              onClick={reset}
              className="ml-1 text-xs hover:scale-110 transition"
              style={{ color: "var(--muted)" }}
              title="Reset mock balance"
            >
              ↻
            </button>
          </div>
          <button
            onClick={toggle}
            className="btn btn-ghost w-9 h-9 p-0"
            aria-label="Toggle theme"
            title={mounted ? (theme === "dark" ? "Switch to light" : "Switch to dark") : "Toggle theme"}
          >
            {mounted && (theme === "dark" ? <SunIcon /> : <MoonIcon />)}
          </button>
          <WalletMultiButton className="!bg-[var(--accent)] !text-[#08080d] !font-semibold !rounded-lg !h-9 !text-sm" />
        </div>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rush-logo" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent2)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#rush-logo)" />
      <path d="M9 22 L16 8 L23 22 L19 22 L16 16 L13 22 Z" fill="#08080d" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
