"use client";

import { ReactNode, useMemo } from "react";
import * as WalletAdapterReact from "@solana/wallet-adapter-react";
import * as WalletAdapterReactUI from "@solana/wallet-adapter-react-ui";
// Import the two adapters we actually use directly. Using the
// `@solana/wallet-adapter-wallets` barrel pulls in @solana/wallet-adapter-walletconnect,
// which transitively pulls @walletconnect/solana-adapter → @reown/appkit + viem/ox,
// neither of which we want for the devnet build. Phantom + Solflare cover devnet QA.
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { clusterApiUrl } from "@solana/web3.js";
import { MockBalanceProvider } from "./MockBalanceProvider";
import { ThemeProvider } from "./ThemeProvider";

require("@solana/wallet-adapter-react-ui/styles.css");

const ConnectionProvider = WalletAdapterReact.ConnectionProvider as unknown as React.ComponentType<{
  endpoint: string;
  children: ReactNode;
}>;
const WalletProvider = WalletAdapterReact.WalletProvider as unknown as React.ComponentType<{
  wallets: unknown[];
  autoConnect?: boolean;
  children: ReactNode;
}>;
const WalletModalProvider = WalletAdapterReactUI.WalletModalProvider as unknown as React.ComponentType<{
  children: ReactNode;
}>;

/**
 * Root provider stack. Order matters:
 *   ConnectionProvider → WalletProvider → WalletModalProvider
 *     → ThemeProvider → MockBalanceProvider → children
 *
 * The mock balance provider lives at the top of the React tree but does
 * not interact with the wallet adapter — it stands in for a server ledger
 * during devnet-only development. See MockBalanceProvider.tsx for the
 * scope disclaimer.
 */
export function Providers({ children }: { children: ReactNode }) {
  // RPC endpoint: prefer NEXT_PUBLIC_RPC_URL (the production paid RPC).
  // Fall back to the cluster default for the configured network so the
  // devnet demo still works without a custom env.
  const network = (process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet") as
    | "mainnet-beta"
    | "devnet";
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl(network),
    [network],
  );
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ThemeProvider>
            <MockBalanceProvider>{children}</MockBalanceProvider>
          </ThemeProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
