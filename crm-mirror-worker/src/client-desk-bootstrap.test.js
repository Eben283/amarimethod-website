import { describe, expect, it, vi } from 'vitest';
import worker from './index.js';
import { dashboardSessionToken } from './dashboard-session.js';

function fixture() {
  const links = new Map();
  const read = vi.fn();
  const env = {
    WORKER_AUTH_SECRET: 'local-bootstrap-test-secret',
    PORTAL_KV: {
      put: async (key, value) => links.set(key, value),
      get: async (key) => links.get(key) || null,
      delete: async (key) => links.delete(key),
    },
    CRM_DB: { prepare(sql) {
      expect(sql.trim()).toMatch(/^(SELECT|WITH)\b/);
      read(sql);
      return { bind() { return this; }, async first() { return null; }, async all() { return { results: [] }; } };
    } },
  };
  async function handoff(query) {
    const minted = await worker.fetch(new Request('https://crm.test/dashboard-access-link?view=client-desk', {
      method: 'POST', headers: { Authorization: `Bearer ${env.WORKER_AUTH_SECRET}`, 'X-Staff-Actor': 'Eben' },
    }), env);
    const { url } = await minted.json();
    const result = await worker.fetch(new Request(`${url}?${query}`), env);
    expect(result.status).toBe(302);
    return new URL(result.headers.get('Location'), 'https://crm.test');
  }
  return { env, handoff, read };
}

describe('Client Desk cookie-free Staff bootstrap', () => {
  it.each(['https://amarimethod.com', 'https://www.amarimethod.com'])('runs the actual handoff and shell with cookies blocked for %s', async (parentOrigin) => {
    const { env, handoff, read } = fixture();
    const destination = await handoff(new URLSearchParams({ embed: '1', parent_origin: parentOrigin, contact: 'owned_123-ab', intent: 'note', arbitrary: 'drop' }));
    expect(destination.searchParams.get('contact')).toBe('owned_123-ab');
    expect(destination.searchParams.get('intent')).toBe('note');
    expect(destination.searchParams.has('arbitrary')).toBe(false);
    const session = new URLSearchParams(destination.hash.slice(1)).get('dashboard_session');
    expect(session).toBeTruthy();
    expect(destination.search).not.toContain(session);
    // Browser navigation omits the fragment AND declines the Set-Cookie.
    const shell = await worker.fetch(new Request(destination.origin + destination.pathname + destination.search), env);
    expect(shell.status).toBe(200);
    expect(shell.headers.get('Content-Type')).toContain('text/html');
    expect(shell.headers.get('Cache-Control')).toBe('no-store');
    expect(read).not.toHaveBeenCalled();
    const html = await shell.text();
    expect(html).not.toContain(env.WORKER_AUTH_SECRET);
    expect(html).not.toContain(session);
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];
    const element = { value: '', textContent: '', innerHTML: '', addEventListener() {}, replaceChildren() {} };
    const document = { getElementById: () => element };
    const history = { replaceState: vi.fn() };
    const window = { location: destination, parent: { postMessage: vi.fn() }, addEventListener() {} };
    const requests = [];
    const fetch = async (resource, options) => {
      const request = new Request(new URL(resource, destination), options);
      expect(request.headers.get('Cookie')).toBeNull();
      expect(request.headers.get('X-Amari-Dashboard-Session')).toBe(session);
      expect(request.method).toBe('GET');
      const response = await worker.fetch(request, env);
      requests.push({ request, status: response.status });
      return response;
    };
    // Return the existing initial load promise so the full bootstrap can be awaited.
    const executable = script.replace('  loadInbox();\n})();', '  return loadInbox();\n})();');
    await new Function('document', 'window', 'history', 'fetch', `return (${executable.trim().slice(0, -1)})`)(document, window, history, fetch);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', destination.pathname + destination.search);
    expect(requests).toHaveLength(1);
    expect(requests[0].request.url).toContain('/communications/inbox?');
    expect(requests[0].status).toBe(200);
    expect(read).toHaveBeenCalled();
    expect(window.parent.postMessage).not.toHaveBeenCalled();
    // Reload after Desk removed the fragment: no cookie/token survives. The shell
    // still runs, rejects the protected read, and asks Staff for a fresh handoff.
    const reloadLocation = new URL(destination);
    reloadLocation.hash = '';
    const reloaded = await worker.fetch(new Request(reloadLocation), env);
    expect(reloaded.status).toBe(200);
    window.location = reloadLocation;
    const unauthenticatedFetch = async (resource, options) => {
      const request = new Request(new URL(resource, reloadLocation), options);
      expect(request.headers.get('X-Amari-Dashboard-Session')).toBeNull();
      const response = await worker.fetch(request, env);
      expect(response.status).toBe(401);
      return response;
    };
    read.mockClear();
    await new Function('document', 'window', 'history', 'fetch', `return (${executable.trim().slice(0, -1)})`)(document, window, history, unauthenticatedFetch);
    expect(window.parent.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'amari:staff-desk-session-expired' }, parentOrigin);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['', 'embed=1', 'parent_origin=https://amarimethod.com', 'embed=1&parent_origin=https://example.com'])('keeps direct and untrusted shell requests authenticated: %s', async (query) => {
    const { env, read } = fixture();
    const response = await worker.fetch(new Request(`https://crm.test/client-desk?${query}`), env);
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });

  it.each(['', 'sms', 'NOTE', 'note&send=true'])('does not forward unsupported intent %s', async (intent) => {
    const { handoff } = fixture();
    const destination = await handoff(new URLSearchParams({ contact: 'owned_123', intent }));
    expect(destination.search).toBe('?contact=owned_123');
  });

  it.each(['', 'person/123', 'a&other=b', 'a'.repeat(81)])('drops invalid contact and its note intent: %s', async (contact) => {
    const { handoff } = fixture();
    const destination = await handoff(new URLSearchParams({ contact, intent: 'note' }));
    expect(destination.search).toBe('');
  });

  it.each(['missing', 'forged', 'expired'])('never authorizes APIs or commands with embed metadata and a %s session', async (kind) => {
    const { env, read } = fixture();
    const token = kind === 'missing' ? null : kind === 'forged' ? '9999999999.RWJlbg.invalid' : await dashboardSessionToken(env, 'Eben', 1);
    for (const [method, path] of [['GET', '/communications/inbox'], ['GET', '/client-desk/contacts/owned_123'], ['POST', '/client-desk/contacts/owned_123/seen'], ['POST', '/notes/commands']]) {
      const response = await worker.fetch(new Request(`https://crm.test${path}?embed=1&parent_origin=https://amarimethod.com`, {
        method, headers: { ...(token ? { 'X-Amari-Dashboard-Session': token } : {}), Origin: 'https://crm.test', 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      }), env);
      expect(response.status).toBe(401);
    }
    expect(read).not.toHaveBeenCalled();
  });
});
