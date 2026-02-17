# Deployment Configuration

## Cloudflare Pages Setup

This repository is deployed via Cloudflare Pages with the following configuration:

- **Build command**: `npm run build`
- **Build output directory**: `/dist` (CRITICAL: Must be `/dist`, not `/` - this ensures only built files are deployed)
- **Node version**: 18 (set via environment variable `NODE_VERSION`)

## Structure

- `/` - Static HTML website files (index.html, about.html, etc.)
- `/quiz/` - React quiz application source code
- `/dist/quiz/` - Built quiz files (generated during deployment)

## Deployment Process

1. Push changes to GitHub (`main` branch)
2. Cloudflare Pages automatically detects the push
3. Runs `npm install` to install dependencies
4. Runs `npm run build` which:
   - Copies static HTML files to `/dist/`
   - Builds React quiz to `/dist/quiz/`
5. Deploys ONLY the `/dist/` directory (configured via "Build output directory: /dist")
6. Quiz accessible at: https://www.amarimethod.com/quiz

**CRITICAL:** Cloudflare Pages "Build output directory" MUST be set to `/dist` (not `/`). This ensures only built files are deployed, not source files.

## Build Output

- Static files served from root: `index.html`, `about.html`, etc.
- Quiz served from: `/dist/quiz/index.html`
- The `_redirects` file handles SPA routing for the quiz
