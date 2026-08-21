import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Astro respects base for routing + asset URLs.
// outDir defaults to ./dist; with base '/quiz/' Astro outputs HTML to dist/quiz/.
export default defineConfig({
  site: 'https://www.amarimethod.com',
  base: '/quiz/',
  trailingSlash: 'ignore',
  output: 'static',
  integrations: [
    react(),
    tailwind({
      // Use our own config; don't auto-inject base styles (Tailwind directives
      // live in styles/quiz.css which gets imported on every page).
      applyBaseStyles: false,
      configFile: './tailwind.config.cjs',
    }),
  ],
  vite: {
    // This is intentionally a public build-time value. Define it explicitly
    // so the React island receives the Pages build variable in its client
    // bundle rather than relying on an undeclared ambient env type.
    define: {
      'import.meta.env.PUBLIC_TURNSTILE_SITE_KEY': JSON.stringify(process.env.PUBLIC_TURNSTILE_SITE_KEY || ''),
    },
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  },
});
