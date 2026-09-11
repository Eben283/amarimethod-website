import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
const require = createRequire(path.resolve('package.json'));
const temp = await mkdtemp(path.join(tmpdir(), 'staff-money-ui-'));
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://www.amarimethod.com/staff/' });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
await build({
  stdin: { contents: "export {default as BalancesPage} from './staff/src/pages/BalancesPage.tsx'; export {MemoryRouter} from 'react-router-dom';", resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: path.join(temp, 'page.cjs'), loader: { '.css': 'empty' },
  plugins: [{ name: 'test-context', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args) => ({ path: require.resolve(args.path), external: true }));
    builder.onResolve({ filter: /contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "const logout=()=>{}; export function useAuth(){return {user:'Eben',logout};}", loader: 'js' }));
  } }],
});
const { BalancesPage, MemoryRouter } = require(path.join(temp, 'page.cjs'));
let root, calls, unexpected, owedReply;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
globalThis.fetch = async (input) => {
  const url = new URL(input, 'https://www.amarimethod.com');
  calls.push(url.pathname);
  if (url.pathname === '/api/staff-balances') return response({ rows: [], totalRemaining: 0, ledgerSource: 'session-ledger', generatedAt: new Date().toISOString() });
  if (url.pathname === '/api/staff-owed-list') return response({ roster: [{ contactId: 'fixture', name: 'Synthetic Fixture' }] });
  if (url.pathname === '/api/staff-owed') return owedReply();
  unexpected.push(url.href);
  throw new Error('Unexpected network call denied');
};
const flush = () => act(async () => { await new Promise(resolve => setImmediate(resolve)); });
const text = () => document.body.textContent;
async function mount() {
  await act(async () => { root = createRoot(document.getElementById('root')); root.render(React.createElement(MemoryRouter, null, React.createElement(BalancesPage))); });
  await flush();
}
async function refresh() {
  const button = document.querySelector('button[aria-label="Refresh"]');
  assert.ok(button); assert.equal(button.disabled, false);
  await act(async () => button.click()); await flush();
}
async function check(name, fn) {
  calls = []; unexpected = [];
  try { await fn(); assert.deepEqual(unexpected, []); console.log('PASS ' + name); }
  finally { if (root) { await act(async () => root.unmount()); root = null; } }
}
try {
  for (const mode of ['unavailable-status', 'http-error']) {
    await check('unknown payments never claim all paid: ' + mode, async () => {
      owedReply = () => mode === 'http-error' ? response({ error: 'Synthetic failure' }, 500) : response({ status: 'unavailable' });
      await mount();
      assert.match(text(), /Payment status could not be verified/);
      assert.doesNotMatch(text(), /All 1 recent practice members are paid up/);
    });
  }
  await check('Refresh retries payment evidence after provider recovery', async () => {
    owedReply = () => response({ status: 'unavailable' });
    await mount();
    const before = calls.filter(value => value === '/api/staff-owed').length;
    owedReply = () => response({ status: 'owed', shortBy: 1, confidence: 'high' });
    await refresh();
    assert.equal(calls.filter(value => value === '/api/staff-owed').length, before + 1);
    assert.match(text(), /1 unpaid/);
    assert.doesNotMatch(text(), /Payment status could not be verified/);
  });
  await check('older paid response cannot overwrite a newer unpaid check', async () => {
    let resolveOld;
    owedReply = () => new Promise(resolve => { resolveOld = resolve; });
    await mount();
    assert.equal(typeof resolveOld, 'function');
    owedReply = () => response({ status: 'owed', shortBy: 1, confidence: 'high' });
    await refresh();
    await act(async () => resolveOld(response({ status: 'square' })));
    await flush();
    assert.match(text(), /1 unpaid/);
    assert.doesNotMatch(text(), /All 1 recent practice members are paid up/);
  });
  await check('complete square result still renders paid', async () => {
    owedReply = () => response({ status: 'square' });
    await mount();
    assert.match(text(), /All 1 recent practice members are paid up/);
    assert.doesNotMatch(text(), /Payment status could not be verified/);
  });
} finally {
  dom.window.close();
  await rm(temp, { recursive: true, force: true });
}
