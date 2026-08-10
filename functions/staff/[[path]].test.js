import { describe, expect, it, vi } from 'vitest';
import { onRequest } from './[[path]].js';

function contextFor(pathname, assetResponse = new Response('<div id="root"></div>', {
  status: 200,
  headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' },
})) {
  const fetch = vi.fn(async () => assetResponse);
  const next = vi.fn(async () => new Response('next'));
  return {
    context: {
      request: new Request(`https://www.amarimethod.com${pathname}`),
      env: { ASSETS: { fetch } },
      next,
    },
    fetch,
    next,
  };
}

describe('Staff SPA routing', () => {
  it('serves the Staff application shell for an authenticated nested route', async () => {
    const { context, fetch, next } = contextFor('/staff/training');

    const response = await onRequest(context);

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toContain('<div id="root"></div>');
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL(fetch.mock.calls[0][0]).pathname).toBe('/staff/index.html');
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['/staff/assets/index.js', '/staff/icon.svg', '/staff/report.pdf'])(
    'leaves the static file request %s to Pages',
    async (pathname) => {
      const { context, fetch, next } = contextFor(pathname);

      expect(await (await onRequest(context)).text()).toBe('next');
      expect(next).toHaveBeenCalledOnce();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('fails through to the site response when the Staff shell is unavailable', async () => {
    const { context, next } = contextFor('/staff/training', new Response('missing', { status: 404 }));

    expect(await (await onRequest(context)).text()).toBe('next');
    expect(next).toHaveBeenCalledOnce();
  });
});
