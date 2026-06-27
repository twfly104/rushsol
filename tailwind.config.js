/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Dark mode (default)
        rush: {
          bg: "#08080d",
          surface: "#12121a",
          surface2: "#1a1a26",
          border: "#262635",
          accent: "#14f195",
          accent2: "#9945ff",
          danger: "#ff4d6d",
          warning: "#ffb84d",
          muted: "#8b8ba0",
          text: "#f4f4f8",
        },
        // Light mode tokens
        day: {
          bg: "#f6f7fb",
          surface: "#ffffff",
          surface2: "#f0f1f7",
          border: "#e3e5ee",
          accent: "#10b981",
          accent2: "#7c3aed",
          danger: "#e11d48",
          warning: "#f59e0b",
          muted: "#6b7280",
          text: "#0f1116",
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 40px -8px rgba(20, 241, 149, 0.45)",
        "glow-purple": "0 0 40px -8px rgba(153, 69, 255, 0.45)",
        "glow-danger": "0 0 40px -8px rgba(255, 77, 109, 0.45)",
        soft: "0 8px 24px -8px rgba(0,0,0,0.25)",
        "soft-day": "0 8px 24px -12px rgba(15,17,22,0.12)",
      },
      animation: {
        "coin-spin": "coin-spin 1.5s ease-in-out",
        "pulse-glow": "pulseGlow 2.4s ease-in-out infinite",
        "float": "float 6s ease-in-out infinite",
        "shimmer": "shimmer 2.5s linear infinite",
        "fade-in": "fadeIn 0.4s ease-out",
        "slide-up": "slideUp 0.45s cubic-bezier(0.16, 1, 0.3, 1)",
        "pop": "pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        "coin-spin": {
          "0%": { transform: "rotateY(0)" },
          "100%": { transform: "rotateY(1800deg)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(20,241,149,0.4)" },
          "50%": { boxShadow: "0 0 0 12px rgba(20,241,149,0)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        fadeIn: {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        slideUp: {
          "0%": { opacity: 0, transform: "translateY(12px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        pop: {
          "0%": { transform: "scale(0.85)", opacity: 0 },
          "60%": { transform: "scale(1.05)" },
          "100%": { transform: "scale(1)", opacity: 1 },
        },
      },
    },
  },
  plugins: [],
};
