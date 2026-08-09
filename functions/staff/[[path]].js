// Cloudflare Pages Function: authenticated Staff SPA fallback.
// Root middleware owns authentication; this route only translates browser
// deep links such as /staff/training into the built Staff application shell.

function isStaticFile(pathname) {
  return /\/[^/]+\.[^/]+$/.test(pathname);
}

export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (isStaticFile(url.pathname)) return context.next();

  try {
    const assetUrl = new URL('/staff/index.html', url.origin);
    const response = await context.env.ASSETS.fetch(assetUrl);
    if (!response.ok) return context.next();

    const headers = new Headers(response.headers);
    headers.set('Content-Type', 'text/html; charset=utf-8');
    return new Response(response.body, { status: 200, headers });
  } catch {
    return context.next();
  }
}
