/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";
const cspConnectSrc = [
  "'self'",
  // Wallet adapters talk RPC to the configured Solana endpoint.
  "https://api.mainnet-beta.solana.com",
  "https://api.devnet.solana.com",
  "https://*.helius-rpc.com",
  "https://*.solana.com",
  // The internal game service (Fly.io) for bet/withdraw requests.
  process.env.GAME_SERVICE_URL ?? "",
  // WSS for crash round socket.
  "wss:",
  "https:",
].filter(Boolean);

const securityHeaders = [
  // HSTS once you've confirmed all subdomains are HTTPS-ready.
  {
    key: "Strict-Transport-Security",
    value: isProd
      ? "max-age=63072000; includeSubDomains; preload"
      : "max-age=0",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `connect-src ${cspConnectSrc.join(" ")}`,
      // 'unsafe-inline' for styles is required by Next.js's hydration script
      // and Tailwind's runtime. If you remove it, expect hydration warnings.
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Sensible image defaults; add your CDN host here when you ship one.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.solana.com" },
      { protocol: "https", hostname: "cdn.rushsol.com" },
    ],
  },
  // The `ox` package (pulled in via viem) uses a dynamic require for the
  // "tempo" chain. Webpack can't statically analyze it — silence the
  // critical-dep warning since this code path is never hit in the devnet
  // build. Revisit if/when WalletConnect is added back.
  webpack: (config) => {
    config.module = config.module ?? {};
    config.module.exprContextCritical = false;
    return config;
  },
};

export default nextConfig;
