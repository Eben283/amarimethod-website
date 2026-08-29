// Deterministic validation of existing Access readbacks. No credential/network
// capability. The attachment transport owns exact URLs, TLS, HTTP status, bounded
// collection and repeated reads; this helper cannot prove issuance or custody.
import { createPublicKey, X509Certificate } from 'node:crypto';
import { validateOperatorAccessConfig } from '../../follow-up-rehearsal-worker/src/operator-access.mjs';
import { canonical, exact, need, hash, integer } from '../../follow-up-rehearsal-worker/src/protocol.mjs';

export const ACCESS_READBACK_LIMITS = Object.freeze({ inputBytes: 1048576, items: 100, ageMs: 30000, sessionMs: 3600000 });
const ACCOUNT = 'fa2b6f2441129b259dd5dea74045721b';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const APP_FIELDS = ['id', 'type', 'domain', 'aud', 'name', 'created_at', 'updated_at', 'allow_authenticate_via_warp', 'allow_iframe', 'allowed_idps', 'app_launcher_visible', 'auto_redirect_to_identity', 'cors_headers', 'custom_deny_message', 'custom_deny_url', 'custom_non_identity_deny_url', 'custom_pages', 'destinations', 'eager_redirect_cookie_setting', 'enable_binding_cookie', 'http_only_cookie_attribute', 'logo_url', 'mfa_config', 'oauth_configuration', 'options_preflight_bypass', 'path_cookie_attribute', 'policies', 'read_service_tokens_from_header', 'same_site_cookie_attribute', 'scim_config', 'self_hosted_domains', 'service_auth_401_redirect', 'session_duration', 'skip_interstitial', 'tags', 'use_clientless_isolation_app_launcher_url'];
const POLICY_FIELDS = ['id', 'account_id', 'approval_groups', 'approval_required', 'connection_rules', 'created_at', 'decision', 'exclude', 'include', 'isolation_required', 'mfa_config', 'name', 'precedence', 'purpose_justification_prompt', 'purpose_justification_required', 'require', 'session_duration', 'updated_at'];
const TOKEN_FIELDS = ['id', 'client_id', 'duration', 'enabled', 'expires_at', 'name', 'created_at', 'updated_at', 'last_seen_at', 'client_secret_version', 'previous_client_secret_expires_at'];
const allow = (value, fields) => { need(value && typeof value === 'object' && !Array.isArray(value)); need(Object.keys(value).every(k => fields.includes(k))); };
const same = (a, b) => canonical(a) === canonical(b);
const sorted = values => [...values].sort();
const ids = (value, max = 3) => { need(Array.isArray(value) && value.length >= 1 && value.length <= max && value.every(v => typeof v === 'string' && UUID.test(v)) && new Set(value).size === value.length); return sorted(value); };
const text = (value, max = 256) => need(typeof value === 'string' && value.length <= max && !/[\x00-\x1f]/.test(value));
function timestamp(value) { need(typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)); const at = Date.parse(value); need(Number.isFinite(at)); return at; }
function session(value) {
  need(typeof value === 'string' && /^(?:[0-9]+(?:ms|s|m|h))+$/.test(value) && value.length <= 32);
  const parts = [...value.matchAll(/([0-9]+)(ms|s|m|h)/g)], multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  let total = 0, previous = Infinity;
  for (const [, amount, unit] of parts) { const n = Number(amount), scale = multipliers[unit]; integer(n); need(scale < previous); previous = scale; total += n * scale; }
  integer(total, 1000, ACCESS_READBACK_LIMITS.sessionMs); return total;
}
function clean(value) {
  let nodes = 0;
  const walk = (v, depth) => {
    need(++nodes <= 20000 && depth <= 20);
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'string') { need(Buffer.byteLength(v) <= 65536 && !v.includes('-----BEGIN PRIVATE KEY-----')); return v; }
    if (typeof v === 'number') { integer(v); return v; }
    need(v && typeof v === 'object' && (Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v))));
    const out = Array.isArray(v) ? [] : {}, keys = Reflect.ownKeys(v).filter(k => !(Array.isArray(v) && k === 'length')); need(keys.length <= 128);
    for (const key of keys) {
      need(typeof key === 'string' && key.length <= 128 && !['__proto__', 'prototype', 'constructor', 'toJSON', 'client_secret', 'secret', 'password', 'access_token', 'private_key'].includes(key));
      const d = Object.getOwnPropertyDescriptor(v, key); need(d.enumerable && Object.hasOwn(d, 'value')); out[key] = walk(d.value, depth + 1);
    }
    if (Array.isArray(v)) need(Object.keys(out).length === v.length && Object.keys(out).every((k, i) => k === String(i)));
    return out;
  };
  const result = walk(value, 0); need(Buffer.byteLength(canonical(result)) <= ACCESS_READBACK_LIMITS.inputBytes); return result;
}
function envelope(value, list = false) {
  allow(value, ['success', 'errors', 'messages', 'result', 'result_info']);
  need(value.success === true && same(value.errors, []) && (value.messages === undefined || same(value.messages, [])) && Object.hasOwn(value, 'result'));
  if (!list) { need(value.result && typeof value.result === 'object' && !Array.isArray(value.result)); need(value.result_info === undefined); return value.result; }
  need(Array.isArray(value.result) && value.result.length <= ACCESS_READBACK_LIMITS.items); const info = value.result_info;
  allow(info, ['page', 'per_page', 'count', 'total_count', 'total_pages']);
  integer(info.per_page, 1, ACCESS_READBACK_LIMITS.items); need(info.page === 1 && info.count === value.result.length && info.total_count === value.result.length && info.count <= info.per_page && (info.total_pages === 1 || info.count === 0 && info.total_pages === 0));
  const unique = new Set(); for (const item of value.result) { need(item && typeof item.id === 'string' && UUID.test(item.id) && !unique.has(item.id)); unique.add(item.id); }
  return value.result;
}
function routes(app) {
  allow(app, APP_FIELDS); need(UUID.test(app.id)); text(app.type, 64);
  const domains = [];
  const domain = value => { text(value, 1024); need(value && !/[\s?#@:%\\]/.test(value) && !value.includes('..')); const host = value.split('/')[0]; need(/^[a-z0-9*.-]+$/.test(host) && !host.startsWith('.') && !host.endsWith('.')); domains.push(value); };
  if (app.domain !== undefined && app.domain !== '') domain(app.domain);
  if (app.self_hosted_domains !== undefined) { need(Array.isArray(app.self_hosted_domains) && app.self_hosted_domains.length <= 16); for (const value of app.self_hosted_domains) domain(value); }
  if (app.destinations !== undefined) {
    need(Array.isArray(app.destinations) && app.destinations.length >= 1 && app.destinations.length <= 16);
    for (const d of app.destinations) {
      // No worker_id/name equivalence is assumed. Worker-wide, preview, private,
      // MCP and future destination forms require separate explicit review.
      exact(d, ['type', 'uri']); need(d.type === 'public'); domain(d.uri);
    }
  }
  need(domains.length > 0); return { id: app.id, type: app.type, domains: sorted([...new Set(domains)]) };
}
function overlaps(uri, hostname) {
  // Conservatively reject every path on an overlapping host, including a more
  // specific path override. Wildcard matching is bounded and only uses '*'.
  const host = uri.split('/')[0], expression = '^' + host.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$';
  return new RegExp(expression).test(hostname);
}
function selectedApp(app, hostname, audience) {
  const routing = routes(app); need(app.type === 'self_hosted' && app.domain === hostname && app.aud === audience && routing.domains.length === 1 && routing.domains[0] === hostname);
  if (app.destinations !== undefined) need(same(app.destinations, [{ type: 'public', uri: hostname }]));
  if (app.self_hosted_domains !== undefined) need(same(app.self_hosted_domains, []) || same(app.self_hosted_domains, [hostname]));
  for (const field of ['allow_authenticate_via_warp', 'options_preflight_bypass', 'app_launcher_visible']) need(app[field] === false);
  need(app.service_auth_401_redirect === true);
  for (const field of ['auto_redirect_to_identity', 'skip_interstitial', 'use_clientless_isolation_app_launcher_url']) need(app[field] === undefined || app[field] === false);
  for (const field of ['cors_headers', 'mfa_config', 'oauth_configuration', 'scim_config']) need(app[field] === undefined || app[field] === null);
  for (const field of ['read_service_tokens_from_header', 'custom_deny_url', 'custom_non_identity_deny_url']) need(app[field] === undefined || app[field] === null || app[field] === '');
  if (app.allowed_idps !== undefined) need(same(app.allowed_idps, []));
  const result = { ...app, session_duration: session(app.session_duration) }; delete result.policies; delete result.created_at; delete result.updated_at; return result;
}
function policy(value, appSession) {
  allow(value, POLICY_FIELDS); need(UUID.test(value.id) && value.decision === 'non_identity');
  if (value.account_id !== undefined) need(value.account_id === ACCOUNT);
  integer(value.precedence, 0, 1000);
  for (const field of ['exclude', 'require', 'approval_groups']) need(value[field] === undefined || same(value[field], []));
  for (const field of ['approval_required', 'purpose_justification_required', 'isolation_required']) need(value[field] === undefined || value[field] === false);
  for (const field of ['connection_rules', 'mfa_config']) need(value[field] === undefined || value[field] === null);
  need(value.purpose_justification_prompt === undefined || value.purpose_justification_prompt === '');
  need(Array.isArray(value.include) && value.include.length >= 1 && value.include.length <= 3);
  const tokens = value.include.map(rule => { exact(rule, ['service_token']); exact(rule.service_token, ['token_id']); return rule.service_token.token_id; });
  return { id: value.id, decision: value.decision, precedence: value.precedence, tokenIds: ids(tokens), sessionMs: value.session_duration === undefined || value.session_duration === null ? appSession : session(value.session_duration) };
}
function certificates(raw, config, now) {
  exact(raw, ['keys', 'public_cert', 'public_certs']); need(Array.isArray(raw.keys) && raw.keys.length === config.policy.jwks.length && same([...raw.keys].sort((a, b) => a.kid.localeCompare(b.kid)), [...config.policy.jwks].sort((a, b) => a.kid.localeCompare(b.kid))));
  need(Array.isArray(raw.public_certs) && raw.public_certs.length === raw.keys.length); const seen = new Set();
  const check = value => {
    exact(value, ['kid', 'cert']); need(config.keys.has(value.kid) && typeof value.cert === 'string' && value.cert.length <= 8192 && /^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(value.cert));
    const cert = new X509Certificate(value.cert), key = createPublicKey(value.cert); need(key.asymmetricKeyType === 'rsa' && same(key.export({ format: 'jwk' }), config.keys.get(value.kid).export({ format: 'jwk' })));
    need(Date.parse(cert.validFrom) <= now && Date.parse(cert.validTo) >= config.policy.expiresAt); return { kid: value.kid, certificateSha256: hash(cert.raw) };
  };
  const certs = raw.public_certs.map(value => { need(!seen.has(value.kid)); seen.add(value.kid); return check(value); }).sort((a, b) => a.kid.localeCompare(b.kid));
  const current = check(raw.public_cert); need(certs.some(c => same(c, current))); return { keys: [...raw.keys].sort((a, b) => a.kid.localeCompare(b.kid)), certificates: certs, currentKid: current.kid };
}

export function validateRehearsalAccessReadback(input, now = Date.now()) {
  try {
    const v = clean(input); exact(v, ['publicConfig', 'applicationId', 'policyIds', 'serviceTokenIds', 'organization', 'application', 'applications', 'zoneApplications', 'policies', 'serviceTokens', 'jwks', 'observedAt']);
    integer(now); integer(v.observedAt); need(v.observedAt <= now && now - v.observedAt <= ACCESS_READBACK_LIMITS.ageMs);
    exact(v.publicConfig, ['REHEARSAL_MANIFEST', 'REHEARSAL_CALLER_KEYS', 'OPERATOR_ACCESS_CONFIG']); const config = validateOperatorAccessConfig(v.publicConfig); need(config.policy.issuedAt <= now && now < config.policy.expiresAt);
    const hostname = new URL(config.origin).hostname; need(UUID.test(v.applicationId)); const policyIds = ids(v.policyIds), serviceTokenIds = ids(v.serviceTokenIds);
    const organization = envelope(v.organization); need(organization.auth_domain === new URL(config.policy.issuer).hostname);
    const app = envelope(v.application); need(app.id === v.applicationId); const selected = selectedApp(app, hostname, config.policy.audience);
    const accountApps = envelope(v.applications, true), zoneApps = envelope(v.zoneApplications, true); need(accountApps.some(a => a.id === app.id));
    const inventory = new Map();
    for (const item of [...accountApps, ...zoneApps]) { const routing = routes(item); if (item.id === app.id) need(same(selectedApp(item, hostname, config.policy.audience), selected)); else need(routing.domains.every(d => !overlaps(d, hostname)));
      if (inventory.has(item.id)) need(same(inventory.get(item.id), routing)); else inventory.set(item.id, routing);
    }
    const policies = envelope(v.policies, true).map(p => policy(p, selected.session_duration)).sort((a, b) => a.id.localeCompare(b.id));
    need(same(sorted(policies.map(p => p.id)), policyIds) && new Set(policies.map(p => p.precedence)).size === policies.length);
    const included = policies.flatMap(p => p.tokenIds); need(same(ids(included), serviceTokenIds));
    if (app.policies !== undefined) {
      need(Array.isArray(app.policies) && same(ids(app.policies.map(p => p.id)), policyIds));
      for (const item of app.policies) {
        if (Object.keys(item).every(k => ['id', 'account_id', 'precedence'].includes(k))) {
          if (item.account_id !== undefined) need(item.account_id === ACCOUNT);
          if (item.precedence !== undefined) need(policies.some(p => p.id === item.id && p.precedence === item.precedence));
        } else need(policies.some(p => same(p, policy(item, selected.session_duration))));
      }
    }
    const tokenInventory = envelope(v.serviceTokens, true); for (const token of tokenInventory) allow(token, TOKEN_FIELDS);
    const tokens = tokenInventory.filter(t => serviceTokenIds.includes(t.id)); need(tokens.length === serviceTokenIds.length && tokens.length === config.policy.principals.length);
    const commonNames = new Set();
    const identities = tokens.map(t => {
      need(t.enabled === true && typeof t.client_id === 'string' && !commonNames.has(t.client_id)); commonNames.add(t.client_id);
      const mapping = config.policy.principals.find(p => p.commonName === t.client_id); need(mapping); const expiresAt = timestamp(t.expires_at); need(expiresAt >= config.policy.expiresAt && expiresAt > now);
      if (t.duration !== undefined) need(typeof t.duration === 'string' && t.duration !== 'forever');
      for (const field of ['created_at', 'updated_at']) if (t[field] !== undefined) need(timestamp(t[field]) <= now);
      if (t.client_secret_version !== undefined) integer(t.client_secret_version, 1);
      if (t.previous_client_secret_expires_at !== undefined && t.previous_client_secret_expires_at !== null) need(timestamp(t.previous_client_secret_expires_at) <= now);
      return { id: t.id, clientId: t.client_id, enabled: true, expiresAt, secretVersion: t.client_secret_version ?? null, ...mapping };
    }).sort((a, b) => a.id.localeCompare(b.id));
    const jwks = certificates(v.jwks, config, now);
    const proof = { version: 'follow-up-rehearsal-access-readback.v1', publicConfigDigest: hash(canonical(v.publicConfig)), issuer: config.policy.issuer, application: selected, routingInventory: [...inventory.values()].sort((a, b) => a.id.localeCompare(b.id)), policies, identities, jwks, expiresAt: config.policy.expiresAt };
    return { version: proof.version, digest: hash(canonical(proof)), expiresAt: proof.expiresAt, observedAt: v.observedAt, freshnessUntil: Math.min(proof.expiresAt, v.observedAt + ACCESS_READBACK_LIMITS.ageMs), applicationId: v.applicationId, policyIds, serviceTokenIds, issuanceProven: false, custodyProven: false, productionAuthority: false };
  } catch { throw new Error('rehearsal_access_readback_refused'); }
}
