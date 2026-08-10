import { describe, expect, it, vi } from 'vitest';
import { buildIdentityFromScripts, retireLegacyStaffRuntime } from './staff-release';

describe('Staff release runtime', () => {
  it('unregisters legacy workers and removes only Staff-owned caches', async () => {
    const unregisterStaff = vi.fn(async () => true);
    const unregisterOther = vi.fn(async () => true);
    const deleteCache = vi.fn(async () => true);

    await retireLegacyStaffRuntime({
      registrations: [
        { scriptUrl: 'https://www.amarimethod.com/staff-sw.js', unregister: unregisterStaff },
        { scriptUrl: 'https://www.amarimethod.com/portal-sw.js', unregister: unregisterOther },
      ],
      cacheNames: ['amari-staff-v4', 'public-editorial-v2'],
      deleteCache,
    });

    expect(unregisterStaff).toHaveBeenCalledOnce();
    expect(unregisterOther).not.toHaveBeenCalled();
    expect(deleteCache).toHaveBeenCalledExactlyOnceWith('amari-staff-v4');
  });

  it('names the exact loaded Staff bundle for support readback', () => {
    expect(buildIdentityFromScripts([
      'https://www.amarimethod.com/js/site-v6.js',
      'https://www.amarimethod.com/staff/assets/index-CvhgP6CW.js',
    ])).toBe('CvhgP6CW');
    expect(buildIdentityFromScripts([])).toBe('unknown');
  });
});
