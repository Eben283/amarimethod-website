import { describe, expect, it } from 'vitest';
import { deskNavigationRoute } from './desk-navigation.ts';

const ORIGIN = 'https://www.amarimethod.com';

describe('deskNavigationRoute', () => {
  it('removes the Staff router basename exactly once for workflow inspection', () => {
    expect(deskNavigationRoute('/staff/automations/quiz-nurture?contact=person_1', ORIGIN))
      .toBe('/automations/quiz-nurture?contact=person_1');
  });

  it('preserves the existing POS handoff route', () => {
    expect(deskNavigationRoute('/staff/pos?contact=person_1', ORIGIN)).toBe('/pos?contact=person_1');
  });

  it('rejects external origins and unapproved Staff routes', () => {
    expect(deskNavigationRoute('https://example.com/staff/automations', ORIGIN)).toBeNull();
    expect(deskNavigationRoute('/staff/operations', ORIGIN)).toBeNull();
  });
});
