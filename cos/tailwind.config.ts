import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    extend: {
      colors: {
        cos: {
          "bg": "#121212",
          "surface": "#1E1E1E",
          "surface-light": "#2A2A2A",
          "border": "#333333",
          "text": "#E8E6E3",
          "text-secondary": "#A0A0A0",
          "text-muted": "#666666",
          "accent": "#EBA584",
          "accent-light": "#F5D4C3",
          "user-bubble": "#2D2520",
          "assistant-bubble": "#1E1E1E",
        },
      },
      fontFamily: {
        'sans': ['DM Sans', 'system-ui', 'sans-serif'],
        'serif': ['Bona Nova', 'Georgia', 'serif'],
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-dot": {
          "0%, 80%, 100%": { opacity: "0.3" },
          "40%": { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.3s ease-out forwards",
        "pulse-dot": "pulse-dot 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
