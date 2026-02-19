// Cloudflare Pages Function: catch-all for /portal/* routes
// Serves portal/index.html for all sub-routes (SPA fallback)
// This is needed because _redirects 200 rewrites don't work reliably on Cloudflare Pages

export async function onRequest(context) {
  const url = new URL(context.request.url);

  // If this is an API request, let it pass through
  if (url.pathname.startsWith('/api/')) {
    return context.next();
  }

  // If requesting a static asset (has file extension), let it pass through
  if (url.pathname.match(/\.\w+$/)) {
    return context.next();
  }

  // For all other /portal/* routes, serve portal/index.html
  try {
    const assetUrl = new URL('/portal/index.html', url.origin);
    const response = await context.env.ASSETS.fetch(assetUrl);
    return new Response(response.body, {
      status: 200,
      headers: {
        ...Object.fromEntries(response.headers.entries()),
        'Content-Type': 'text/html; charset=utf-8',
      },
    });
  } catch (err) {
    // Fallback: try next handler
    return context.next();
  }
}
