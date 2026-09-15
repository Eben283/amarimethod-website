import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Staff balances request timeout', () => {
  it('lets the known cold ledger rebuild run beyond the shared 15-second limit', () => {
    const api = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

    expect(api).toContain('const BALANCES_REQUEST_TIMEOUT_MS = 90_000;');
    expect(api).toContain("return fetchApi(`/staff-balances${refresh ? '?refresh=1' : ''}`, {}, BALANCES_REQUEST_TIMEOUT_MS);");
  });
});
