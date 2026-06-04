import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Remapped 2026-06-04 to the client-detail "Chart" palette (session-a.css)
        // so every staff page matches that calm, cool/teal look. Token NAMES are
        // kept (used across all pages); only the values changed warm→cool, coral→teal.
        amari: {
          "bone-white": "#FAFBFC",        // --paper (app background)
          "light-sand": "#EFF5F7",        // --tint (hovers, soft fills)
          "charcoal": "#16242B",          // --ink (text + headings)
          "text-secondary": "#33454E",    // --ink2
          "text-muted": "#5E7079",        // --muted
          "border": "#E7EDF0",            // --line
          "accent-warm": "#1E7C8C",       // --accent (teal) — name kept; value now teal
          "accent-warm-light": "#E4F0F2", // --accent-tint
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        'serif': ['Bona Nova', 'Georgia', 'serif'],
        'sans': ['DM Sans', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 2px 8px rgba(0, 0, 0, 0.04)',
        'card-hover': '0 8px 24px rgba(37, 37, 37, 0.1)',
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out forwards",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
