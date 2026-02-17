# Deployment Configuration

## Cloudflare Pages Setup

This repository is deployed via Cloudflare Pages with the following configuration:

- **Build command**: `npm run build`
- **Build output directory**: `/` (serves both static HTML and built quiz)
- **Node version**: 18 (set via environment variable `NODE_VERSION`)

## Structure

- `/` - Static HTML website files (index.html, about.html, etc.)
- `/quiz/` - React quiz application source code
- `/dist/quiz/` - Built quiz files (generated during deployment)

## Deployment Process

1. Push changes to GitHub (`main` branch)
2. Cloudflare Pages automatically detects the push
3. Runs `npm install` to install dependencies
4. Runs `npm run build` to build the quiz to `/dist/quiz/`
5. Deploys both static HTML files and built quiz files
6. Quiz accessible at: https://www.amarimethod.com/quiz

## Build Output

- Static files served from root: `index.html`, `about.html`, etc.
- Quiz served from: `/dist/quiz/index.html`
- The `_redirects` file handles SPA routing for the quiz
